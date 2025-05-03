import { sendMessage } from './client.js';
import { TOPICS } from './config.js';

/**
 * Notification types for different events
 */
export const NOTIFICATION_TYPES = {
  DOCUMENT_SHARED: 'document_shared',
  COMMENT_ADDED: 'comment_added',
  MENTION: 'mention',
  SYSTEM_NOTIFICATION: 'system_notification',
  DOCUMENT_UPDATE: 'document_update',
};

/**
 * Publish a notification event to Kafka
 * @param {string} notificationType - Type of notification
 * @param {Object} data - Notification data
 * @param {string|Array} recipients - User ID(s) of recipient(s)
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<boolean>} - Whether the notification was published successfully
 */
export const publishNotification = async (
  notificationType, 
  data, 
  recipients, 
  metadata = {}
) => {
  try {
    // Normalize recipients to array
    const recipientList = Array.isArray(recipients) ? recipients : [recipients];
    
    const payload = {
      type: notificationType,
      data,
      recipients: recipientList,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString()
      }
    };

    // Generate a key based on the first recipient for message routing
    const key = recipientList[0]?.toString() || 'system';
    
    await sendMessage(
      TOPICS.NOTIFICATION, 
      payload,
      key
    );
    
    console.log(`Notification published: ${notificationType} for ${recipientList.length} recipients`);
    return true;
  } catch (error) {
    console.error('Error publishing notification:', error);
    return false;
  }
};

/**
 * Publish document shared notification
 * @param {Object} document - Shared document
 * @param {string} sharedBy - User ID who shared the document
 * @param {Array} sharedWith - User IDs the document was shared with
 */
export const publishDocumentShared = async (document, sharedBy, sharedWith) => {
  return await publishNotification(
    NOTIFICATION_TYPES.DOCUMENT_SHARED,
    {
      documentId: document._id?.toString(),
      documentTitle: document.title,
      sharedBy
    },
    sharedWith
  );
};

/**
 * Publish comment added notification
 * @param {Object} comment - The comment that was added
 * @param {string} documentId - ID of the document
 * @param {string} documentTitle - Title of the document
 * @param {string} commentBy - User ID who added the comment
 * @param {string} documentOwner - User ID of document owner
 */
export const publishCommentAdded = async (
  comment, 
  documentId, 
  documentTitle,
  commentBy, 
  documentOwner
) => {
  // Only notify the document owner if they didn't add the comment themselves
  if (commentBy === documentOwner) {
    return true;
  }
  
  return await publishNotification(
    NOTIFICATION_TYPES.COMMENT_ADDED,
    {
      commentId: comment._id?.toString(),
      documentId,
      documentTitle,
      commentBy,
      commentPreview: comment.content?.substring(0, 100)
    },
    documentOwner
  );
};

/**
 * Publish system notification to users
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {Array|string} recipients - User IDs to notify
 * @param {string} level - Notification importance level (info, warning, critical)
 */
export const publishSystemNotification = async (
  title,
  message,
  recipients,
  level = 'info'
) => {
  return await publishNotification(
    NOTIFICATION_TYPES.SYSTEM_NOTIFICATION,
    {
      title,
      message,
      level
    },
    recipients
  );
};