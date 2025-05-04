import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const SECRET_KEY = process.env.JWT_SECRET || 'yourSecretKey';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    
    // Standardize the user object with both id and user_id fields
    req.user = {
      ...decoded,
      id: decoded.id || decoded.user_id, // Ensure id is always available
    };
    
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Optional middleware for routes that can be accessed with or without authentication
export const optionalAuthenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next(); // Continue without setting req.user
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    
    // Standardize the user object with both id and user_id fields
    req.user = {
      ...decoded,
      id: decoded.id || decoded.user_id, // Ensure id is always available
    };
  } catch (error) {
    // Invalid token but continue anyway
    console.error('Token validation failed:', error.message);
  }
  
  next();
};