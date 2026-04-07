const express = require('express');
const { body } = require('express-validator');
const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  shareTask,
  uploadAttachment,
  deleteAttachment,
  getStats,
} = require('../controllers/taskController');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.use(protect);

router.get('/stats', getStats);
router.get('/', getTasks);
router.get('/:id', getTask);

router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Task title is required'),
    body('deadline').isISO8601().withMessage('Valid deadline date is required'),
    body('priority').optional().isIn(['low', 'medium', 'high']),
    body('category').optional().isIn(['work', 'personal', 'projects', 'other']),
  ],
  createTask
);

router.put('/:id', updateTask);
router.delete('/:id', deleteTask);
router.post('/:id/share', shareTask);
router.post('/:id/attachments', upload.single('file'), uploadAttachment);
router.delete('/:id/attachments/:attachmentId', deleteAttachment);

module.exports = router;
