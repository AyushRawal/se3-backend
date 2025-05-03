// service-discovery.js - Shared module for service discovery across microservices
import Consul from 'consul';
import dotenv from 'dotenv';
import os from 'os';

dotenv.config();

// Default Consul configuration
const CONSUL_HOST = process.env.CONSUL_HOST || 'localhost';
const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
const HEALTH_CHECK_INTERVAL = process.env.HEALTH_CHECK_INTERVAL || '10s';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATACENTER = process.env.CONSUL_DC || 'dc1';
const MAX_RETRIES = parseInt(process.env.CONSUL_MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.CONSUL_RETRY_DELAY_MS || '1000', 10);
const CACHE_TTL_MS = parseInt(process.env.CONSUL_CACHE_TTL_MS || '5000', 10);

// Initialize Consul client with retry mechanism
let consulClient;
const initConsul = async () => {
  if (consulClient) return consulClient;
  
  consulClient = new Consul({
    host: CONSUL_HOST,
    port: CONSUL_PORT,
    promisify: true
  });
  
  // Verify connection
  try {
    await consulClient.status.leader();
    console.log('Connected to Consul service discovery');
    return consulClient;
  } catch (error) {
    console.error('Failed to connect to Consul:', error.message);
    consulClient = null;
    throw error;
  }
};

// Get the hostname and IP address
const hostname = os.hostname();

// Get IP address
const getIpAddress = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip over non-IPv4 and internal (loopback) addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  // Default to localhost if no external IP is found
  return '127.0.0.1';
};

const ipAddress = getIpAddress();

// In-memory cache for discovered services
const serviceCache = new Map();

// Helper to perform retry logic
const withRetry = async (operation, retries = MAX_RETRIES, delay = RETRY_DELAY_MS) => {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.warn(`Attempt ${attempt}/${retries} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Increase delay for subsequent attempts
        delay *= 1.5;
      }
    }
  }
  
  throw lastError;
};

/**
 * Register a service with Consul
 * @param {string} serviceName - Name of the service
 * @param {number} port - Port on which the service is running
 * @param {Array} tags - Array of tags for the service
 * @returns {Promise<string>} - Service ID of the registered service
 */
export const registerService = async (serviceName, port, tags = []) => {
  const serviceId = `${serviceName}-${hostname}-${port}`;
  
  try {
    const consul = await withRetry(initConsul);
    
    // Register the service
    await consul.agent.service.register({
      id: serviceId,
      name: serviceName,
      address: ipAddress,
      port: parseInt(port, 10),
      tags: [...tags, NODE_ENV],
      check: {
        http: `http://${ipAddress}:${port}/health`,
        interval: HEALTH_CHECK_INTERVAL,
        timeout: '5s',
        deregistercriticalserviceafter: '30s'
      }
    });
    
    console.log(`Service ${serviceName} registered with ID ${serviceId}`);
    
    // Graceful shutdown handler
    const deregister = async () => {
      try {
        await consul.agent.service.deregister(serviceId);
        console.log(`Service ${serviceId} deregistered successfully`);
        process.exit(0);
      } catch (error) {
        console.error(`Error deregistering service ${serviceId}:`, error);
        process.exit(1);
      }
    };
    
    // Handle process termination signals
    process.on('SIGINT', deregister);
    process.on('SIGTERM', deregister);
    
    return serviceId;
  } catch (error) {
    console.error(`Error registering service ${serviceName}:`, error);
    throw new Error(`Service registration failed: ${error.message}`);
  }
};

/**
 * Verify if a service instance is healthy by directly checking its health endpoint
 * @param {Object} service - Service instance details
 * @returns {Promise<boolean>} - Whether the service is healthy
 */
const verifyServiceHealth = async (service) => {
  try {
    const response = await fetch(`http://${service.address}:${service.port}/health`, {
      timeout: 2000
    });
    return response.ok;
  } catch (error) {
    return false;
  }
};

