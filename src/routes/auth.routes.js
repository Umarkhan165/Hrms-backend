const router = require('express').Router();
const auth = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/login', auth.login);
router.post('/activate', auth.activate);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);
router.get('/me', authenticate, auth.me);
router.get('/sessions', authenticate, auth.listMySessions);

module.exports = router;
