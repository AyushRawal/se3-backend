import { registerUser, loginUser, getUserById, verifyTokenValidity } from '../services/authService.js';

export const register = async (req, res) => {
  try {
    const user = await registerUser(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    // Collect metadata about the request for analytics
    const requestMetadata = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    };
    
    const token = await loginUser(req.body, requestMetadata);
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    // The user_id comes from middleware that extracts it from the JWT
    const userId = req.user.id || req.user.user_id;
    
    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }
    
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Don't send password to client
    delete user.password;
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const verifyToken = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ valid: false, error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = await verifyTokenValidity(token);
    
    res.json({ 
      valid: true, 
      user: {
        id: decoded.id || decoded.user_id,
        email: decoded.email,
        role: decoded.role
      } 
    });
  } catch (err) {
    res.status(401).json({ valid: false, error: err.message });
  }
};
