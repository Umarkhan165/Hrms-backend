const router = require('express').Router();
const auth = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.delete('/:id', authenticate, auth.revokeSession);

module.exports = router;
