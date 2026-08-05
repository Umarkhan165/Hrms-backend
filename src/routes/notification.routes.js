const router = require("express").Router();
const notifications = require("../controllers/notification.controller");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate);

router.get("/", notifications.listNotifications);
router.patch("/:id/read", notifications.markRead);

router.post(
  "/broadcast",
  authorize("HR", "ADMIN"),
  notifications.broadcastNotification,
);
router.get(
  "/broadcasts",
  authorize("HR", "ADMIN"),
  notifications.listBroadcasts,
);

module.exports = router;
