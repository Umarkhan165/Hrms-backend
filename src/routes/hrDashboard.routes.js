const router = require("express").Router();

const { authenticate, authorize } = require("../middleware/auth");

const { getHRDashboard } = require("../controllers/hrDashboard.controller");

router.get("/", authenticate, authorize("HR", "ADMIN"), getHRDashboard);

module.exports = router;
