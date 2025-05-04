import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmail, findUserById } from '../models/userModel.js';
import dotenv from 'dotenv';
import { 
  publishUserRegistered, 
  publishLoginSuccess,
  publishLoginFailed
} from './events/userActivityProducer.js';

dotenv.config();

const SECRET_KEY = process.env.JWT_SECRET || 'yourSecretKey';

export const registerUser = async ({ name, email, role, institution, password }) => {
  // Check if user already exists
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new Error('User already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = await createUser({
    name,
    email,
    role,
    institution,
    password: hashedPassword,
  });

  // Publish user registered event to Kafka (non-blocking)
  publishUserRegistered(newUser, { 
    registrationSource: 'api'
  }).catch(err => console.error('Failed to publish registration event:', err));

  return {
    user_id: newUser.user_id,
    email: newUser.email,
    role: newUser.role,
    institution: newUser.institution,
  };
};

export const loginUser = async ({ email, password }, requestMetadata = {}) => {
  const user = await findUserByEmail(email);
  if (!user) {
    // Publish failed login attempt (non-blocking)
    publishLoginFailed(email, { 
      reason: 'user_not_found',
      ...requestMetadata 
    }).catch(err => console.error('Failed to publish login failed event:', err));
    
    throw new Error('Invalid credentials');
  }

  const isPasswordCorrect = await bcrypt.compare(password, user.password);
  if (!isPasswordCorrect) {
    // Publish failed login attempt (non-blocking)
    publishLoginFailed(email, { 
      reason: 'incorrect_password', 
      ...requestMetadata 
    }).catch(err => console.error('Failed to publish login failed event:', err));
    
    throw new Error('Invalid credentials');
  }

  const token = jwt.sign(
    {
      id: user.user_id, // Use 'id' for compatibility with API gateway
      user_id: user.user_id, // Keep 'user_id' for backward compatibility
      email: user.email,
      role: user.role,
    },
    SECRET_KEY,
    { expiresIn: '1h' }
  );

  // Publish successful login event (non-blocking)
  publishLoginSuccess(user, requestMetadata)
    .catch(err => console.error('Failed to publish login success event:', err));

  return token;
};

export const getUserById = async (userId) => {
  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');
  return user;
};

export const verifyTokenValidity = async (token) => {
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    return {
      ...decoded,
      id: decoded.id || decoded.user_id, // Ensure 'id' is always present
    };
  } catch (error) {
    throw new Error('Invalid token');
  }
};
