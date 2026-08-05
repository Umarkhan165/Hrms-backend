const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");

// GET /hr/dashboard

const getHRDashboard = asyncHandler(async (req, res) => {
  const [
    employees,
    pendingLeaves,
    onboarding,
    totalReviews,
    completedReviews,
    alerts,
  ] = await Promise.all([
    // Total active employees
    prisma.employee.count({
      where: {
        deletedAt: null,
        status: "ACTIVE",
      },
    }),

    // Pending leave requests
    prisma.leaveRequest.count({
      where: {
        status: "PENDING",
      },
    }),

    // Pending onboarding
    prisma.employee.count({
      where: {
        status: "PENDING",
      },
    }),

    // All reviews
    prisma.review.count(),

    // Completed reviews
    prisma.review.count({
      where: {
        status: {
          in: ["SUBMITTED", "PUBLISHED", "ACKNOWLEDGED"],
        },
      },
    }),

    // Latest audit logs
    prisma.auditLog.findMany({
      take: 5,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const reviewProgress =
    totalReviews > 0 ? Math.round((completedReviews / totalReviews) * 100) : 0;
  res.json({
    success: true,

    data: {
      totalEmployees: employees,

      pendingLeaves,

      onboardingEmployees: onboarding,

      reviewProgress,

      attendanceAlerts: 0,

      latestAudit: alerts,
    },
  });
});

module.exports = {
  getHRDashboard,
};
