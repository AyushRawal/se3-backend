// service-discovery.js - Shared module for service discovery across microservices
import Consul from 'consul';
import dotenv from 'dotenv';
import os from 'os';

dotenv.config();

// Default Consul configuration
const CONSUL_HOST = process.env.CONSUL_HOST || '10.1.37.28';
const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATACENTER = process.env.CONSUL_DC || 'dc1';
const MAX_RETRIES = parseInt(process.env.CONSUL_MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.CONSUL_RETRY_DELAY_MS || '1000', 10);
const CACHE_TTL_MS = parseInt(process.env.CONSUL_CACHE_TTL_MS || '5000', 10);
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

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

    // Register the service - make sure we always add the NODE_ENV as a tag
    await consul.agent.service.register({
      id: serviceId,
      name: serviceName,
      address: ipAddress,
      port: parseInt(port, 10),
      tags: [...tags, NODE_ENV]
      // Removed health check configuration here
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
 * Debug helper to log service discovery steps
 * @param {string} message - Debug message
 * @param {any} data - Optional data to log
 */
const debugLog = (message, data = null) => {
  if (DEBUG_MODE) {
    console.log(`[Service Discovery] ${message}`);
    if (data) {
      console.log(data);
    }
  }
};

/**
 * Discover a service from Consul with caching
 * @param {string} serviceName - Name of the service to discover
 * @param {string} tag - Optional tag to filter services
 * @param {boolean} bypassCache - Whether to bypass cache and force a fresh lookup
 * @returns {Promise<Object>} - Service instance details
 */
export const discoverService = async (serviceName, tag = null, bypassCache = false) => {
  const cacheKey = `${serviceName}-${tag || 'default'}`;
  debugLog(`Discovering service ${serviceName} with tag ${tag || 'none'}`);

  // Check cache first (unless bypassing)
  if (!bypassCache && serviceCache.has(cacheKey)) {
    const cached = serviceCache.get(cacheKey);
    if (cached.timestamp > Date.now() - CACHE_TTL_MS) {
      debugLog(`Using cached service data for ${serviceName}`, cached.service);
      return cached.service;
    }
    debugLog(`Cache expired for ${serviceName}`);
  }

  try {
    const consul = await withRetry(initConsul);

    // Prepare query parameters - only add tag filter if explicitly provided
    const queryParams = {
      service: serviceName,
      dc: DATACENTER
    };

    // Only apply tag filtering if explicitly requested
    if (tag) {
      queryParams.tag = tag;
    }

    debugLog(`Consul query parameters:`, queryParams);

    // Get all instances of the service without health check filtering
    const services = await withRetry(async () => {
      // Use catalog.service.nodes instead of health.service to avoid health filtering
      const result = await consul.catalog.service.nodes(queryParams);

      debugLog(`Consul returned ${result.length} services`);

      if (!result || result.length === 0) {
        throw new Error(`No instances of ${serviceName} found in Consul`);
      }

      return result;
    });

    // Extract service information
    const verifiedServices = services.map(svc => ({
      id: svc.ServiceID,
      name: svc.ServiceName,
      address: svc.ServiceAddress || svc.Address,
      port: svc.ServicePort,
      tags: svc.ServiceTags || []
    }));

    debugLog(`Extracted ${verifiedServices.length} service instances:`, verifiedServices);

    // Load balancing - currently using random selection
    const randomIndex = Math.floor(Math.random() * verifiedServices.length);
    const selectedService = verifiedServices[randomIndex];

    debugLog(`Selected service instance: ${selectedService.id}`);

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

    throw new Error(`Service discovery failed for ${serviceName}: ${error.message}`);
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

    const queryParams = {
      service: serviceName,
      dc: DATACENTER
    };

    const services = await withRetry(async () => {
      return await consul.catalog.service.nodes(queryParams);
    });

    return services.map(service => ({
      id: service.ServiceID,
      name: service.ServiceName,
      address: service.ServiceAddress || service.Address,
      port: service.ServicePort,
      tags: service.ServiceTags || []
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

/**
 * Troubleshoot service discovery issues
 * @param {string} serviceName - Name of the service to troubleshoot
 * @returns {Promise<Object>} - Diagnostic information
 */
export const troubleshootService = async (serviceName) => {
  try {
    const consul = await withRetry(initConsul);
    const diagnostics = {
      consulStatus: 'connected',
      allServices: [],
      serviceInstances: []
    };

    // Get all registered services
    diagnostics.allServices = Object.keys(await consul.catalog.service.list());
    console.log(`Found ${diagnostics.allServices.length} registered services`);

    // Check if our target service exists at all
    const serviceExists = diagnostics.allServices.includes(serviceName);
    diagnostics.serviceFound = serviceExists;

    if (serviceExists) {
      // Get all instances of the service regardless of health
      const instances = await consul.catalog.service.nodes({ service: serviceName });
      diagnostics.serviceInstances = instances;
    }

    return diagnostics;
  } catch (error) {
    console.error(`Error troubleshooting service ${serviceName}:`, error);
    return {
      consulStatus: 'error',
      error: error.message
    };
  }
};

const testServiceDiscovery = async () => {
  const serviceName = 'auth-service';

  try {
    console.log(`Attempting to discover service: ${serviceName}`);
    const service = await discoverService(serviceName, null, true); // force fresh lookup

    console.log(`✅ Service discovered successfully:`);
    console.log(`  - ID: ${service.id}`);
    console.log(`  - Address: ${service.address}`);
    console.log(`  - Port: ${service.port}`);
    console.log(`  - Full URL: http://${service.address}:${service.port}/health`);
  } catch (error) {
    console.error(`❌ Failed to discover service "${serviceName}":`, error.message);
  }
};

testServiceDiscovery();
