const router = require("express").Router();
const reviews = require("../controllers/review.controller");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate);

router.post(
  "/review-cycles",
  authorize("HR", "ADMIN"),
  reviews.createReviewCycle,
);
router.get("/review-cycles", reviews.listReviewCycles);
router.post(
  "/review-templates",
  authorize("HR", "ADMIN"),
  reviews.createReviewTemplate,
);
router.post(
  "/review-templates/:id/questions",
  authorize("HR", "ADMIN"),
  reviews.addTemplateQuestion,
);

router.post("/reviews", authorize("HR", "ADMIN"), reviews.createReview);
router.get("/reviews", reviews.listReviews);
router.post("/reviews/:id/answers", reviews.submitAnswers);
router.get("/reviews/:id/score", reviews.getScore);
router.patch(
  "/reviews/:id/publish",
  authorize("HR", "ADMIN"),
  reviews.publishReview,
);
router.patch("/reviews/:id/acknowledge", reviews.acknowledgeReview);

module.exports = router;
