import { sendMessage } from '../../../shared/kafka/client.js';
import { TOPICS } from '../../../shared/kafka/config.js';

/**
 * Activity types for user events
 */
export const ACTIVITY_TYPES = {
  USER_REGISTERED: 'user_registered',
  USER_LOGIN_SUCCESS: 'user_login_success',
  USER_LOGIN_FAILED: 'user_login_failed',
  PASSWORD_CHANGED: 'password_changed',
  PROFILE_UPDATED: 'profile_updated'
};

/**
 * Publish user activity event to Kafka
 * @param {string} activityType - Type of user activity
 * @param {Object} userData - User data (omit sensitive info)
 * @param {Object} metadata - Additional event metadata
 */
export const publishUserActivity = async (activityType, userData, metadata = {}) => {
  try {
    // Don't include password or sensitive data
    const { password, ...safeUserData } = userData;
    
    const payload = {
      activityType,
      user: safeUserData,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        ip: metadata.ip || 'unknown'
      }
    };

    await sendMessage(
      TOPICS.USER_ACTIVITY, 
      payload,
      userData.user_id?.toString() || userData.email
    );
    
    console.log(`User activity event published: ${activityType}`);
    return true;
  } catch (error) {
    console.error('Error publishing user activity event:', error);
    // Non-blocking - don't fail the main operation if event publishing fails
    return false;
  }
};

/**
 * Publish user registration event
 * @param {Object} user - Newly registered user
 * @param {Object} metadata - Additional metadata
 */
export const publishUserRegistered = async (user, metadata = {}) => {
  return await publishUserActivity(ACTIVITY_TYPES.USER_REGISTERED, user, metadata);
};

/**
 * Publish successful user login event
 * @param {Object} user - User who logged in
 * @param {Object} metadata - Additional metadata
 */
export const publishLoginSuccess = async (user, metadata = {}) => {
  return await publishUserActivity(ACTIVITY_TYPES.USER_LOGIN_SUCCESS, user, metadata);
};

/**
 * Publish failed login attempt
 * @param {string} email - Email used in login attempt
 * @param {Object} metadata - Additional metadata
 */
export const publishLoginFailed = async (email, metadata = {}) => {
  return await publishUserActivity(
    ACTIVITY_TYPES.USER_LOGIN_FAILED, 
    { email }, 
    metadata
  );
};

/**
 * Publish password change event
 * @param {Object} user - User who changed password
 * @param {Object} metadata - Additional metadata
 */
export const publishPasswordChanged = async (user, metadata = {}) => {
  return await publishUserActivity(ACTIVITY_TYPES.PASSWORD_CHANGED, user, metadata);
};

/**
 * Publish profile update event
 * @param {Object} user - User who updated profile
 * @param {Object} updates - Fields that were updated
 * @param {Object} metadata - Additional metadata
 */
export const publishProfileUpdated = async (user, updates, metadata = {}) => {
  return await publishUserActivity(
    ACTIVITY_TYPES.PROFILE_UPDATED, 
    user, 
    { ...metadata, updatedFields: Object.keys(updates) }
  );
};