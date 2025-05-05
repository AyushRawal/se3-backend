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
  file_path: {
    type: String,
    required: true
  },
  file_key: {
    type: String,
    required: true,
    unique: true
  },
  file_url: {
    type: String,
    required: true
  },
  file_size: {
    type: Number,
    required: true
  },
  mime_type: {
    type: String,
    required: true
  },
  owner_id: {
    type: Number, // References PostgreSQL user ID
    required: true,
    index: true
  },
  is_public: {
    type: Boolean,
    default: true,
    index: true
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
