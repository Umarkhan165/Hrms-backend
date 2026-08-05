const router = require("express").Router();
const employees = require("../controllers/employee.controller");
const { authenticate, authorize } = require("../middleware/auth");

console.log("EMPLOYEE ROUTER FILE LOADED");
router.use(authenticate);

router.post("/onboard", authorize("HR", "ADMIN"), employees.onboardEmployee);

router.get("/", authorize("MANAGER", "HR", "ADMIN"), employees.listEmployees);
router.get("/:id", employees.getEmployee);
router.put("/:id", employees.updateEmployee);
router.delete("/:id", authorize("HR", "ADMIN"), employees.softDeleteEmployee);
router.post("/:id/documents", employees.addDocument);

module.exports = router;
