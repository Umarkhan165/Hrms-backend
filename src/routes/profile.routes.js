const express = require("express");

const router = express.Router();

const { getMyProfile } = require("../controllers/employee.controller");

const { authenticate } = require("../middleware/auth");

router.get("/me", authenticate, getMyProfile);

module.exports = router;
