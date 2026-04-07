const express = require('express');
const { body } = require('express-validator');
const { getUsers, getUser, updateProfile, changePassword } = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.use(protect);

router.get('/', getUsers);
router.get('/:id', getUser);
router.put(
  '/profile',
  upload.single('avatar'),
  [body('name').optional().trim().notEmpty()],
  updateProfile
);
router.put('/change-password', changePassword);

module.exports = router;
