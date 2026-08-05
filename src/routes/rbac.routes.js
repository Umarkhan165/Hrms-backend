const router = require("express").Router();
const rbac = require("../controllers/rbac.controller");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate);
router.use(authorize("ADMIN"));

router.get("/roles", rbac.listRoles);
router.post("/roles", rbac.createRole);
router.get("/roles/:id/permissions", rbac.getRolePermissions);
router.put("/roles/:id/permissions", rbac.setRolePermissions);

router.get("/permissions", rbac.listPermissions);
router.post("/permissions", rbac.createPermission);

module.exports = router;
