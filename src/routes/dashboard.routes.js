const { Router } = require("express");
const { PrismaClient } = require("@prisma/client");
const authMiddleware = require("../middlewares/auth"); // adjust to your auth middleware

const router = Router();
const prisma = new PrismaClient();

router.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const employee = await prisma.employee.findUnique({
      where: { userId },
      include: { department: true, team: true },
    });

    const employeeId = employee ? employee.id : null;

    const [attendance, leaveBalances, goals, reviews, notifications] =
      await Promise.all([
        employeeId
          ? prisma.attendance.findMany({
              where: { employeeId },
              take: 5,
              orderBy: { attendanceDate: "desc" },
            })
          : [],
        employeeId
          ? prisma.leaveBalance.findMany({
              where: { employeeId },
              include: { leaveType: true },
            })
          : [],
        employeeId ? prisma.goal.findMany({ where: { employeeId } }) : [],
        employeeId ? prisma.review.findMany({ where: { employeeId } }) : [],
        prisma.notification.findMany({
          where: { userId },
          take: 10,
          orderBy: { createdAt: "desc" },
        }),
      ]);

    return res.json({
      success: true,
      data: {
        employee,
        attendance,
        leaveBalances,
        goals,
        reviews,
        notifications,
      },
    });
  } catch (error) {
    console.error("Dashboard aggregation error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
