import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import {
  registerService,
  discoverService,
  troubleshootService,
  isServiceDiscoveryAvailable
} from "../shared/service-discovery.js";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.GATEWAY_PORT, 10) || 5000;
const SERVICE_NAME = "api-gateway";
const SERVICE_TAG = process.env.SERVICE_TAG || process.env.NODE_ENV || "development";
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

const circuitStates = {};

// ——— Middleware —————————————————————————————————————————————————————————

app.use(cors());

app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[Middleware] Incoming request: ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[Middleware] Completed ${req.ip} ${req.method} ${req.originalUrl} → ${res.statusCode} in ${duration}ms`);
  });
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later.",
    status: 429,
  },
});
app.use(apiLimiter);

// ——— RAW‐BODY PROXIES (login/register) ———————————————————————————————

app.use(
  "/api/auth/login",
  createDynamicProxy("auth-service", { "^/api/auth/login": "/api/auth/login" })
);

app.use(
  "/api/auth/register",
  createDynamicProxy("auth-service", { "^/api/auth/register": "/api/auth/register" })
);

// ——— BODY PARSERS —————————————————————————————————————————————————————

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ——— JWT VERIFICATION ——————————————————————————————————————————————

const verifyToken = (req, res, next) => {
  console.log("[Auth] Verifying token if present");
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    console.log("[Auth] No token provided");
    return next();
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("[Auth] Token valid for user:", decoded.id);
    req.user = decoded;
    req.headers["x-user-id"] = decoded.id;
    req.headers["x-user-role"] = decoded.role;
    req.headers["x-user-email"] = decoded.email;
  } catch (err) {
    console.error("[Auth] Token verification failed:", err.message);
  }
  next();
};

// ——— DISCOVERY & CIRCUIT BREAKER HELPERS ——————————————————————————————————

const debugLog = (category, message, data = null) => {
  if (DEBUG_MODE) {
    console.log(`[${category}] ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
  }
};

const discoverServiceInstance = async (serviceName) => {
  debugLog("Discovery", `Finding '${serviceName}' with tag='${SERVICE_TAG}'`);
  try {
    const svc = await discoverService(serviceName, SERVICE_TAG, false);
    console.log(`[Discovery] ${serviceName} @ ${svc.address}:${svc.port} (tag=${SERVICE_TAG})`);
    return { success: true, service: svc };
  } catch (err) {
    console.warn(`[Discovery] No '${serviceName}' with tag '${SERVICE_TAG}':`, err.message);
  }
  console.log(`[Discovery] Retrying '${serviceName}' without tag`);
  try {
    const svc2 = await discoverService(serviceName, null, true);
    console.log(`[Discovery] ${serviceName} @ ${svc2.address}:${svc2.port} (no tag)`);
    return { success: true, service: svc2 };
  } catch (err2) {
    console.error(`[Discovery] Retry failed for ${serviceName}:`, err2.message);
    try {
      const diag = await troubleshootService(serviceName);
      console.error(`[Discovery] Diagnostics for ${serviceName}:`, JSON.stringify(diag, null, 2));
    } catch (_) {}
    return { success: false, error: err2.message };
  }
};

const getCircuitState = (serviceName) => {
  if (!circuitStates[serviceName]) {
    circuitStates[serviceName] = {
      failures: 0,
      circuitOpen: false,
      lastFailureTs: 0,
      THRESHOLD: 5,
      CIRCUIT_RESET_MS: 30_000
    };
  }
  return circuitStates[serviceName];
};

// ——— PROXY FACTORY WITH LOGGING & pathRewrite ———————————————————————————————

/**
 * Return an Express middleware that:
 *   1. Discovers the target instance via Consul
 *   2. Applies circuit‑breaker logic
 *   3. Proxies the request, preserving the FULL original URL
 *      (so /api/auth/register reaches the auth‑service unchanged)
 */
