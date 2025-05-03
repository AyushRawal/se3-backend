import { Kafka, Producer } from 'kafkajs';
import { IResource } from '../models/Resource';
import dotenv from 'dotenv';

dotenv.config();

// Setup Kafka producer as a singleton
let producer: Producer | null = null;

// Kafka configuration
const kafka = new Kafka({
  clientId: 'resource-service',
  brokers: [process.env.KAFKA_BROKER as string],
});

/**
 * Initialize Kafka producer and connect to brokers
 * @returns Promise<Producer>
 */
export const getProducer = async (): Promise<Producer> => {
  if (!producer) {
    producer = kafka.producer();
    await producer.connect();
    console.log('Connected to Kafka for document event production');
  }
  return producer;
};

/**
 * Publish document created event to Kafka
 * @param document The created document
 */
export const publishDocumentCreated = async (document: IResource): Promise<boolean> => {
  try {
    const kafkaProducer = await getProducer();
    
    const payload = {
      id: document._id.toString(),
      document: {
        title: document.title,
        description: document.description,
        content: '', // No content for file resources
        resourceType: document.resourceType,
        tags: document.tags,
        categories: document.categories,
        owner_id: document.owner_id,
        is_public: document.is_public,
        file_path: document.file_path,
        file_size: document.file_size,
        mime_type: document.mime_type,
        created_at: document.created_at,
        updated_at: document.updated_at
      },
      timestamp: new Date().toISOString()
    };

    await kafkaProducer.send({
      topic: process.env.DOCUMENT_TOPIC || 'document.created',
      messages: [
        { 
          value: JSON.stringify(payload),
          key: document._id.toString()
        }
      ]
    });
    
    console.log(`Document created event published for document ID: ${document._id}`);
    return true;
  } catch (error) {
    console.error('Error publishing document created event:', error);
    return false;
  }
};

/**
 * Publish document updated event to Kafka
 * @param documentId The document ID
 * @param updates The updates applied to the document
 */
export const publishDocumentUpdated = async (documentId: string, updates: Partial<IResource>): Promise<boolean> => {
  try {
    const kafkaProducer = await getProducer();
    
    const payload = {
      id: documentId,
      updates,
      timestamp: new Date().toISOString()
    };

    await kafkaProducer.send({
      topic: process.env.DOCUMENT_UPDATED_TOPIC || 'document.updated',
      messages: [
        { 
          value: JSON.stringify(payload),
          key: documentId
        }
      ]
    });
    
    console.log(`Document updated event published for document ID: ${documentId}`);
    return true;
  } catch (error) {
    console.error('Error publishing document updated event:', error);
    return false;
  }
};

/**
 * Publish document deleted event to Kafka
 * @param documentId The document ID
 */
export const publishDocumentDeleted = async (documentId: string): Promise<boolean> => {
  try {
    const kafkaProducer = await getProducer();
    
    const payload = {
      id: documentId,
      timestamp: new Date().toISOString()
    };

    await kafkaProducer.send({
      topic: process.env.DOCUMENT_DELETED_TOPIC || 'document.deleted',
      messages: [
        { 
          value: JSON.stringify(payload),
          key: documentId
        }
      ]
    });
    
    console.log(`Document deleted event published for document ID: ${documentId}`);
    return true;
  } catch (error) {
    console.error('Error publishing document deleted event:', error);
    return false;
  }
};

/**
 * Disconnect the Kafka producer
 */
export const disconnectProducer = async (): Promise<void> => {
  if (producer) {
    await producer.disconnect();
    producer = null;
    console.log('Disconnected from Kafka document event producer');
  }
};