/**
 * Discover a service from Consul with caching and health verification
 * @param {string} serviceName - Name of the service to discover
 * @param {string} tag - Optional tag to filter services
 * @param {boolean} bypassCache - Whether to bypass cache and force a fresh lookup
 * @returns {Promise<Object>} - Service instance details
 */
export const discoverService = async (serviceName, tag = null, bypassCache = false) => {
  const cacheKey = `${serviceName}-${tag || 'default'}`;
  
  // Check cache first (unless bypassing)
  if (!bypassCache && serviceCache.has(cacheKey)) {
    const cached = serviceCache.get(cacheKey);
    if (cached.timestamp > Date.now() - CACHE_TTL_MS) {
      return cached.service;
    }
    // Cache expired, will refresh
  }
  
  try {
    const consul = await withRetry(initConsul);
    
    // Get all healthy instances of the service
    const services = await withRetry(async () => {
      const result = await consul.health.service({
        service: serviceName,
        passing: true,
        dc: DATACENTER,
        tag: tag || NODE_ENV
      });
      
      if (!result || result.length === 0) {
        throw new Error(`No healthy instances of ${serviceName} found`);
      }
      
      return result;
    });
    
    // Filter and verify services
    const verifiedServices = [];
    for (const svc of services) {
      const serviceInfo = {
        id: svc.Service.ID,
        name: svc.Service.Service,
        address: svc.Service.Address,
        port: svc.Service.Port,
        tags: svc.Service.Tags
      };
      
      // Double-check health directly for critical services
      if (await verifyServiceHealth(serviceInfo)) {
        verifiedServices.push(serviceInfo);
      }
    }
    
    if (verifiedServices.length === 0) {
      throw new Error(`No verified healthy instances of ${serviceName} found`);
    }
    
    // Load balancing - currently using random selection
    // Can be extended to support round-robin, least connections, etc.
    const randomIndex = Math.floor(Math.random() * verifiedServices.length);
    const selectedService = verifiedServices[randomIndex];
    
    // Update cache
    serviceCache.set(cacheKey, {
      service: selectedService,
      timestamp: Date.now()
    });
    
    return selectedService;
  } catch (error) {
    console.error(`Error discovering service ${serviceName}:`, error);
    
    // Fallback to cached value even if expired
    if (serviceCache.has(cacheKey)) {
      console.warn(`Falling back to cached service information for ${serviceName}`);
      return serviceCache.get(cacheKey).service;
    }
    
    throw new Error(`Service discovery failed: ${error.message}`);
  }
};

/**
 * List all instances of a service
 * @param {string} serviceName - Name of the service
 * @returns {Promise<Array>} - Array of service instances
 */
export const listServiceInstances = async (serviceName) => {
  try {
    const consul = await withRetry(initConsul);
    
    const services = await withRetry(async () => {
      return await consul.health.service({
        service: serviceName,
        passing: true,
        dc: DATACENTER
      });
    });
    
    return services.map(service => ({
      id: service.Service.ID,
      name: service.Service.Service,
      address: service.Service.Address,
      port: service.Service.Port,
      tags: service.Service.Tags
    }));
  } catch (error) {
    console.error(`Error listing instances of service ${serviceName}:`, error);
    throw new Error(`Failed to list service instances: ${error.message}`);
  }
};

/**
 * Manually invalidate the service discovery cache for a specific service
 * @param {string} serviceName - Name of the service
 * @param {string} tag - Optional tag
 */
export const invalidateServiceCache = (serviceName, tag = null) => {
  const cacheKey = `${serviceName}-${tag || 'default'}`;
  serviceCache.delete(cacheKey);
  console.log(`Service cache invalidated for ${cacheKey}`);
};

/**
 * Check if Consul service discovery is available
 * @returns {Promise<boolean>} - Whether Consul is available
 */
export const isServiceDiscoveryAvailable = async () => {
  try {
    const consul = await initConsul();
    await consul.status.leader();
    return true;
  } catch (error) {
    console.error('Service discovery is unavailable:', error.message);
    return false;
  }
};