import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Extract user information from headers
 * This middleware relies on the API Gateway for authentication
 * It extracts user information from custom headers set by the gateway
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get user info from headers set by API Gateway
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const userEmail = req.headers['x-user-email'];

    if (!userId) {
      return res.status(401).json({ 
        success: false,
        error: 'Access denied. Authentication required.' 
      });
    }

    // Set user info for downstream use
    req.user = {
      id: userId,
      role: userRole,
      email: userEmail
    };
    
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Authentication processing failed.' 
    });
  }
};

/**
 * Optional authentication middleware that allows requests to proceed
 * even without authentication but sets user info if available
 */
export const optionalAuthenticate = async (req, res, next) => {
  try {
    // Get user info from headers set by API Gateway
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const userEmail = req.headers['x-user-email'];

    if (userId) {
      // Set user info for downstream use if available
      req.user = {
        id: userId,
        role: userRole,
        email: userEmail
      };
    }
    
    next();
  } catch (error) {
    // Continue without setting user info
    console.error('Optional authentication error:', error);
    next();
  }
};

/**
 * Check if the user has admin privileges
 * Based on role information from API Gateway headers
 */
export const authorizeAdmin = async (req, res, next) => {
  try {
    // First authenticate to extract user info
    authenticate(req, res, () => {
      // Check if user is admin
      if (req.user && req.user.role === 'admin') {
        next();
      } else {
        return res.status(403).json({ 
          success: false,
          error: 'Access denied. Admin privileges required.' 
        });
      }
    });
  } catch (error) {
    console.error('Admin authorization error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Authorization failed.' 
    });
  }
};