function createDynamicProxy(serviceName) {
  return async (req, res, next) => {
    console.log(`\n=== [Proxy] Handling request for '${serviceName}' ===`);
    console.log(`[Proxy] Incoming URL: ${req.method} ${req.originalUrl}`);

    /* ——— Circuit‑breaker pre‑check ——— */
    const circuit = getCircuitState(serviceName);
    if (circuit.circuitOpen) {
      const waited = Date.now() - circuit.lastFailureTs;
      console.warn(`[Proxy] Circuit OPEN for ${serviceName} (waited ${waited} ms)`);
      if (waited > circuit.CIRCUIT_RESET_MS) {
        circuit.circuitOpen = false;
        circuit.failures = 0;
        console.log(`[Proxy] Circuit RESET for ${serviceName}`);
      } else {
        return res
          .status(503)
          .json({ error: `${serviceName} unavailable`, status: "circuit-open" });
      }
    }

    /* ——— Service discovery ——— */
    const { success, service, error } = await discoverServiceInstance(serviceName);
    if (!success) {
      circuit.failures++;
      circuit.lastFailureTs = Date.now();
      console.error(`[Proxy] Discovery failed for ${serviceName}:`, error);
      if (circuit.failures >= circuit.THRESHOLD) {
        circuit.circuitOpen = true;
        console.error(`[Proxy] Circuit OPENED for ${serviceName}`);
      }
      return res.status(503).json({
        error: `${serviceName} unavailable`,
        details: error,
        status: "unavailable",
      });
    }
    circuit.failures = 0;

    /* ——— Build target URL & log it ——— */
    const target = `http://${service.address}:${service.port}`;
    console.log(
      `[Proxy] Calling upstream → ${service.address}:${service.port}${req.originalUrl}`
    );

    /* ——— Create proxy middleware ——— */
    const proxy = createProxyMiddleware({
      target,
      changeOrigin: true,
      timeout: 10_000,
      proxyTimeout: 10_000,
      logLevel: DEBUG_MODE ? "debug" : "warn",

      // Preserve the FULL original path that the client requested.
      // Express strips the mount‑path from req.url, so we restore it from req.originalUrl.
      pathRewrite: (_path, req) => req.originalUrl,

      /* — Hooks — */
      onProxyReq(proxyReq, req) {
        console.log(`[Proxy][onProxyReq] ${req.method} ${req.originalUrl}`);
        if (req.user) {
          proxyReq.setHeader("x-user-id", req.user.id);
          proxyReq.setHeader("x-user-role", req.user.role);
          proxyReq.setHeader("x-user-email", req.user.email);
        }
      },

      onProxyRes(proxyRes, req) {
        console.log(
          `[Proxy][onProxyRes] ${serviceName} ${req.method} ${req.originalUrl} → ${proxyRes.statusCode}`
        );
      },

      onError(err, req, res) {
        circuit.failures++;
        circuit.lastFailureTs = Date.now();
        console.error(`[Proxy][onError] ${serviceName}:`, err.message);
        if (circuit.failures >= circuit.THRESHOLD) {
          circuit.circuitOpen = true;
          console.error(`[Proxy] Circuit OPENED for ${serviceName}`);
        }
        const code = err.code === "ECONNREFUSED" ? 503 : 500;
        res.status(code).json({
          error: `Error connecting to ${serviceName}: ${err.message}`,
          status: "proxy-error",
        });
      },
    });

    /* ——— Hand off control to http‑proxy‑middleware ——— */
    return proxy(req, res, next);
  };
}


// ——— JWT‐guarded & search routes ———————————————————————————————————————

app.use(verifyToken);

app.use(
  "/api/search",
  createDynamicProxy("search-service", { "^/api/search": "" })
);

// ——— DIAGNOSTIC ENDPOINT ——————————————————————————————————————————————

app.get("/api/system/discovery-status", async (req, res) => {
  try {
    const avail = await isServiceDiscoveryAvailable();
    const resp = { status: avail ? "online" : "offline", message: avail ? "OK" : "Consul down" };
    if (avail && req.user?.role === "admin") {
      const diags = {};
      for (const svc of ["auth-service", "search-service"]) {
        try { diags[svc] = await troubleshootService(svc); }
        catch (e) { diags[svc] = { error: e.message }; }
      }
      resp.diagnostics = diags;
    }
    res.json(resp);
  } catch (e) {
    res.status(500).json({ status: "error", message: e.message });
  }
});

// ——— FALLBACK HANDLERS ———————————————————————————————————————————————————

app.use((req, res) => {
  console.error(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Not Found", message: `Route ${req.originalUrl} does not exist` });
});

app.use((err, req, res, _next) => {
  console.error("[Unhandled Error]", err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

// ——— START & REGISTER ————————————————————————————————————————————————————

async function startServer() {
  const avail = await isServiceDiscoveryAvailable();
  if (!avail) console.warn("[Startup] Consul not reachable; gateway will still start.");
  app.listen(PORT, async () => {
    console.log(`[Startup] API Gateway running on http://0.0.0.0:${PORT}`);
    try {
      await registerService(SERVICE_NAME, PORT, [SERVICE_TAG]);
      console.log(`[Startup] ${SERVICE_NAME} registered successfully`);
    } catch (e) {
      console.error(`[Startup] Failed to register:`, e.message);
    }
  });
}

startServer();
