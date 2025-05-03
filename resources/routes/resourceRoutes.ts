import express, { Request, Response } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import path from 'path';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticate, authorizeAdmin, optionalAuthenticate } from '../middleware/auth';
import Resource from '../models/Resource';
import { publishDocumentCreated, publishDocumentUpdated, publishDocumentDeleted } from '../services/documentEventProducer';
import mongoose from 'mongoose';

const router = express.Router();

// AWS S3 Configuration
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
});
const bucketName = process.env.S3_BUCKET_NAME as string;

// Multer Storage Configuration
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: bucketName,
    acl: "public-read",
    key: function (
      req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, key?: string) => void,
    ) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(
        null,
        file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
      );
    },
  }) as multer.StorageEngine,
  limits: { fileSize: 50 * 1024 * 1024 }, // Limit: 50MB
});

/**
 * @route POST /api/resources
 * @desc Upload a new resource file
 * @access Private
 */
router.post('/', authenticate, upload.single('resource'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
      return;
    }

    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'User authentication required'
      });
      return;
    }
    
    // Extract file information from multer-s3 result
    const fileKey = (req.file as any).key;
    const fileLocation = (req.file as any).location;
    const fileSize = (req.file as any).size;
    const mimeType = (req.file as any).mimetype;
    
    // Get metadata from request body
    const { 
      title, 
      description = '', 
      resourceType = 'other',
      tags = [],
      categories = [],
      isPublic = true,
    } = req.body;

    if (!title) {
      res.status(400).json({
        success: false,
        error: 'Title is required'
      });
      return;
    }

    // Create resource document in MongoDB
    const resource = new Resource({
      title,
      description,
      file_path: fileLocation,
      file_key: fileKey,
      file_url: fileLocation,
      file_size: fileSize,
      mime_type: mimeType,
      owner_id: parseInt(req.user.id, 10),
      is_public: isPublic === 'true' || isPublic === true,
      resourceType,
      tags: Array.isArray(tags) ? tags : tags.split(',').map((tag: string) => tag.trim()),
      categories: Array.isArray(categories) ? categories : categories.split(',').map((cat: string) => cat.trim()),
    });

    await resource.save();

    // Publish event to Kafka for search indexing
    await publishDocumentCreated(resource);

    res.status(201).json({
      success: true,
      data: {
        id: resource._id,
        title: resource.title,
        description: resource.description,
        fileUrl: resource.file_url,
        fileSize: resource.file_size,
        mimeType: resource.mime_type,
        resourceType: resource.resourceType,
        isPublic: resource.is_public
      }
    });
  } catch (error: any) {
    console.error('Error uploading resource:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

/**
 * @route GET /api/resources/:id
 * @desc Get resource metadata by ID
 * @access Public (with optional auth for private resources)
 */
router.get('/:id', optionalAuthenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const resourceId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid resource ID format'
      });
      return;
    }

    const resource = await Resource.findById(resourceId);

    if (!resource) {
      res.status(404).json({
        success: false,
        error: 'Resource not found'
      });
      return;
    }

    // Check access permissions - private resources are only accessible by owner or admin
    if (!resource.is_public && 
        (!req.user || 
         (parseInt(req.user.id, 10) !== resource.owner_id && 
          req.user.role !== 'admin'))) {
      res.status(403).json({
        success: false,
        error: 'Access denied to this resource'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: resource
    });
  } catch (error: any) {
    console.error('Error fetching resource:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

/**
 * @route GET /api/resources
 * @desc Get all resources (with pagination and filtering)
 * @access Public (with filtering based on auth)
 */
router.get('/', optionalAuthenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      resourceType,
      tags,
      categories,
      owner
    } = req.query;
    
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);
    
    // Build filter query
    const query: any = {};
    
    // Add resourceType filter if specified
    if (resourceType) {
      query.resourceType = resourceType;
    }
    
    // Add tags filter if specified (supports comma-separated list)
    if (tags) {
      const tagArray = (tags as string).split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }
    
    // Add categories filter if specified (supports comma-separated list)
    if (categories) {
      const categoryArray = (categories as string).split(',').map(cat => cat.trim());
      query.categories = { $in: categoryArray };
    }
    
    // Add owner filter if specified
    if (owner) {
      query.owner_id = parseInt(owner as string, 10);
    }
    
    // Handle privacy - if user is authenticated, include their private resources
    if (req.user) {
      // If user is admin, they can see all resources
      if (req.user.role === 'admin') {
        // No additional filter
      } else {
        // Regular user can see all public resources plus their own private resources
        query.$or = [
          { is_public: true },
          { owner_id: parseInt(req.user.id, 10) }
        ];
      }
    } else {
      // Unauthenticated users can only see public resources
      query.is_public = true;
    }
    
    // Get total count for pagination
    const total = await Resource.countDocuments(query);
    
    // Get resources with pagination
    const resources = await Resource.find(query)
      .sort({ created_at: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber);
    
    res.status(200).json({
      success: true,
      data: resources,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber)
      }
    });
  } catch (error: any) {
    console.error('Error fetching resources:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

/**
 * @route GET /api/resources/download/:id
 * @desc Download a resource file
 * @access Public (with permission check)
 */
router.get('/download/:id', optionalAuthenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const resourceId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid resource ID format'
      });
      return;
    }

    const resource = await Resource.findById(resourceId);

    if (!resource) {
      res.status(404).json({
        success: false,
        error: 'Resource not found'
      });
      return;
    }

    // Check access permissions - private resources are only accessible by owner or admin
    if (!resource.is_public && 
        (!req.user || 
         (parseInt(req.user.id, 10) !== resource.owner_id && 
          req.user.role !== 'admin'))) {
      res.status(403).json({
        success: false,
        error: 'Access denied to this resource'
      });
      return;
    }

    // Get file from S3
    const getObjectParams = {
      Bucket: bucketName,
      Key: resource.file_key,
    };

    try {
      const getObjectCommand = new GetObjectCommand(getObjectParams);
      const data = await s3Client.send(getObjectCommand);
      
      if (data.Body) {
        // Set appropriate headers for file download
        res.setHeader("Content-Disposition", `attachment; filename="${resource.file_key}"`);
        res.setHeader("Content-Type", data.ContentType || 'application/octet-stream');
        
        // Stream the file to the response
        (data.Body as any).pipe(res);
        
        // Update download count (async, don't wait for it)
        Resource.findByIdAndUpdate(
          resourceId, 
          { $inc: { download_count: 1 } }
        ).exec();
      } else {
        res.status(500).json({
          success: false,
          error: 'Error downloading file: Empty response from storage'
        });
      }
    } catch (error: any) {
      console.error('Error downloading from S3:', error);
      
      if (error.code === 'NoSuchKey') {
        res.status(404).json({
          success: false,
          error: 'File not found in storage'
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        error: 'Error downloading file'
      });
    }
  } catch (error: any) {
    console.error('Error processing download:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

/**
 * @route PUT /api/resources/:id
 * @desc Update resource metadata
 * @access Private (owner or admin)
 */
router.put('/:id', authenticate, async (req: Request, res: Response, next: any): Promise<Response<any, Record<string, any>> | void> => {
  try {
    const resourceId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid resource ID format'
      });
      return;
    }

    // Find the resource
    const resource = await Resource.findById(resourceId);

    if (!resource) {
      res.status(404).json({
        success: false,
        error: 'Resource not found'
      });
      return;
    }

    // Check if user has permission to update (must be owner or admin)
    if (!req.user || 
        (parseInt(req.user.id, 10) !== resource.owner_id && 
         req.user.role !== 'admin')) {
      res.status(403).json({
        success: false,
        error: 'You do not have permission to update this resource'
      });
      return;
    }

    // Extract updatable fields
    const { 
      title, 
      description, 
      resourceType,
      tags,
      categories,
      isPublic
    } = req.body;
    
    // Build update object with only fields that are provided
    const updateData: any = {};
    
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (resourceType !== undefined) updateData.resourceType = resourceType;
    if (isPublic !== undefined) updateData.is_public = isPublic === 'true' || isPublic === true;
    
    // Handle arrays (tags & categories)
    if (tags !== undefined) {
      updateData.tags = Array.isArray(tags) ? tags : tags.split(',').map((tag: string) => tag.trim());
    }
    
    if (categories !== undefined) {
      updateData.categories = Array.isArray(categories) ? categories : categories.split(',').map((cat: string) => cat.trim());
    }

    // Update the resource
    const updatedResource = await Resource.findByIdAndUpdate(
      resourceId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedResource) {
      res.status(404).json({
        success: false,
        error: 'Resource not found after update'
      });
      return;
    }

    // Publish update event to Kafka for search indexing
    await publishDocumentUpdated(resourceId, updateData);

    res.status(200).json({
      success: true,
      data: updatedResource
    });
  } catch (error: any) {
    console.error('Error updating resource:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

/**
 * @route DELETE /api/resources/:id
 * @desc Delete a resource
 * @access Private (owner or admin)
 */
router.delete('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const resourceId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid resource ID format'
      });
      return;
    }

    // Find the resource
    const resource = await Resource.findById(resourceId);

    if (!resource) {
      res.status(404).json({
        success: false,
        error: 'Resource not found'
      });
      return;
    }

    // Check if user has permission to delete (must be owner or admin)
    if (!req.user || 
        (parseInt(req.user.id, 10) !== resource.owner_id && 
         req.user.role !== 'admin')) {
      res.status(403).json({
        success: false,
        error: 'You do not have permission to delete this resource'
      });
      return;
    }

    // Delete from S3
    try {
      const deleteObjectParams = {
        Bucket: bucketName,
        Key: resource.file_key,
      };
      
      const deleteCommand = new DeleteObjectCommand(deleteObjectParams);
      await s3Client.send(deleteCommand);
    } catch (s3Error) {
      console.error('Error deleting file from S3:', s3Error);
      // Continue with MongoDB deletion even if S3 deletion fails
    }

    // Delete from MongoDB
    await Resource.findByIdAndDelete(resourceId);

    // Publish deletion event to Kafka for search indexing
    await publishDocumentDeleted(resourceId);

    res.status(200).json({
      success: true,
      message: 'Resource deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting resource:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

/**
 * @route GET /api/resources/user/:userId
 * @desc Get resources by owner ID
 * @access Public (with filtering based on auth)
 */
router.get('/user/:userId', optionalAuthenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { 
      page = 1, 
      limit = 10
    } = req.query;
    
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);
    const ownerId = parseInt(userId, 10);
    
    // Build filter query
    const query: any = { owner_id: ownerId };
    
    // Handle privacy - if user is authenticated and is the owner or admin, they can see all resources
    // Otherwise, they can only see public resources from this user
    if (!req.user || 
        (parseInt(req.user.id, 10) !== ownerId && 
         req.user.role !== 'admin')) {
      query.is_public = true;
    }
    
    // Get total count for pagination
    const total = await Resource.countDocuments(query);
    
    // Get resources with pagination
    const resources = await Resource.find(query)
      .sort({ created_at: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber);
    
    res.status(200).json({
      success: true,
      data: resources,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber)
      }
    });
  } catch (error: any) {
    console.error('Error fetching user resources:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

export default router;