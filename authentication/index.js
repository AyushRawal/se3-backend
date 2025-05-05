import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import { connectDB } from "./db.js";
import pool from "./db.js";
import { registerService } from "../shared/service-discovery.js";
import { createTopicsIfNotExist, getProducer } from "../shared/kafka/client.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const SERVICE_NAME = "auth-service";

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/api/auth", authRoutes);

// Health check endpoint required by service discovery
app.get("/health", async (req, res) => {
  let dbStatus = false;
  let kafkaStatus = false;

  try {
    await pool.query("SELECT 1");
    dbStatus = true;
  } catch (error) {
    console.error("Database health check failed:", error.message);
  }

  // Check Kafka - simplified check based on whether we've initialized
  kafkaStatus = app.locals.kafkaInitialized || false;

  res.json({
    status: "OK",
    service: SERVICE_NAME,
    timestamp: new Date(),
    dependencies: {
      database: dbStatus ? "connected" : "disconnected",
      kafka: kafkaStatus ? "connected" : "not initialized",
    },
  });
});

// Initialize Kafka topics
const initializeKafka = async () => {
  try {
    // Create Kafka topics if they don't exist
    await createTopicsIfNotExist();

    app.locals.kafkaInitialized = true;
    console.log("Kafka infrastructure initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Kafka:", error);
    // Non-fatal error, service can still operate without Kafka
    app.locals.kafkaInitialized = false;
  }
};

// Connect to database and start server
connectDB()
  .then(() => {
    const server = app.listen(PORT, async () => {
      console.log(`Auth service running on http://localhost:${PORT}`);

      // Register with service discovery
      try {
        await registerService(SERVICE_NAME, PORT);
        console.log(
          `${SERVICE_NAME} registered successfully with service discovery`,
        );
      } catch (error) {
        console.error(
          "Failed to register with service discovery:",
          error.message,
        );
      }

      // Initialize Kafka after server has started
      await initializeKafka();
    });

    const shutdown = async () => {
      console.log("Shutting down gracefully...");

      // Close HTTP server
      server.close(() => {
        console.log("HTTP server closed");
      });

      // Disconnect Kafka logging producer
      producer = getProducer()
      if (producer) {
        try {
          await producer.disconnect();
          console.log("Disconnected from Kafka logging");
        } catch (error) {
          console.error("Error disconnecting from Kafka logging:", error);
        }
      }

      process.exit(0);
    };

    // Handle process termination signals
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error("Error starting server:", error);
    process.exit(1);
  });
