import mongoose from 'mongoose';

// Document schema for MongoDB
const DocumentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  description: {
    type: String,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  resourceType: {
    type: String,
    required: true,
    enum: ['article', 'book', 'lecture', 'paper', 'presentation', 'video', 'other'],
    index: true
  },
  tags: [{
    type: String,
    index: true
  }],
  categories: [{
    type: String,
    index: true
  }],
  owner_id: {
    type: Number,  // This references the PostgreSQL user ID
    required: true,
    index: true
  },
  is_public: {
    type: Boolean,
    default: true,
    index: true
  },
  file_path: {
    type: String
  },
  file_size: {
    type: Number
  },
  mime_type: {
    type: String
  },
  view_count: {
    type: Number,
    default: 0
  },
  download_count: {
    type: Number,
    default: 0
  },
  average_rating: {
    type: Number,
    default: 0
  },
  is_featured: {
    type: Boolean,
    default: false
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  is_indexed: {
    type: Boolean,
    default: false
  }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Middleware to mark document for indexing when updated
DocumentSchema.pre('save', function(next) {
  this.is_indexed = false;
  next();
});

const Document = mongoose.model('Document', DocumentSchema);

export default Document;