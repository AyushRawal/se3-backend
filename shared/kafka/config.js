import dotenv from 'dotenv';
import KafkaJS from 'kafkajs';
dotenv.config();

export const KAFKA_BROKERS = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'];
export const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || 'knowledge-garden';
export const KAFKA_GROUP_ID_PREFIX = process.env.KAFKA_GROUP_ID_PREFIX || 'kg';

// Define topics
export const TOPICS = {
  DOCUMENT_CREATED: 'document.created',
  DOCUMENT_UPDATED: 'document.updated',
  DOCUMENT_DELETED: 'document.deleted',
  USER_ACTIVITY: 'user.activity',
  SEARCH_INDEX_REQUEST: 'search.index.request',
  NOTIFICATION: 'notification'
};

export const DEFAULT_TOPIC_CONFIG = {
  // For development - fewer partitions
  numPartitions: 3,
  replicationFactor: 1
};

// Common consumer configuration
export const getConsumerConfig = (groupId, fromBeginning = false) => ({
  groupId: `${KAFKA_GROUP_ID_PREFIX}-${groupId}`,
  sessionTimeout: 15000,
  heartbeatInterval: 5000,
  allowAutoTopicCreation: true,
  retry: {
    initialRetryTime: 100,
    retries: 8
  },
  fromBeginning
});

// Common producer configuration
export const PRODUCER_CONFIG = {
  createPartitioner: KafkaJS.Partitioners.DefaultPartitioner,
  allowAutoTopicCreation: true,
  idempotent: true,
  retry: {
    initialRetryTime: 100,
    retries: 5
  }
};
