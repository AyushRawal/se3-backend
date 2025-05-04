import { Kafka } from 'kafkajs';
import { 
  KAFKA_BROKERS, 
  KAFKA_CLIENT_ID,
  PRODUCER_CONFIG,
  getConsumerConfig,
  DEFAULT_TOPIC_CONFIG,
  TOPICS
} from './config.js';

// Singleton instance
let kafkaInstance = null;
let producerInstance = null;
let consumers = new Map();

/**
 * Get Kafka instance (singleton)
 */
export const getKafka = () => {
  if (!kafkaInstance) {
    kafkaInstance = new Kafka({
      clientId: KAFKA_CLIENT_ID,
      brokers: KAFKA_BROKERS,
      retry: {
        initialRetryTime: 300,
        retries: 10
      }
    });
  }
  return kafkaInstance;
};

/**
 * Get Kafka producer (singleton)
 */
export const getProducer = async () => {
  if (!producerInstance) {
    const kafka = getKafka();
    producerInstance = kafka.producer(PRODUCER_CONFIG);
    await producerInstance.connect();
    console.log('Kafka producer connected');
    
    // Handle producer disconnects
    producerInstance.on('producer.disconnect', () => {
      console.warn('Kafka producer disconnected');
      // We'll recreate on next use
      producerInstance = null;
    });
  }
  return producerInstance;
};

/**
 * Send message to Kafka topic
 * @param {string} topic - Kafka topic
 * @param {object} message - Message to send
 * @param {string} key - Optional message key
 * @returns {Promise<RecordMetadata>}
 */
export const sendMessage = async (topic, message, key = null) => {
  const producer = await getProducer();
  
  const messageValue = typeof message === 'string' 
    ? message 
    : JSON.stringify(message);
    
  const messagePayload = {
    topic,
    messages: [{
      value: messageValue,
      ...(key && { key })
    }]
  };

  return await producer.send(messagePayload);
};

/**
 * Create a Kafka consumer
 * @param {string} groupId - Consumer group ID
 * @param {boolean} fromBeginning - Whether to read from beginning
 * @returns {Consumer} Kafka consumer
 */
export const createConsumer = async (groupId, fromBeginning = false) => {
  const kafka = getKafka();
  const consumer = kafka.consumer(getConsumerConfig(groupId, fromBeginning));
  await consumer.connect();
  console.log(`Kafka consumer [${groupId}] connected`);
  
  consumers.set(groupId, consumer);
  return consumer;
};

/**
 * Subscribe consumer to topics and handle messages
 * @param {Consumer} consumer - Kafka consumer
 * @param {Array<string>} topics - Topics to subscribe to
 * @param {Function} handleMessage - Message handler function
 */
export const subscribeToTopics = async (consumer, topics, handleMessage) => {
  // Subscribe to topics
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }
  
  // Start consuming
  await consumer.run({
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      try {
        let parsedMessage;
        
        try {
          parsedMessage = JSON.parse(message.value.toString());
        } catch (e) {
          parsedMessage = message.value.toString();
        }
        
        await handleMessage({
          topic,
          partition,
          key: message.key?.toString(),
          value: parsedMessage,
          headers: message.headers,
          timestamp: message.timestamp,
          heartbeat
        });
      } catch (error) {
        console.error(`Error processing Kafka message from ${topic}:`, error);
      }
    }
  });
};

/**
 * Create topics if they don't exist
 */
export const createTopicsIfNotExist = async () => {
  const kafka = getKafka();
  const admin = kafka.admin();
  
  try {
    await admin.connect();
    console.log('Kafka admin connected');
    
    const topics = Object.values(TOPICS);
    const existingTopics = await admin.listTopics();
    
    const topicsToCreate = topics.filter(topic => !existingTopics.includes(topic));
    
    if (topicsToCreate.length > 0) {
      await admin.createTopics({
        topics: topicsToCreate.map(topic => ({
          topic,
          ...DEFAULT_TOPIC_CONFIG
        }))
      });
      
      console.log(`Created Kafka topics: ${topicsToCreate.join(', ')}`);
    } else {
      console.log('All Kafka topics already exist');
    }
  } catch (error) {
    console.error('Error creating Kafka topics:', error);
  } finally {
    await admin.disconnect();
  }
};

/**
 * Graceful shutdown of all Kafka connections
 */
export const disconnectAll = async () => {
  const shutdownPromises = [];
  
  if (producerInstance) {
    shutdownPromises.push(producerInstance.disconnect());
  }
  
  for (const [groupId, consumer] of consumers.entries()) {
    shutdownPromises.push(
      consumer.disconnect()
        .then(() => console.log(`Consumer ${groupId} disconnected`))
        .catch(e => console.error(`Error disconnecting consumer ${groupId}:`, e))
    );
  }
  
  await Promise.all(shutdownPromises);
  console.log('All Kafka connections closed');
  
  // Reset instances
  kafkaInstance = null;
  producerInstance = null;
  consumers.clear();
};

// Handle graceful shutdown
const registerShutdown = () => {
  const shutdown = async () => {
    console.log('Shutting down Kafka connections...');
    await disconnectAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

registerShutdown();