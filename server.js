require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const cron = require('node-cron');
const { checkDeadlines } = require('./services/cronService');
const { verifyEmailConnection, sendEmail } = require('./services/emailService');

const app = express();

// Connect to MongoDB
connectDB();

// Verify email connection at startup (non-blocking)
verifyEmailConnection();

// Middleware
app.use(cors());
// app.use(cors({
//   origin: [
//     'https://guvitaskmanager.netlify.app',
//     'http://localhost:3000',
//     'http://localhost:5173',
//     ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
//   ],
//   credentials: true,
// }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/notifications', require('./routes/notifications'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'TaskManager API is running' });
});

// Test email endpoint — POST /api/test-email  { "to": "you@example.com" }
app.post('/api/test-email', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, message: 'Provide a "to" email address' });

  const result = await sendEmail({
    to,
    subject: '[TaskManager] Test Email',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:8px;">
        <div style="background:#4f46e5;padding:20px;border-radius:8px;color:#fff;text-align:center;">
          <h2 style="margin:0;">TaskManager Email Test</h2>
        </div>
        <div style="padding:24px;">
          <p>Your email notifications are working correctly!</p>
          <p style="color:#6b7280;font-size:13px;">Sent at: ${new Date().toLocaleString()}</p>
        </div>
      </div>
    `,
  });

  if (result) {
    res.json({ success: true, message: `Test email sent to ${to}`, messageId: result.messageId });
  } else {
    res.status(500).json({ success: false, message: 'Email failed — check server logs and .env credentials' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Cron job: check deadlines every hour and send reminder emails
cron.schedule('0 * * * *', () => {
  console.log('Running deadline checker...');
  checkDeadlines();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
