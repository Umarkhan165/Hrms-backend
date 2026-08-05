const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const getEmployeeForUser = async (userId) => {
  const employee = await prisma.employee.findUnique({ where: { userId } });
  if (!employee) throw new ApiError(400, "This user has no employee profile");
  return employee;
};

const notify = (userId, type, title, message) =>
  prisma.notification.create({ data: { userId, type, title, message } });

// POST /review-cycles  - HR launches an evaluation period

const createReviewCycle = asyncHandler(async (req, res) => {
  const { name, startDate, endDate } = req.body;
  if (!name || !startDate || !endDate)
    throw new ApiError(400, "name, startDate and endDate are required");

  const cycle = await prisma.reviewCycle.create({
    data: {
      name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      active: true,
    },
  });
  res.status(201).json({ success: true, data: cycle });
});

const listReviewCycles = asyncHandler(async (req, res) => {
  const cycles = await prisma.reviewCycle.findMany({
    orderBy: { startDate: "desc" },
    include: { templates: { include: { questions: true } } },
  });
  res.json({ success: true, data: cycles });
});

// POST /review-templates  +  POST /review-templates/:id/questions

const createReviewTemplate = asyncHandler(async (req, res) => {
  const { cycleId, name } = req.body;
  if (!cycleId || !name)
    throw new ApiError(400, "cycleId and name are required");

  const template = await prisma.reviewTemplate.create({
    data: { cycleId, name },
  });
  res.status(201).json({ success: true, data: template });
});

const addTemplateQuestion = asyncHandler(async (req, res) => {
  const { category, text, weight = 1 } = req.body;
  if (!category || !text)
    throw new ApiError(400, "category and text are required");

  const question = await prisma.reviewQuestion.create({
    data: { templateId: req.params.id, category, text, weight },
  });
  res.status(201).json({ success: true, data: question });
});

// POST /reviews  - fires one review record for self / peer / manager track

const createReview = asyncHandler(async (req, res) => {
  const { cycleId, templateId, employeeId, reviewerId, reviewType } = req.body;
  if (!cycleId || !templateId || !employeeId || !reviewType) {
    throw new ApiError(
      400,
      "cycleId, templateId, employeeId and reviewType are required",
    );
  }
  if (!["SELF", "PEER", "MANAGER"].includes(reviewType))
    throw new ApiError(400, "Invalid reviewType");

  const review = await prisma.review.create({
    data: {
      cycleId,
      templateId,
      employeeId,
      reviewerId: reviewType === "SELF" ? employeeId : reviewerId || null,
      reviewType,
      status: "PENDING",
    },
  });

  res.status(201).json({ success: true, data: review });
});

// GET /reviews  - list reviews for current user (as employee or reviewer), or all for HR

const listReviews = asyncHandler(async (req, res) => {
  const { cycleId, status, employeeId } = req.query;
  let where = {
    ...(cycleId ? { cycleId } : {}),
    ...(status ? { status } : {}),
  };

  if (["HR", "ADMIN"].includes(req.user.role)) {
    if (employeeId) where.employeeId = employeeId;
  } else {
    const employee = await getEmployeeForUser(req.user.id);
    where.OR = [{ employeeId: employee.id }, { reviewerId: employee.id }];
  }

  const reviews = await prisma.review.findMany({
    where,
    include: {
      template: {
        include: {
          questions: true,
        },
      },
      employee: { include: { user: { select: { fullName: true } } } },
      answers: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ success: true, data: reviews });
});

// POST /reviews/:id/answers  - submit answers (bulk) and mark submitted
// body: { answers: [{ questionId, rating, comment }] }

const submitAnswers = asyncHandler(async (req, res) => {
  const { answers } = req.body;
  if (!Array.isArray(answers) || answers.length === 0)
    throw new ApiError(400, "answers array is required");

  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
  });
  if (!review) throw new ApiError(404, "Review not found");
  if (review.status !== "PENDING")
    throw new ApiError(400, "This review has already been submitted");

  for (const a of answers) {
    if (!a.questionId || a.rating < 1 || a.rating > 5) {
      throw new ApiError(
        400,
        "Each answer needs a questionId and a rating between 1 and 5",
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.reviewAnswer.createMany({
      data: answers.map((a) => ({
        reviewId: review.id,
        questionId: a.questionId,
        rating: a.rating,
        comment: a.comment || null,
      })),
    });

    return tx.review.update({
      where: { id: review.id },
      data: {
        status: "SUBMITTED",
        comments: req.body.comments || null,
        submittedAt: new Date(),
      },
    });
  });

  res.json({ success: true, data: updated });
});

// GET /reviews/:id/score  - Score = sum(rating * weight) / sum(weight)

const getScore = asyncHandler(async (req, res) => {
  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
    include: { answers: { include: { question: true } } },
  });
  if (!review) throw new ApiError(404, "Review not found");

  if (review.answers.length === 0) {
    return res.json({
      success: true,
      data: { score: null, message: "No answers submitted yet" },
    });
  }

  const weightedSum = review.answers.reduce(
    (sum, a) => sum + a.rating * Number(a.question.weight),
    0,
  );
  const weightTotal = review.answers.reduce(
    (sum, a) => sum + Number(a.question.weight),
    0,
  );
  const score = weightTotal > 0 ? weightedSum / weightTotal : null;

  res.json({ success: true, data: { score } });
});

// PATCH /reviews/:id/publish  - HR locks in the calculated score

const publishReview = asyncHandler(async (req, res) => {
  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
    include: { answers: { include: { question: true } }, employee: true },
  });
  if (!review) throw new ApiError(404, "Review not found");
  if (review.status !== "SUBMITTED")
    throw new ApiError(400, "Only submitted reviews can be published");

  const weightedSum = review.answers.reduce(
    (sum, a) => sum + a.rating * Number(a.question.weight),
    0,
  );
  const weightTotal = review.answers.reduce(
    (sum, a) => sum + Number(a.question.weight),
    0,
  );
  const overallScore = weightTotal > 0 ? weightedSum / weightTotal : null;

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: { status: "PUBLISHED", overallScore },
  });

  await notify(
    review.employee.userId,
    "REVIEW_DUE",
    "Performance review published",
    "Your performance review has been published. Please acknowledge it.",
  );

  res.json({ success: true, data: updated });
});

// PATCH /reviews/:id/acknowledge  - employee acknowledges the published result

const acknowledgeReview = asyncHandler(async (req, res) => {
  const review = await prisma.review.findUnique({
    where: { id: req.params.id },
    include: { employee: true },
  });
  if (!review) throw new ApiError(404, "Review not found");
  if (review.employee.userId !== req.user.id)
    throw new ApiError(403, "Only the reviewed employee can acknowledge this");
  if (review.status !== "PUBLISHED")
    throw new ApiError(400, "Review has not been published yet");

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
  });

  res.json({ success: true, data: updated });
});

module.exports = {
  createReviewCycle,
  listReviewCycles,
  createReviewTemplate,
  addTemplateQuestion,
  createReview,
  listReviews,
  submitAnswers,
  getScore,
  publishReview,
  acknowledgeReview,
};
