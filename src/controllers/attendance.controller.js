const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { getPagination } = require("../utils/pagination");

const LATE_CUTOFF_HOUR = 9; // 9:00 AM local time

// Returns midnight UTC date for consistent database storage
const todayDateOnly = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

const getEmployeeIdForUser = async (userId) => {
  const employee = await prisma.employee.findUnique({ where: { userId } });
  if (!employee) throw new ApiError(400, "This user has no employee profile");
  return employee.id;
};

// POST /attendance/clock-in
const clockIn = asyncHandler(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.user.id);
  const attendanceDate = todayDateOnly();
  const now = new Date();

  const existing = await prisma.attendance.findUnique({
    where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
  });
  if (existing) throw new ApiError(409, "Already clocked in for today");

  // Use local hours (now.getHours()) instead of UTC hours
  const status = now.getHours() >= LATE_CUTOFF_HOUR ? "LATE" : "PRESENT";

  const attendance = await prisma.attendance.create({
    data: { employeeId, attendanceDate, clockIn: now, status },
    include: { breaks: true },
  });

  res.status(201).json({ success: true, data: attendance });
});

// POST /attendance/clock-out
const clockOut = asyncHandler(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.user.id);
  const attendanceDate = todayDateOnly();

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
    include: { breaks: true },
  });
  if (!attendance) throw new ApiError(400, "You have not clocked in today");
  if (attendance.clockOut)
    throw new ApiError(409, "Already clocked out for today");

  const openBreak = attendance.breaks.find((b) => !b.endTime);
  if (openBreak)
    throw new ApiError(400, "End your active break before clocking out");

  const now = new Date();
  const grossMinutes = (now - new Date(attendance.clockIn)) / 60000;
  const breakMinutes = attendance.breaks.reduce(
    (sum, b) => sum + (b.durationMinutes || 0),
    0,
  );
  const totalHours = Math.max(0, (grossMinutes - breakMinutes) / 60);

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: { clockOut: now, totalHours: totalHours.toFixed(2) },
    include: { breaks: true },
  });

  res.json({ success: true, data: updated });
});

// POST /attendance/breaks/start
const startBreak = asyncHandler(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.user.id);
  const attendanceDate = todayDateOnly();

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
    include: { breaks: true },
  });
  if (!attendance) throw new ApiError(400, "Clock in before starting a break");
  if (attendance.clockOut)
    throw new ApiError(400, "You have already clocked out today");
  if (attendance.breaks.some((b) => !b.endTime))
    throw new ApiError(409, "A break is already in progress");

  const brk = await prisma.attendanceBreak.create({
    data: { attendanceId: attendance.id, startTime: new Date() },
  });

  res.status(201).json({ success: true, data: brk });
});

// POST /attendance/breaks/end
const endBreak = asyncHandler(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.user.id);
  const attendanceDate = todayDateOnly();

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
    include: { breaks: true },
  });
  if (!attendance) throw new ApiError(400, "No attendance record for today");

  const openBreak = attendance.breaks.find((b) => !b.endTime);
  if (!openBreak) throw new ApiError(400, "No break in progress");

  const now = new Date();
  const durationMinutes = Math.round(
    (now - new Date(openBreak.startTime)) / 60000,
  );

  const updated = await prisma.attendanceBreak.update({
    where: { id: openBreak.id },
    data: { endTime: now, durationMinutes },
  });

  res.json({ success: true, data: updated });
});

// GET /attendance
const listAttendance = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { from, to, status, employeeId } = req.query;

  let targetEmployeeId = employeeId;
  if (req.user.role === "EMPLOYEE") {
    targetEmployeeId = await getEmployeeIdForUser(req.user.id);
  } else if (!targetEmployeeId) {
    targetEmployeeId = req.user.employee ? req.user.employee.id : undefined;
  }

  const where = {
    ...(targetEmployeeId ? { employeeId: targetEmployeeId } : {}),
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          attendanceDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const [total, records] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      skip,
      take: limit,
      // Default to DESCENDING so the newest/today's record is always first
      orderBy: { attendanceDate: "desc" },
      include: { breaks: true },
    }),
  ]);

  res.json({
    success: true,
    data: records,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

module.exports = { clockIn, clockOut, startBreak, endBreak, listAttendance };
