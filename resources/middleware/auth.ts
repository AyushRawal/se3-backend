import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

// Define user interface for request augmentation
interface User {
  id: string;
  user_id: string;
  role: string;
  email: string;
}

// Augment Express Request to include user property
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Extract user information from headers set by API Gateway
 * Requires authentication, and will reject requests without credentials
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
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
      id: userId.toString(),
      user_id: userId.toString(), // For compatibility
      role: userRole?.toString() || 'user',
      email: userEmail?.toString() || ''
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
export const optionalAuthenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get user info from headers set by API Gateway
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const userEmail = req.headers['x-user-email'];

    if (userId) {
      // Set user info for downstream use if available
      req.user = {
        id: userId.toString(),
        user_id: userId.toString(), // For compatibility
        role: userRole?.toString() || 'user',
        email: userEmail?.toString() || ''
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
 * Requires prior authentication
 */
export const authorizeAdmin = (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    next();
  } catch (error) {
    console.error('Admin authorization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authorization failed.'
    });
  }
};