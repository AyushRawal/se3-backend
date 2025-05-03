import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';
import Document from '../models/document.js';

dotenv.config();

// Elasticsearch index configuration
const INDEX_NAME = 'knowledge_garden_documents';

/**
 * Setup and configure Elasticsearch client
 * @returns {Client} Configured Elasticsearch client
 */
export const setupElasticsearch = () => {
  const esClient = new Client({
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    auth: process.env.ELASTICSEARCH_USERNAME ? {
      username: process.env.ELASTICSEARCH_USERNAME,
      password: process.env.ELASTICSEARCH_PASSWORD
    } : undefined,
    ssl: {
      rejectUnauthorized: false
    }
  });

  // Initialize indices when setting up
  initializeIndices(esClient)
    .then(result => {
      if (result) {
        console.log('Elasticsearch indices initialized successfully');
      }
    })
    .catch(err => {
      console.error('Failed to initialize Elasticsearch indices:', err);
    });

  return esClient;
};

/**
 * Initialize Elasticsearch indices and mappings
 */
export const initializeIndices = async (esClient) => {
  try {
    const indexExists = await esClient.indices.exists({ index: INDEX_NAME });
    
    if (!indexExists) {
      await esClient.indices.create({
        index: INDEX_NAME,
        body: {
          settings: {
            analysis: {
              analyzer: {
                custom_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'asciifolding', 'synonym']
                }
              },
              filter: {
                synonym: {
                  type: 'synonym',
                  synonyms: [
                    'university, college',
                    'assignment, homework, task',
                    'lecture, class, course'
                  ]
                }
              }
            }
          },
          mappings: {
            properties: {
              title: { 
                type: 'text',
                analyzer: 'custom_analyzer',
                fields: {
                  keyword: {
                    type: 'keyword'
                  }
                }
              },
              description: { 
                type: 'text',
                analyzer: 'custom_analyzer'
              },
              content: {
                type: 'text',
                analyzer: 'custom_analyzer'
              },
              resourceType: { 
                type: 'keyword'
              },
              tags: { 
                type: 'keyword'
              },
              categories: { 
                type: 'keyword'
              },
              owner_id: {
                type: 'integer'
              },
              is_public: {
                type: 'boolean'
              },
              view_count: {
                type: 'integer'
              },
              download_count: {
                type: 'integer'
              },
              average_rating: {
                type: 'float'
              },
              is_featured: {
                type: 'boolean'
              },
              created_at: {
                type: 'date'
              },
              updated_at: {
                type: 'date'
              }
            }
          }
        }
      });
      console.log(`Created Elasticsearch index: ${INDEX_NAME}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Elasticsearch initialization error: ${error.message}`);
    return false;
  }
};

/**
 * Index a document in Elasticsearch
 */
export const indexDocument = async (document, esClient) => {
  try {
    await esClient.index({
      index: INDEX_NAME,
      id: document._id.toString(),
      document: {
        title: document.title,
        description: document.description || '',
        content: document.content,
        resourceType: document.resourceType,
        tags: document.tags || [],
        categories: document.categories || [],
        owner_id: document.owner_id,
        is_public: document.is_public,
        view_count: document.view_count,
        download_count: document.download_count,
        average_rating: document.average_rating,
        is_featured: document.is_featured,
        created_at: document.created_at,
        updated_at: document.updated_at
      }
    });
    
    // Mark document as indexed in MongoDB
    await Document.findByIdAndUpdate(
      document._id,
      { is_indexed: true }
    );
    
    return true;
  } catch (error) {
    console.error(`Error indexing document: ${error.message}`);
    return false;
  }
};

/**
 * Perform a full-text search
 */
