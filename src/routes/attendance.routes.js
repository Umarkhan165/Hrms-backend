const router = require('express').Router();
const attendance = require('../controllers/attendance.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.post('/clock-in', attendance.clockIn);
router.post('/clock-out', attendance.clockOut);
router.post('/breaks/start', attendance.startBreak);
router.post('/breaks/end', attendance.endBreak);
router.get('/', attendance.listAttendance);

module.exports = router;
