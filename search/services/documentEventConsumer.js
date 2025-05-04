import { createConsumer, subscribeToTopics } from '../../shared/kafka/client.js';
import { TOPICS } from '../../shared/kafka/config.js';
import { 
  indexDocument, 
  updateIndexedDocument, 
  removeDocumentFromIndex 
} from '../utils/elasticsearch.js';
import Document from '../models/document.js';

/**
 * Start the document event consumer
 * @param {Object} esClient - Elasticsearch client instance
 */
export const startDocumentEventConsumers = async (esClient) => {
  try {
    // Create a consumer for document events
    const consumer = await createConsumer('search-document-indexer');
    
    // Subscribe to document events
    await subscribeToTopics(
      consumer,
      [TOPICS.DOCUMENT_CREATED, TOPICS.DOCUMENT_UPDATED, TOPICS.DOCUMENT_DELETED],
      async (message) => {
        const { topic, value } = message;
        
        switch (topic) {
          case TOPICS.DOCUMENT_CREATED:
            await handleDocumentCreated(value, esClient);
            break;
          case TOPICS.DOCUMENT_UPDATED:
            await handleDocumentUpdated(value, esClient);
            break;
          case TOPICS.DOCUMENT_DELETED:
            await handleDocumentDeleted(value, esClient);
            break;
        }
      }
    );
    
    console.log('Document event consumers started successfully');
    return consumer;
  } catch (error) {
    console.error('Failed to start document event consumers:', error);
    throw error;
  }
};

/**
 * Handle document created event
 * @param {Object} event - Document created event
 * @param {Object} esClient - Elasticsearch client
 */
const handleDocumentCreated = async (event, esClient) => {
  try {
    const { id, document } = event;
    console.log(`Processing document created event for ID: ${id}`);
    
    // Find the document in MongoDB to ensure it exists
    const storedDocument = await Document.findById(id);
    if (!storedDocument) {
      console.warn(`Document ${id} not found in database, skipping indexing`);
      return;
    }
    
    // Index the document in Elasticsearch
    await indexDocument(storedDocument, esClient);
    console.log(`Document ${id} indexed successfully`);
  } catch (error) {
    console.error('Error handling document created event:', error);
  }
};

/**
 * Handle document updated event
 * @param {Object} event - Document updated event
 * @param {Object} esClient - Elasticsearch client
 */
const handleDocumentUpdated = async (event, esClient) => {
  try {
    const { id, updates } = event;
    console.log(`Processing document updated event for ID: ${id}`);
    
    // Find the updated document in MongoDB
    const storedDocument = await Document.findById(id);
    if (!storedDocument) {
      console.warn(`Document ${id} not found in database, skipping update`);
      return;
    }
    
    // Update the document in Elasticsearch
    await updateIndexedDocument(id, storedDocument, esClient);
    console.log(`Document ${id} updated in index successfully`);
  } catch (error) {
    console.error('Error handling document updated event:', error);
  }
};

/**
 * Handle document deleted event
 * @param {Object} event - Document deleted event
 * @param {Object} esClient - Elasticsearch client
 */
const handleDocumentDeleted = async (event, esClient) => {
  try {
    const { id } = event;
    console.log(`Processing document deleted event for ID: ${id}`);
    
    // Remove document from Elasticsearch index
    await removeDocumentFromIndex(id, esClient);
    console.log(`Document ${id} removed from index successfully`);
  } catch (error) {
    console.error('Error handling document deleted event:', error);
  }
};