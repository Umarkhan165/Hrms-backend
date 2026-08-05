const router = require('express').Router();
const leave = require('../controllers/leave.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/leave-types', leave.listLeaveTypes);
router.post('/leave-types', authorize('HR', 'ADMIN'), leave.createLeaveType);
router.get('/leave-balances', leave.getLeaveBalances);

router.post('/leave-requests', leave.createLeaveRequest);
router.get('/leave-requests', leave.listLeaveRequests);
router.put('/leave-requests/:id/manager-review', authorize('MANAGER', 'HR', 'ADMIN'), leave.managerReview);
router.put('/leave-requests/:id/hr-approve', authorize('HR', 'ADMIN'), leave.hrApprove);

module.exports = router;
