const router = require('express').Router();
const teams = require('../controllers/team.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', teams.listTeams);
router.get('/:id', teams.getTeam);
router.get('/:id/attendance', authorize('MANAGER', 'HR', 'ADMIN'), teams.getTeamAttendance);
router.post('/', authorize('HR', 'ADMIN'), teams.createTeam);
router.put('/:id', authorize('HR', 'ADMIN'), teams.updateTeam);
router.delete('/:id', authorize('HR', 'ADMIN'), teams.deleteTeam);

module.exports = router;
