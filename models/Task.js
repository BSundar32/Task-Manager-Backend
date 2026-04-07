const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimetype: { type: String },
  size: { type: Number },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
});

const sharedWithSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  permission: { type: String, enum: ['view', 'edit'], default: 'view' },
});

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: '',
    },
    deadline: {
      type: Date,
      required: [true, 'Deadline is required'],
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'overdue'],
      default: 'pending',
    },
    category: {
      type: String,
      enum: ['work', 'personal', 'projects', 'other'],
      default: 'other',
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    sharedWith: [sharedWithSchema],
    attachments: [attachmentSchema],
    completedAt: {
      type: Date,
    },
    reminderSent: {
      type: Boolean,
      default: false,
    },
    tags: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

// Auto-mark overdue tasks
taskSchema.pre('save', function (next) {
  if (
    this.status !== 'completed' &&
    this.deadline &&
    new Date(this.deadline) < new Date()
  ) {
    this.status = 'overdue';
  }
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }
  next();
});

// Virtual: is overdue
taskSchema.virtual('isOverdue').get(function () {
  return this.status !== 'completed' && new Date(this.deadline) < new Date();
});

taskSchema.set('toJSON', { virtuals: true });
taskSchema.set('toObject', { virtuals: true });

// Indexes for performance
taskSchema.index({ creator: 1, status: 1 });
taskSchema.index({ assignees: 1 });
taskSchema.index({ deadline: 1 });

module.exports = mongoose.model('Task', taskSchema);
