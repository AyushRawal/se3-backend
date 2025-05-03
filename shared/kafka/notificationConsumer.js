import { createConsumer, subscribeToTopics } from './client.js';
import { TOPICS } from './config.js';
import { NOTIFICATION_TYPES } from './notificationProducer.js';

/**
 * Start a notification consumer
 * @param {string} consumerGroupId - Consumer group ID
 * @param {Object} handlers - Map of notification type to handler function
 * @returns {Promise<Object>} - The consumer instance
 */
export const startNotificationConsumer = async (consumerGroupId, handlers = {}) => {
  try {
    // Create a consumer for notifications
    const consumer = await createConsumer(consumerGroupId);
    
    // Subscribe to the notification topic
    await subscribeToTopics(
      consumer,
      [TOPICS.NOTIFICATION],
      async (message) => {
        try {
          const { value } = message;
          
          if (!value || !value.type) {
            console.warn('Received invalid notification message:', value);
            return;
          }
          
          const { type, data, recipients, metadata } = value;
          
          // Check if we have a handler for this notification type
          const handler = handlers[type];
          if (handler && typeof handler === 'function') {
            await handler(data, recipients, metadata);
          } else {
            // Use default handler if available
            const defaultHandler = handlers.default;
            if (defaultHandler && typeof defaultHandler === 'function') {
              await defaultHandler(type, data, recipients, metadata);
            } else {
              console.warn(`No handler found for notification type: ${type}`);
            }
          }
        } catch (error) {
          console.error('Error processing notification:', error);
        }
      }
    );
    
    console.log(`Notification consumer ${consumerGroupId} started successfully`);
    return consumer;
  } catch (error) {
    console.error('Failed to start notification consumer:', error);
    throw error;
  }
};

/**
 * Create default notification handlers for different notification types
 * @param {Function} storeNotification - Function to store a notification
 * @returns {Object} - Map of notification types to handler functions
 */
export const createDefaultNotificationHandlers = (storeNotification) => {
  return {
    [NOTIFICATION_TYPES.DOCUMENT_SHARED]: async (data, recipients, metadata) => {
      const { documentId, documentTitle, sharedBy } = data;
      
      for (const recipientId of recipients) {
        await storeNotification({
          userId: recipientId,
          title: 'Document Shared',
          message: `A document "${documentTitle}" was shared with you`,
          link: `/documents/${documentId}`,
          type: NOTIFICATION_TYPES.DOCUMENT_SHARED,
          read: false,
          data: { documentId, sharedBy },
          createdAt: new Date(metadata.timestamp)
        });
      }
    },
    
    [NOTIFICATION_TYPES.COMMENT_ADDED]: async (data, recipients, metadata) => {
      const { documentId, documentTitle, commentBy, commentPreview } = data;
      
      for (const recipientId of recipients) {
        await storeNotification({
          userId: recipientId,
          title: 'New Comment',
          message: `New comment on "${documentTitle}": ${commentPreview}...`,
          link: `/documents/${documentId}#comments`,
          type: NOTIFICATION_TYPES.COMMENT_ADDED,
          read: false,
          data: { documentId, commentBy },
          createdAt: new Date(metadata.timestamp)
        });
      }
    },
    
    [NOTIFICATION_TYPES.SYSTEM_NOTIFICATION]: async (data, recipients, metadata) => {
      const { title, message, level } = data;
      
      for (const recipientId of recipients) {
        await storeNotification({
          userId: recipientId,
          title,
          message,
          type: NOTIFICATION_TYPES.SYSTEM_NOTIFICATION,
          read: false,
          data: { level },
          createdAt: new Date(metadata.timestamp)
        });
      }
    },
    
    // Default handler for notification types without specific handlers
    default: async (type, data, recipients, metadata) => {
      for (const recipientId of recipients) {
        await storeNotification({
          userId: recipientId,
          title: 'New Notification',
          message: `You have received a new notification`,
          type,
          read: false,
          data,
          createdAt: new Date(metadata.timestamp)
        });
      }
    }
  };
};