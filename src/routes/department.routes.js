const router = require('express').Router();
const departments = require('../controllers/department.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', departments.listDepartments);
router.get('/:id', departments.getDepartment);
router.post('/', authorize('HR', 'ADMIN'), departments.createDepartment);
router.put('/:id', authorize('HR', 'ADMIN'), departments.updateDepartment);
router.delete('/:id', authorize('HR', 'ADMIN'), departments.deleteDepartment);

module.exports = router;
