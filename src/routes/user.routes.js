const router = require('express').Router();
const users = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', authorize('HR', 'ADMIN'), users.listUsers);
router.patch('/:id/status', authorize('ADMIN'), users.setUserStatus);
router.patch('/:id/role', authorize('ADMIN'), users.setUserRole);

module.exports = router;
