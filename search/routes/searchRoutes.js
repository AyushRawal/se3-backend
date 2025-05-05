import express from 'express';
import * as searchController from '../controllers/searchController.js';
import { authenticate, optionalAuthenticate, authorizeAdmin } from '../middleware/auth.js';

const router = express.Router();

// Public routes with optional authentication
// This allows personalized results for authenticated users while still working for anonymous users
router.get('/', optionalAuthenticate, searchController.globalSearch);
router.get('/suggestions', optionalAuthenticate, searchController.getSearchSuggestions);
router.get('/advanced', optionalAuthenticate, searchController.advancedSearch);

// Private routes (require authentication)
// router.post('/documents', authenticate, searchController.indexDocument);
// router.put('/documents/:id', authenticate, searchController.updateDocument);
// router.delete('/documents/:id', authenticate, searchController.deleteDocument);

// Admin routes
router.post('/sync', authorizeAdmin, searchController.syncIndex);

export default router;
