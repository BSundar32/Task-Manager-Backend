const { validationResult } = require('express-validator');
const Comment = require('../models/Comment');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendEmail, commentAddedEmail } = require('../services/emailService');

// GET /api/comments/task/:taskId
const getComments = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const comments = await Comment.find({
      task: req.params.taskId,
      parentComment: null,
    })
      .populate('author', 'name email avatar')
      .sort({ createdAt: 1 });

    // Fetch replies for each comment
    const commentsWithReplies = await Promise.all(
      comments.map(async (comment) => {
        const replies = await Comment.find({ parentComment: comment._id })
          .populate('author', 'name email avatar')
          .sort({ createdAt: 1 });
        return { ...comment.toObject(), replies };
      })
    );

    res.json({ success: true, comments: commentsWithReplies });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/comments
const createComment = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { taskId, content, parentCommentId } = req.body;

    const task = await Task.findById(taskId).populate('creator assignees', 'name email notificationSettings');
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const comment = await Comment.create({
      task: taskId,
      author: req.user._id,
      content,
      parentComment: parentCommentId || null,
    });

    await comment.populate('author', 'name email avatar');

    // Notify task participants
    const participants = [task.creator, ...task.assignees].filter(
      (u) => u && u._id.toString() !== req.user._id.toString()
    );

    for (const user of participants) {
      await Notification.create({
        user: user._id,
        type: 'comment_added',
        title: 'New Comment',
        message: `${req.user.name} commented on "${task.title}"`,
        task: task._id,
      });

      if (user.notificationSettings?.emailOnComment !== false) {
        await sendEmail(commentAddedEmail(user, task, comment, req.user));
      }
    }

    res.status(201).json({ success: true, comment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/comments/:id
const updateComment = async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You can only edit your own comments' });
    }

    comment.content = req.body.content;
    comment.isEdited = true;
    await comment.save();
    await comment.populate('author', 'name email avatar');

    res.json({ success: true, comment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/comments/:id
const deleteComment = async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    const task = await Task.findById(comment.task);
    const isAuthor = comment.author.toString() === req.user._id.toString();
    const isTaskCreator = task && task.creator.toString() === req.user._id.toString();

    if (!isAuthor && !isTaskCreator && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Delete replies too
    await Comment.deleteMany({ parentComment: comment._id });
    await comment.deleteOne();

    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getComments, createComment, updateComment, deleteComment };
