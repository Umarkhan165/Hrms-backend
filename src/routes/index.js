const router = require("express").Router();

router.use("/auth", require("./auth.routes"));
router.use("/sessions", require("./session.routes"));
router.use("/users", require("./user.routes"));
router.use("/employees", require("./employee.routes"));
router.use("/departments", require("./department.routes"));
router.use("/teams", require("./team.routes"));
router.use("/attendance", require("./attendance.routes"));
// leave.routes.js registers /leave-types, /leave-balances, /leave-requests itself
router.use("/", require("./leave.routes"));
router.use("/goals", require("./goal.routes"));
// review.routes.js registers /review-cycles, /review-templates, /reviews itself
router.use("/", require("./review.routes"));
router.use("/notifications", require("./notification.routes"));
router.use("/audit-logs", require("./audit.routes"));
router.use("/profile", require("./profile.routes"));
router.use("/hr/dashboard", require("./hrDashboard.routes"));
router.use("/rbac", require("./rbac.routes"));

module.exports = router;
