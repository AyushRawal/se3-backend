// import Document from '../../resources/models/Resource.js';
import Document from '../models/document.js';
import pool from '../db/postgres.js';
import * as esUtils from '../utils/elasticsearch.js';
import {
  publishDocumentCreated,
  publishDocumentUpdated,
  publishDocumentDeleted
} from './documentEventProducer.js';

// Import esClient for services to use
let esClient;

/**
 * Initialize the search service with an Elasticsearch client
 * @param {Object} client - Elasticsearch client instance
 */
export const initializeService = (client) => {
  esClient = client;
};

/**
 * Perform a global search across all indexed documents
 */
export const globalSearch = async (query, options = {}) => {
  try {
    if (!esClient) {
      throw new Error('Elasticsearch client not initialized');
    }
    // Call Elasticsearch for search
    const results = await esUtils.fullTextSearch(query, {}, options, esClient);
    return results;
  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    throw new Error(`Search failed: ${error.message}`);
  }
};

/**
 * Get search suggestions based on partial input
 */
export const getSearchSuggestions = async (prefix, limit = 5) => {
  try {
    if (!esClient) {
      throw new Error('Elasticsearch client not initialized');
    }
    return await esUtils.getSuggestions(prefix, limit, esClient);
  } catch (error) {
    console.error(`Failed to get suggestions: ${error.message}`);
    throw new Error(`Failed to get suggestions: ${error.message}`);
  }
};

/**
 * Perform an advanced search with filters
 */
export const advancedSearch = async (query, filters = {}, options = {}) => {
  try {
    if (!esClient) {
      throw new Error('Elasticsearch client not initialized');
    }

    // Ensure user has access to non-public resources if requested
    if (filters.hasOwnProperty('is_public') && !filters.is_public && options.userId) {
      // Check if user has permission to view non-public documents
      const userAccessResult = await pool.query(
        'SELECT search_permissions FROM user_search_access WHERE user_id = $1',
        [options.userId]
      );

      if (userAccessResult.rows.length === 0 ||
          !userAccessResult.rows[0].search_permissions.canViewNonPublic) {
        // User doesn't have permission to view non-public docs
        filters.is_public = true;
      }
    }

    // Use Elasticsearch for search
    const results = await esUtils.fullTextSearch(query, filters, options, esClient);
    return results;
  } catch (error) {
    console.error(`Advanced search failed: ${error.message}`);
    throw new Error(`Advanced search failed: ${error.message}`);
  }
};

/**
 * Index a document for searching
 * This will store in MongoDB and publish to Kafka for asynchronous indexing
 */
export const createAndIndexDocument = async (documentData) => {
  try {
    // Create document in MongoDB
    const newDocument = new Document(documentData);
    await newDocument.save();

    // Publish document created event to Kafka for asynchronous indexing
    await publishDocumentCreated(newDocument);

    return newDocument;
  } catch (error) {
    console.error(`Failed to create and index document: ${error.message}`);
    throw new Error(`Failed to create and index document: ${error.message}`);
  }
};

/**
 * Update a document and reindex it asynchronously via Kafka
 */
export const updateAndReindexDocument = async (id, documentData) => {
  try {
    // Update document in MongoDB
    const updatedDoc = await Document.findByIdAndUpdate(
      id,
      { ...documentData, is_indexed: false },
      { new: true }
    );

    if (!updatedDoc) {
      throw new Error('Document not found');
    }

    // Publish document updated event to Kafka for asynchronous indexing
    await publishDocumentUpdated(id, documentData);

    return updatedDoc;
  } catch (error) {
    console.error(`Failed to update and reindex document: ${error.message}`);
    throw new Error(`Failed to update document: ${error.message}`);
  }
};

/**
 * Remove a document from the index asynchronously via Kafka
 */
export const removeDocument = async (id) => {
  try {
    // Delete from MongoDB
    const deletedDoc = await Document.findByIdAndDelete(id);

    if (!deletedDoc) {
      throw new Error('Document not found');
    }

    // Publish document deleted event to Kafka for asynchronous removal from index
    await publishDocumentDeleted(id);

    return { success: true, id };
  } catch (error) {
    console.error(`Failed to remove document: ${error.message}`);
    throw new Error(`Failed to remove document: ${error.message}`);
  }
};

/**
 * Run the sync process to index any unindexed documents
 */
export const syncIndex = async () => {
  try {
    if (!esClient) {
      throw new Error('Elasticsearch client not initialized');
    }

    // Get all unindexed documents
    const unindexedDocs = await Document.find({ is_indexed: false });

    // Publish events for each unindexed document
    const publishPromises = unindexedDocs.map(doc => publishDocumentCreated(doc));

    await Promise.all(publishPromises);

    return {
      success: true,
      count: unindexedDocs.length,
      message: `Queued ${unindexedDocs.length} documents for indexing`
    };
  } catch (error) {
    console.error(`Failed to sync index: ${error.message}`);
    throw new Error(`Failed to sync index: ${error.message}`);
  }
};
