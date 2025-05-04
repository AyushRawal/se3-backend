import { sendMessage } from '../../shared/kafka/client.js';
import { TOPICS } from '../../shared/kafka/config.js';

/**
 * Publish document created event to Kafka
 * @param {Object} document - The created document
 */
export const publishDocumentCreated = async (document) => {
  try {
    const payload = {
      id: document._id.toString(),
      document: {
        title: document.title,
        description: document.description,
        content: document.content,
        resourceType: document.resourceType,
        tags: document.tags,
        categories: document.categories,
        owner_id: document.owner_id,
        is_public: document.is_public,
        created_at: document.created_at,
        updated_at: document.updated_at
      },
      timestamp: new Date().toISOString()
    };

    await sendMessage(
      TOPICS.DOCUMENT_CREATED, 
      payload, 
      document._id.toString()
    );
    
    console.log(`Document created event published for document ID: ${document._id}`);
    return true;
  } catch (error) {
    console.error('Error publishing document created event:', error);
    return false;
  }
};

/**
 * Publish document updated event to Kafka
 * @param {string} documentId - The document ID
 * @param {Object} updates - The updates applied to the document
 */
export const publishDocumentUpdated = async (documentId, updates) => {
  try {
    const payload = {
      id: documentId,
      updates,
      timestamp: new Date().toISOString()
    };

    await sendMessage(
      TOPICS.DOCUMENT_UPDATED, 
      payload, 
      documentId
    );
    
    console.log(`Document updated event published for document ID: ${documentId}`);
    return true;
  } catch (error) {
    console.error('Error publishing document updated event:', error);
    return false;
  }
};

/**
 * Publish document deleted event to Kafka
 * @param {string} documentId - The document ID
 */
export const publishDocumentDeleted = async (documentId) => {
  try {
    const payload = {
      id: documentId,
      timestamp: new Date().toISOString()
    };

    await sendMessage(
      TOPICS.DOCUMENT_DELETED, 
      payload, 
      documentId
    );
    
    console.log(`Document deleted event published for document ID: ${documentId}`);
    return true;
  } catch (error) {
    console.error('Error publishing document deleted event:', error);
    return false;
  }
};