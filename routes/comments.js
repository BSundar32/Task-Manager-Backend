const express = require('express');
const { body } = require('express-validator');
const {
  getComments,
  createComment,
  updateComment,
  deleteComment,
} = require('../controllers/commentController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/task/:taskId', getComments);
router.post(
  '/',
  [
    body('taskId').notEmpty().withMessage('Task ID is required'),
    body('content').trim().notEmpty().withMessage('Comment content is required'),
  ],
  createComment
);
router.put('/:id', updateComment);
router.delete('/:id', deleteComment);

module.exports = router;
