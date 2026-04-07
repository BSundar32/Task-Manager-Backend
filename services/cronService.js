const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendEmail, deadlineReminderEmail } = require('./emailService');

const checkDeadlines = async () => {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find tasks with deadlines in the next 24 hours that haven't had reminders sent
    const upcomingTasks = await Task.find({
      deadline: { $gte: now, $lte: in24h },
      status: { $in: ['pending', 'in-progress'] },
      reminderSent: false,
    }).populate('assignees creator', 'name email notificationSettings');

    for (const task of upcomingTasks) {
      const usersToNotify = [task.creator, ...task.assignees].filter(
        (u) => u && u.notificationSettings?.emailOnDeadline !== false
      );

      for (const user of usersToNotify) {
        // Send email reminder
        await sendEmail(deadlineReminderEmail(user, task));

        // Create in-app notification
        await Notification.create({
          user: user._id,
          type: 'deadline_approaching',
          title: 'Deadline Approaching',
          message: `Task "${task.title}" is due soon: ${new Date(task.deadline).toLocaleString()}`,
          task: task._id,
        });
      }

      // Mark reminder as sent
      await Task.findByIdAndUpdate(task._id, { reminderSent: true });
    }

    // Mark overdue tasks
    await Task.updateMany(
      {
        deadline: { $lt: now },
        status: { $in: ['pending', 'in-progress'] },
      },
      { status: 'overdue' }
    );

    console.log(`Deadline check complete. Processed ${upcomingTasks.length} tasks.`);
  } catch (error) {
    console.error('Deadline check error:', error.message);
  }
};

module.exports = { checkDeadlines };
