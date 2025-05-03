import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { Kafka, Producer } from "kafkajs";
import resourceRoutes from "./routes/resourceRoutes";
import { registerService } from "../shared/service-discovery.js";
import { getProducer, disconnectProducer } from "./services/documentEventProducer";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'resource-service';

// Connect to MongoDB for document metadata storage
const connectMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("Connected to MongoDB database");
    return true;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    return false;
  }
};

// Kafka logging setup
const kafka = new Kafka({
  clientId: "resource-service",
  brokers: [process.env.KAFKA_BROKER as string],
});

const producer: Producer = kafka.producer();
const logTopic = "resource-service-logs";

// Connect to Kafka for logging
async function connectKafka() {
  try {
    await producer.connect();
    console.log("Connected to Kafka for logging");
    return true;
  } catch (error) {
    console.error("Error connecting to Kafka:", error);
    return false;
  }
}

// Logging utility
interface LogMetadata {
  [key: string]: any;
}

const log = async (
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  metadata: LogMetadata = {},
): Promise<void> => {
  try {
    await producer.send({
      topic: logTopic,
      messages: [
        {
          value: JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            service: SERVICE_NAME,
            message,
            ...metadata,
          }),
        },
      ],
    });
  } catch (error) {
    console.error("Error sending log to Kafka:", error);
  }
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    
    // Log to Kafka if connected (non-blocking)
    log("INFO", `${req.method} ${req.originalUrl}`, {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(err => console.error("Kafka logging error:", err));
  });
  next();
});

// Routes
app.use("/api/resources", resourceRoutes);

// Health check endpoint required by service discovery
app.get("/health", async (req: Request, res: Response): Promise<void> => {
  let mongoStatus = mongoose.connection.readyState === 1;
  let kafkaStatus = false;
  let documentProducerStatus = false;
  
  // Check Kafka connection for logging
  try {
    await producer.send({ topic: logTopic, messages: [{ value: "health_check" }] });
    kafkaStatus = true;
  } catch (error) {
    console.error("Kafka health check failed:", error);
  }
  
  // Check Kafka connection for document events
  try {
    const docProducer = await getProducer();
    documentProducerStatus = true;
  } catch (error) {
    console.error("Document producer health check failed:", error);
  }
  
  // Determine overall status
  const allDependenciesHealthy = mongoStatus && (kafkaStatus || documentProducerStatus);
  
  res.status(allDependenciesHealthy ? 200 : 503).json({
    status: allDependenciesHealthy ? "healthy" : "degraded",
    service: SERVICE_NAME,
    timestamp: new Date(),
    dependencies: {
      mongodb: mongoStatus ? "connected" : "disconnected",
      kafka: kafkaStatus ? "connected" : "disconnected",
      documentProducer: documentProducerStatus ? "connected" : "disconnected"
    },
    version: process.env.SERVICE_VERSION || "1.0.0"
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`Error: ${err.message}`, err.stack);
  
  // Log error to Kafka
  log("ERROR", "Unhandled server error", {
    error: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  }).catch(e => console.error("Error logging to Kafka:", e));
  
  res.status(500).json({
    success: false,
    error: "Internal Server Error"
  });
});

// Initialize Kafka and MongoDB
const initializeInfrastructure = async () => {
  // Connect to MongoDB
  const mongoConnected = await connectMongoDB();
  if (!mongoConnected) {
    console.error("Failed to connect to MongoDB. Exiting...");
    process.exit(1);
  }
  
  // Connect to Kafka for logging (continue even if it fails)
  await connectKafka();
  
  // Connect to Kafka for document events (continue even if it fails)
  try {
    await getProducer();
    console.log("Connected to Kafka for document events");
    app.locals.documentProducerInitialized = true;
  } catch (error) {
    console.error("Failed to initialize document producer:", error);
    app.locals.documentProducerInitialized = false;
  }
};

// Start the server
const startServer = async () => {
  try {
    // Initialize infrastructure connections
    await initializeInfrastructure();
    
    // Start the HTTP server
    const server = app.listen(PORT, () => {
      console.log(`Resource service running on http://localhost:${PORT}`);
    });
    
    // Register with service discovery
    try {
      await registerService(SERVICE_NAME, PORT);
      console.log(`${SERVICE_NAME} registered successfully with service discovery`);
    } catch (error) {
      console.error("Failed to register with service discovery:", error.message);
    }
    
    // Setup graceful shutdown
    const shutdown = async () => {
      console.log("Shutting down gracefully...");
      
      // Close HTTP server
      server.close(() => {
        console.log("HTTP server closed");
      });
      
      // Disconnect Kafka logging producer
      if (producer) {
        try {
          await producer.disconnect();
          console.log("Disconnected from Kafka logging");
        } catch (error) {
          console.error("Error disconnecting from Kafka logging:", error);
        }
      }
      
      // Disconnect Kafka document producer
      try {
        await disconnectProducer();
      } catch (error) {
        console.error("Error disconnecting document producer:", error);
      }
      
      // Disconnect MongoDB
      try {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
      } catch (error) {
        console.error("Error disconnecting from MongoDB:", error);
      }
      
      process.exit(0);
    };
    
    // Handle process termination signals
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
};

// Start the server
startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
