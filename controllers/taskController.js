const { validationResult } = require('express-validator');
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const {
  sendEmail,
  taskAssignedEmail,
  taskStatusChangedEmail,
  taskSharedEmail,
  taskUpdatedEmail,
} = require('../services/emailService');

// GET /api/tasks  — list tasks for current user
const getTasks = async (req, res) => {
  try {
    const { status, priority, category, search, sortBy = 'deadline', order = 'asc', page = 1, limit = 20 } = req.query;
    const userId = req.user._id;

    const query = {
      $or: [
        { creator: userId },
        { assignees: userId },
        { 'sharedWith.user': userId },
      ],
    };

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;
    if (search) query.$text = { $search: search };

    const sort = { [sortBy]: order === 'desc' ? -1 : 1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tasks, total] = await Promise.all([
      Task.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('creator', 'name email avatar')
        .populate('assignees', 'name email avatar')
        .populate('sharedWith.user', 'name email avatar'),
      Task.countDocuments(query),
    ]);

    res.json({
      success: true,
      tasks,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/tasks/:id
const getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('creator', 'name email avatar')
      .populate('assignees', 'name email avatar')
      .populate('sharedWith.user', 'name email avatar')
      .populate('attachments.uploadedBy', 'name');

    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const userId = req.user._id.toString();
    const hasAccess =
      task.creator._id.toString() === userId ||
      task.assignees.some((a) => a._id.toString() === userId) ||
      task.sharedWith.some((s) => s.user._id.toString() === userId);

    if (!hasAccess) return res.status(403).json({ success: false, message: 'Access denied' });

    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/tasks
const createTask = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { title, description, deadline, priority, status, category, assignees, tags } = req.body;

    const task = await Task.create({
      title,
      description,
      deadline,
      priority,
      status,
      category,
      tags,
      creator: req.user._id,
      assignees: assignees || [],
    });

    await task.populate('creator assignees', 'name email avatar');

    // Notify assignees
    if (assignees && assignees.length > 0) {
      const assigneeUsers = await User.find({ _id: { $in: assignees } });
      for (const user of assigneeUsers) {
        if (user._id.toString() !== req.user._id.toString()) {
          await Notification.create({
            user: user._id,
            type: 'task_assigned',
            title: 'New Task Assigned',
            message: `${req.user.name} assigned you: "${task.title}"`,
            task: task._id,
          });
          if (user.notificationSettings?.emailOnTaskAssign !== false) {
            await sendEmail(taskAssignedEmail(user, task, req.user));
          }
        }
      }
    }

    res.status(201).json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const userId = req.user._id.toString();
    const isCreator = task.creator.toString() === userId;
    const isAssignee = task.assignees.map(String).includes(userId);
    const sharedEntry = task.sharedWith.find((s) => s.user.toString() === userId);
    const canEdit = isCreator || isAssignee || sharedEntry?.permission === 'edit';

    if (!canEdit) return res.status(403).json({ success: false, message: 'Access denied' });

    const oldStatus = task.status;

    // Track which fields actually changed (for update email)
    const watchedFields = ['title', 'description', 'deadline', 'priority', 'category'];
    const changes = [];
    watchedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        const oldVal = task[field];
        const newVal = req.body[field];
        const oldStr = oldVal instanceof Date ? oldVal.toISOString() : String(oldVal ?? '');
        const newStr = newVal instanceof Date ? new Date(newVal).toISOString() : String(newVal ?? '');
        if (oldStr !== newStr) changes.push({ field, from: oldVal, to: newVal });
      }
    });

    const allowedFields = ['title', 'description', 'deadline', 'priority', 'status', 'category', 'assignees', 'tags'];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) task[field] = req.body[field];
    });

    await task.save();
    await task.populate('creator assignees sharedWith.user', 'name email avatar');

    // Build unique list of participants other than the person making the change
    const allParticipants = [task.creator, ...task.assignees];
    const usersToNotify = allParticipants.filter(
      (u) => (u._id || u).toString() !== userId
    );

    console.log(`\n[Task update] "${task.title}" by ${req.user.name}`);
    console.log(`  Status change: ${oldStatus !== task.status ? `${oldStatus} → ${task.status}` : 'none'}`);
    console.log(`  Field changes: ${changes.length > 0 ? changes.map(c => c.field).join(', ') : 'none'}`);
    console.log(`  Participants to notify: ${usersToNotify.length} (${usersToNotify.map(u => u.email || u).join(', ') || 'none — add assignees to trigger emails'})`);

    // Email on status change
    if (oldStatus !== task.status) {
      for (const u of usersToNotify) {
        const user = await User.findById(u._id || u);
        if (user) {
          await Notification.create({
            user: user._id,
            type: 'status_changed',
            title: 'Task Status Updated',
            message: `"${task.title}" status changed from ${oldStatus} to ${task.status}`,
            task: task._id,
          });
          if (user.notificationSettings?.emailOnStatusChange !== false) {
            await sendEmail(taskStatusChangedEmail(user, task, oldStatus, task.status, req.user));
          }
        }
      }
    }

    // Email on general task update (title, deadline, priority, etc.)
    if (changes.length > 0) {
      for (const u of usersToNotify) {
        const user = await User.findById(u._id || u);
        if (user) {
          await Notification.create({
            user: user._id,
            type: 'task_updated',
            title: 'Task Updated',
            message: `"${task.title}" was updated by ${req.user.name}`,
            task: task._id,
          });
          if (user.notificationSettings?.emailOnStatusChange !== false) {
            await sendEmail(taskUpdatedEmail(user, task, changes, req.user));
          }
        }
      }
    }

    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    if (task.creator.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the creator can delete this task' });
    }

    await task.deleteOne();
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/tasks/:id/share
const shareTask = async (req, res) => {
  try {
    const { userId, permission = 'view' } = req.body;
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    if (task.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only creator can share tasks' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

    const existingShare = task.sharedWith.find((s) => s.user.toString() === userId);
    if (existingShare) {
      existingShare.permission = permission;
    } else {
      task.sharedWith.push({ user: userId, permission });
    }

    await task.save();
    await task.populate('sharedWith.user', 'name email avatar');

    await Notification.create({
      user: userId,
      type: 'task_shared',
      title: 'Task Shared With You',
      message: `${req.user.name} shared "${task.title}" with you (${permission} access)`,
      task: task._id,
    });

    // Send email notification to the shared user
    await sendEmail(taskSharedEmail(targetUser, task, req.user, permission));

    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/tasks/:id/attachments
const uploadAttachment = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    task.attachments.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user._id,
    });

    await task.save();
    res.json({ success: true, attachments: task.attachments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/tasks/:id/attachments/:attachmentId
const deleteAttachment = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    task.attachments = task.attachments.filter(
      (a) => a._id.toString() !== req.params.attachmentId
    );
    await task.save();
    res.json({ success: true, message: 'Attachment removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/tasks/stats — dashboard stats
const getStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const userFilter = {
      $or: [{ creator: userId }, { assignees: userId }],
    };

    const [total, pending, inProgress, completed, overdue, byCategory, byPriority, recentCompleted] =
      await Promise.all([
        Task.countDocuments(userFilter),
        Task.countDocuments({ ...userFilter, status: 'pending' }),
        Task.countDocuments({ ...userFilter, status: 'in-progress' }),
        Task.countDocuments({ ...userFilter, status: 'completed' }),
        Task.countDocuments({ ...userFilter, status: 'overdue' }),
        Task.aggregate([
          { $match: userFilter },
          { $group: { _id: '$category', count: { $sum: 1 } } },
        ]),
        Task.aggregate([
          { $match: userFilter },
          { $group: { _id: '$priority', count: { $sum: 1 } } },
        ]),
        Task.find({ ...userFilter, status: 'completed' })
          .sort({ completedAt: -1 })
          .limit(5)
          .select('title completedAt'),
      ]);

    // Upcoming deadlines (next 7 days)
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcoming = await Task.find({
      ...userFilter,
      deadline: { $gte: now, $lte: in7d },
      status: { $in: ['pending', 'in-progress'] },
    })
      .sort({ deadline: 1 })
      .limit(5)
      .select('title deadline priority status');

    res.json({
      success: true,
      stats: {
        total,
        pending,
        inProgress,
        completed,
        overdue,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        byCategory,
        byPriority,
        recentCompleted,
        upcomingDeadlines: upcoming,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  shareTask,
  uploadAttachment,
  deleteAttachment,
  getStats,
};
