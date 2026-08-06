const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { getPagination, getSort } = require("../utils/pagination");
const { writeAudit } = require("../middleware/audit");

const createTeam = asyncHandler(async (req, res) => {
  const { name, departmentId, leadId, managerId } = req.body;
  if (!name || !departmentId)
    throw new ApiError(400, "name and departmentId are required");

  const resolvedLeadId = managerId !== undefined ? managerId : leadId;

  const team = await prisma.team.create({
    data: {
      name,
      departmentId,
      leadId: resolvedLeadId || null,
    },
  });

  await writeAudit({
    userId: req.user.id,
    action: "CREATE_TEAM",
    module: "Teams",
    newData: team,
  });
  res.status(201).json({ success: true, data: team });
});

const listTeams = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(req.query, ["name", "createdAt"], "name");
  const { search, departmentId } = req.query;

  const where = {
    deletedAt: null,
    ...(departmentId ? { departmentId } : {}),
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
  };

  const [total, teams] = await Promise.all([
    prisma.team.count({ where }),
    prisma.team.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        department: { select: { id: true, name: true } },
        lead: { select: { id: true, fullName: true } },
        _count: { select: { employees: true } },
      },
    }),
  ]);

  res.json({
    success: true,
    data: teams,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

const getTeam = asyncHandler(async (req, res) => {
  const team = await prisma.team.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: {
      department: true,
      lead: { select: { id: true, fullName: true } },
      employees: {
        include: { user: { select: { fullName: true, email: true } } },
      },
    },
  });
  if (!team) throw new ApiError(404, "Team not found");
  res.json({ success: true, data: team });
});

const updateTeam = asyncHandler(async (req, res) => {
  const { name, leadId, managerId, departmentId } = req.body;
  const team = await prisma.team.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!team) throw new ApiError(404, "Team not found");

  const resolvedLeadId = managerId !== undefined ? managerId : leadId;

  const updated = await prisma.team.update({
    where: { id: team.id },
    data: {
      ...(name && { name }),
      ...(resolvedLeadId !== undefined && { leadId: resolvedLeadId || null }),
      ...(departmentId && { departmentId }),
    },
  });

  await writeAudit({
    userId: req.user.id,
    action: "UPDATE_TEAM",
    module: "Teams",
    oldData: team,
    newData: updated,
  });
  res.json({ success: true, data: updated });
});

const deleteTeam = asyncHandler(async (req, res) => {
  const team = await prisma.team.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!team) throw new ApiError(404, "Team not found");

  await prisma.team.update({
    where: { id: team.id },
    data: { deletedAt: new Date() },
  });
  await writeAudit({
    userId: req.user.id,
    action: "DELETE_TEAM",
    module: "Teams",
    oldData: team,
  });

  res.json({ success: true, message: "Team removed" });
});

const getTeamAttendance = asyncHandler(async (req, res) => {
  const { date } = req.query;
  const team = await prisma.team.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!team) throw new ApiError(404, "Team not found");

  const targetDate = date ? new Date(date) : new Date();
  targetDate.setUTCHours(0, 0, 0, 0);

  const attendance = await prisma.attendance.findMany({
    where: { attendanceDate: targetDate, employee: { teamId: team.id } },
    include: {
      employee: { include: { user: { select: { fullName: true } } } },
    },
  });

  res.json({ success: true, data: attendance });
});

module.exports = {
  createTeam,
  listTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  getTeamAttendance,
};