export const fullTextSearch = async (searchText, filters = {}, options = {}, esClient) => {
  try {
    const { size = 10, from = 0 } = options;
    
    // Build query
    const should = [
      {
        multi_match: {
          query: searchText,
          fields: ['title^3', 'description^2', 'content', 'tags^2', 'categories'],
          type: 'best_fields',
          operator: 'or',
          fuzziness: 'AUTO'
        }
      },
      {
        multi_match: {
          query: searchText,
          fields: ['title.keyword^4', 'tags^3'],
          type: 'phrase',
          boost: 2
        }
      }
    ];
    
    // Build filters
    const must = [];
    const filterClauses = [];
    
    // Always filter for public documents unless explicitly specified
    if (!filters.hasOwnProperty('is_public')) {
      filterClauses.push({ term: { is_public: true } });
    }
    
    // Add other filters
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        filterClauses.push({ terms: { [key]: value } });
      } else {
        filterClauses.push({ term: { [key]: value } });
      }
    }
    
    const query = {
      bool: {
        should,
        filter: filterClauses,
        minimum_should_match: 1
      }
    };
    
    // Highlighting configuration
    const highlight = {
      fields: {
        title: {},
        description: {},
        content: { fragment_size: 150, number_of_fragments: 3 }
      },
      pre_tags: ['<strong>'],
      post_tags: ['</strong>']
    };
    
    // Aggregations for faceted search
    const aggregations = {
      resource_types: {
        terms: { field: 'resourceType' }
      },
      categories: {
        terms: { field: 'categories', size: 20 }
      },
      tags: {
        terms: { field: 'tags', size: 30 }
      },
      avg_rating: {
        avg: { field: 'average_rating' }
      }
    };
    
    const response = await esClient.search({
      index: INDEX_NAME,
      body: {
        query,
        highlight,
        aggregations,
        size,
        from
      }
    });
    
    return {
      total: response.hits.total.value,
      hits: response.hits.hits.map(hit => ({
        id: hit._id,
        score: hit._score,
        highlight: hit.highlight,
        ...hit._source
      })),
      aggregations: response.aggregations
    };
  } catch (error) {
    console.error(`Error in full-text search: ${error.message}`);
    throw error;
  }
};

/**
 * Get search suggestions based on partial input
 */
export const getSuggestions = async (prefix, size = 5, esClient) => {
  try {
    const fields = ['title', 'tags'];
    
    const response = await esClient.search({
      index: INDEX_NAME,
      body: {
        size: 50,
        query: {
          bool: {
            should: fields.map(field => ({
              wildcard: {
                [field]: {
                  value: `${prefix}*`,
                  boost: field === 'title' ? 2 : 1
                }
              }
            }))
          }
        }
      }
    });
    
    const suggestions = new Set();
    response.hits.hits.forEach(hit => {
      fields.forEach(field => {
        const value = hit._source[field];
        if (value && typeof value === 'string' && 
            value.toLowerCase().includes(prefix.toLowerCase())) {
          suggestions.add(value);
        } else if (Array.isArray(value)) {
          value.forEach(v => {
            if (typeof v === 'string' && v.toLowerCase().includes(prefix.toLowerCase())) {
              suggestions.add(v);
            }
          });
        }
      });
    });
    
    return Array.from(suggestions).slice(0, size);
  } catch (error) {
    console.error(`Error getting suggestions: ${error.message}`);
    throw error;
  }
};

/**
 * Sync documents from MongoDB to Elasticsearch
 * Used to index documents that haven't been indexed yet
 */
export const syncDocumentsToElasticsearch = async (esClient) => {
  try {
    // Find documents that aren't indexed yet
    const unindexedDocs = await Document.find({ is_indexed: false });
    
    if (unindexedDocs.length === 0) {
      console.log('No documents to index');
      return { indexed: 0 };
    }
    
    let successCount = 0;
    
    for (const doc of unindexedDocs) {
      const success = await indexDocument(doc, esClient);
      if (success) successCount++;
    }
    
    console.log(`Indexed ${successCount} documents`);
    return { indexed: successCount };
  } catch (error) {
    console.error(`Error syncing documents to Elasticsearch: ${error.message}`);
    throw error;
  }
};