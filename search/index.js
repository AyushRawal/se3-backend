import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import pkg from 'pg';
import searchRoutes from './routes/searchRoutes.js';
import { connectDB as connectPostgres } from './db/postgres.js';
import { registerService } from '../shared/service-discovery.js';
import { setupElasticsearch } from './utils/elasticsearch.js';
import { createTopicsIfNotExist } from '../shared/kafka/client.js';
import { startDocumentEventConsumers } from './services/documentEventConsumer.js';
import { initializeService } from './services/searchService.js';


const { Pool } = pkg;
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5002;
const SERVICE_NAME = 'search-service';

// Connect to MongoDB for document storage
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch(err => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  });

// Initialize Elasticsearch
const esClient = setupElasticsearch();
initializeService(esClient);

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' })); // Increased limit for document uploads
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Routes
app.use('/api/search', searchRoutes);

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  let esStatus = false;
  let mongoStatus = false;
  let pgStatus = false;
  let kafkaStatus = false;
  
  // Check Elasticsearch
  try {
    await esClient.ping();
    esStatus = true;
  } catch (error) {
    console.error('Elasticsearch health check failed:', error);
  }
  
  // Check MongoDB
  mongoStatus = mongoose.connection.readyState === 1;
  
  // Check PostgreSQL
  try {
    const pool = connectPostgres.getPool();
    if (pool) {
      await pool.query('SELECT 1');
      pgStatus = true;
    }
  } catch (error) {
    console.error('PostgreSQL health check failed:', error);
  }
  
  // Check Kafka - simplified check based on whether we've started consumers
  kafkaStatus = app.locals.kafkaInitialized || false;
  
  // Determine overall status
  const allDependenciesHealthy = esStatus && mongoStatus;
  
  res.status(allDependenciesHealthy ? 200 : 503).json({
    status: allDependenciesHealthy ? 'healthy' : 'degraded',
    service: SERVICE_NAME,
    timestamp: new Date(),
    dependencies: {
      elasticsearch: esStatus ? 'connected' : 'disconnected',
      mongodb: mongoStatus ? 'connected' : 'disconnected',
      postgres: pgStatus ? 'connected' : 'disconnected',
      kafka: kafkaStatus ? 'connected' : 'not initialized'
    },
    version: process.env.SERVICE_VERSION || '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`, err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Connect to PostgreSQL for user data
connectPostgres();

// Export Elasticsearch client to be used in other modules
export { esClient };

// Initialize Kafka topics and consumers
const initializeKafka = async () => {
  try {
    // Create Kafka topics if they don't exist
    await createTopicsIfNotExist();
    
    // Start document event consumers for asynchronous indexing
    await startDocumentEventConsumers(esClient);
    
    app.locals.kafkaInitialized = true;
    console.log('Kafka infrastructure initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Kafka:', error);
    // Non-fatal error, service can still operate without Kafka
    app.locals.kafkaInitialized = false;
  }
};

// Start the server
app.listen(PORT, async () => {
  console.log(`Search service running on http://localhost:${PORT}`);
  
  // Register with service discovery
  try {
    await registerService(SERVICE_NAME, PORT);
    console.log(`${SERVICE_NAME} registered successfully with service discovery`);
  } catch (error) {
    console.error('Failed to register with service discovery:', error.message);
  }
  
  // Initialize Kafka after server has started
  await initializeKafka();
});