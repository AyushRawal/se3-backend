import * as searchService from '../services/searchService.js';

/**
 * Perform a global search across all indexed documents
 * @route GET /api/search
 * @access Public with optional authentication
 */
export const globalSearch = async (req, res) => {
  try {
    const { q, limit = 10, page = 1 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }
    
    const size = parseInt(limit);
    const from = (parseInt(page) - 1) * size;
    
    // Pass user ID if available for personalized results
    const userId = req.user ? req.user.id : null;
    const results = await searchService.globalSearch(q, { size, from, userId });
    
    return res.json({
      success: true,
      data: results,
      meta: {
        authenticated: !!userId,
        page: parseInt(page),
        limit: size
      }
    });
  } catch (error) {
    console.error('Global search error:', error);
    return res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
};

/**
 * Get search suggestions based on partial input
 * @route GET /api/search/suggestions
 * @access Public with optional authentication
 */
export const getSearchSuggestions = async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search prefix is required'
      });
    }
    
    // Pass user ID if available for personalized suggestions
    const userId = req.user ? req.user.id : null;
    const suggestions = await searchService.getSearchSuggestions(q, parseInt(limit), userId);
    
    return res.json({
      success: true,
      data: suggestions,
      meta: {
        authenticated: !!userId
      }
    });
  } catch (error) {
    console.error('Search suggestions error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get suggestions'
    });
  }
};

/**
 * Perform an advanced search with filters
 * @route GET /api/search/advanced
 * @access Public
 */
export const advancedSearch = async (req, res) => {
  try {
    const { q, limit = 10, page = 1 } = req.query;
    let filters = {};
    
    // Extract filters from query parameters
    const possibleFilters = ['resourceType', 'tags', 'categories', 'is_public', 'is_featured'];
    
    possibleFilters.forEach(filter => {
      if (req.query[filter]) {
        if (filter === 'tags' || filter === 'categories') {
          filters[filter] = Array.isArray(req.query[filter]) 
            ? req.query[filter] 
            : req.query[filter].split(',');
        } else if (filter === 'is_public' || filter === 'is_featured') {
          filters[filter] = req.query[filter] === 'true';
        } else {
          filters[filter] = req.query[filter];
        }
      }
    });
    
    const size = parseInt(limit);
    const from = (parseInt(page) - 1) * size;
    const userId = req.user ? req.user.id : null;
    
    const results = await searchService.advancedSearch(q, filters, { size, from, userId });
    
    return res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Advanced search error:', error);
    return res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
};

/**
 * Index a document for searching
 * @route POST /api/search/documents
 * @access Private
 */
export const indexDocument = async (req, res) => {
  try {
    // Ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    // Set owner ID to the authenticated user
    const documentData = {
      ...req.body,
      owner_id: req.user.id
    };
    
    const newDocument = await searchService.createAndIndexDocument(documentData);
    
    return res.status(201).json({
      success: true,
      data: newDocument
    });
  } catch (error) {
    console.error('Document indexing error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to index document'
    });
  }
};

/**
 * Update an indexed document
 * @route PUT /api/search/documents/:id
 * @access Private
 */
export const updateDocument = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const updatedDoc = await searchService.updateAndReindexDocument(id, req.body);
    
    return res.json({
      success: true,
      data: updatedDoc
    });
  } catch (error) {
    console.error('Document update error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update document'
    });
  }
};

/**
 * Delete a document from the index
 * @route DELETE /api/search/documents/:id
 * @access Private
 */
export const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const result = await searchService.removeDocument(id);
    
    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Document deletion error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete document'
    });
  }
};

/**
 * Sync unindexed documents to Elasticsearch
 * @route POST /api/search/sync
 * @access Private (Admin)
 */
export const syncIndex = async (req, res) => {
  try {
    // Ensure user is admin
    if (!req.user || !req.user.role === 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    const result = await searchService.syncIndex();
    
    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Index sync error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync index'
    });
  }
};