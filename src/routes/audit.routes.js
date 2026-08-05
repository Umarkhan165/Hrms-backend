const router = require('express').Router();
const audit = require('../controllers/audit.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('HR', 'ADMIN'), audit.listAuditLogs);

module.exports = router;
