const router = require('express').Router();
const goals = require('../controllers/goal.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.post('/', authorize('MANAGER', 'HR', 'ADMIN'), goals.createGoal);
router.get('/', goals.listGoals);
router.get('/:id', goals.getGoal);
router.patch('/:id/progress', goals.updateProgress);
router.patch('/:id/validate', authorize('MANAGER', 'HR', 'ADMIN'), goals.validateGoal);

module.exports = router;
