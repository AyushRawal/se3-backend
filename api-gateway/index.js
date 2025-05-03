import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import {
  registerService,
  discoverService,
} from "../shared/service-discovery.js";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
const PORT = process.env.GATEWAY_PORT || 5000;
const SERVICE_NAME = "api-gateway";

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });
  next();
});

// Rate limiting middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later.",
    status: 429,
  },
});

// Apply rate limiting to all requests
app.use(apiLimiter);

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next(); // Allow request to proceed without user info
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Add user info to headers for downstream services
    req.headers["x-user-id"] = decoded.id;
    req.headers["x-user-role"] = decoded.role;
    req.headers["x-user-email"] = decoded.email;

    next();
  } catch (error) {
    // Invalid token, but still let request proceed
    console.error("Token verification failed:", error.message);
    next();
  }
};

// Check if a service is healthy with improved error handling and caching
const checkServiceHealth = async (serviceName) => {
  try {
    // Use our enhanced service discovery with caching and health verification
    // The bypassCache=false parameter ensures we use cached values when possible for better performance
    const service = await discoverService(serviceName, null, false);

    // Double-verify health status
    try {
      const healthCheckUrl = `http://${service.address}:${service.port}/health`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(healthCheckUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return { healthy: true, service };
      }

      return { healthy: false };
    } catch (error) {
      console.error(
        `Direct health check failed for ${serviceName}:`,
        error.message,
      );
      // If the direct health check fails but service discovery says it's healthy,
      // we'll still consider it potentially healthy but mark it for verification
      return { healthy: true, service, needsVerification: true };
    }
  } catch (error) {
    console.error(
      `Service discovery health check failed for ${serviceName}:`,
      error.message,
    );
    return { healthy: false };
  }
};

// Create dynamic proxy middleware with timeout and circuit breaker pattern
const createDynamicProxy = (serviceName, pathRewrite) => {
  // Simple circuit breaker state
  let circuitOpen = false;
  let failureCount = 0;
  let lastFailureTime = 0;
  const FAILURE_THRESHOLD = 5;
  const CIRCUIT_RESET_TIMEOUT = 30000; // 30 seconds

  return async (req, res, next) => {
    // Check if circuit is open
    if (circuitOpen) {
      const now = Date.now();
      if (now - lastFailureTime > CIRCUIT_RESET_TIMEOUT) {
        // Try to reset circuit after timeout
        circuitOpen = false;
        failureCount = 0;
        console.log(`Circuit reset for ${serviceName}`);
      } else {
        return res.status(503).json({
          error: `Service ${serviceName} is temporarily unavailable, please try again later`,
          status: "circuit-open",
        });
      }
    }

    try {
      // Discover service instance with health check
      const healthCheck = await checkServiceHealth(serviceName);

      if (!healthCheck.healthy) {
        failureCount++;
        lastFailureTime = Date.now();

        if (failureCount >= FAILURE_THRESHOLD) {
          circuitOpen = true;
          console.error(
            `Circuit opened for ${serviceName} due to multiple failures`,
          );
        }

        return res.status(503).json({
          error: `Service ${serviceName} is currently unhealthy`,
          status: "unhealthy",
        });
      }

      const service = healthCheck.service;
      const target = `http://${service.address}:${service.port}`;

      // Reset failure count on successful discovery
      failureCount = 0;

      // Create proxy with timeout
      const proxy = createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite,
        timeout: 10000, // 10 second timeout
        proxyTimeout: 10000,
        onProxyReq: (proxyReq, req, res) => {
          console.log(`Proxying to ${serviceName}: ${req.method} ${req.path}`);

          // Forward auth headers if present
          if (req.user) {
            proxyReq.setHeader("x-user-id", req.user.id);
            proxyReq.setHeader("x-user-role", req.user.role);
            proxyReq.setHeader("x-user-email", req.user.email);
          }
        },
        onError: (err, req, res) => {
          failureCount++;
          lastFailureTime = Date.now();

          if (failureCount >= FAILURE_THRESHOLD) {
            circuitOpen = true;
            console.error(
              `Circuit opened for ${serviceName} due to multiple failures`,
            );
          }

          const statusCode = err.code === "ECONNREFUSED" ? 503 : 500;
          res.status(statusCode).json({
            error: `Error connecting to ${serviceName}: ${err.message}`,
            status: "proxy-error",
          });
        },
      });

      // Execute proxy
      return proxy(req, res, next);
    } catch (error) {
      console.error(
        `Service discovery failed for ${serviceName}: ${error.message}`,
      );

      failureCount++;
      lastFailureTime = Date.now();

      if (failureCount >= FAILURE_THRESHOLD) {
        circuitOpen = true;
        console.error(
          `Circuit opened for ${serviceName} due to multiple failures`,
        );
      }

      return res.status(503).json({
        error: `Service ${serviceName} is currently unavailable`,
        status: "discovery-error",
      });
    }
  };
};

// Apply token verification to all requests
app.use(verifyToken);

// Routes with dynamic service discovery
app.use(
  "/api/auth",
  createDynamicProxy("auth-service", { "^/api/auth": "/api/auth" }),
);
app.use(
  "/api/search",
  createDynamicProxy("search-service", { "^/api/search": "/api/search" }),
);

// Advanced health check endpoint with downstream service status
app.get("/health", async (req, res) => {
  // Check downstream services
  const authServiceHealth = await checkServiceHealth("auth-service");
  const searchServiceHealth = await checkServiceHealth("search-service");

  res.json({
    status: "OK",
    service: SERVICE_NAME,
    timestamp: new Date(),
    user: req.user ? { id: req.user.id, role: req.user.role } : null,
    dependencies: {
      "auth-service": authServiceHealth.healthy ? "healthy" : "unhealthy",
      "search-service": searchServiceHealth.healthy ? "healthy" : "unhealthy",
    },
  });
});

// Handle 404 routes
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.originalUrl} does not exist`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : err.message,
  });
});

// Start the server
app.listen(PORT, async () => {
  console.log(`API Gateway running on http://localhost:${PORT}`);

  // Register with service discovery
  try {
    await registerService(SERVICE_NAME, PORT);
    console.log(
      `${SERVICE_NAME} registered successfully with service discovery`,
    );
  } catch (error) {
    console.error("Failed to register with service discovery:", error.message);
  }
});

