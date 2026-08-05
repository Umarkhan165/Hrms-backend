const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { getPagination, getSort } = require('../utils/pagination');

const getEmployeeForUser = async (userId) => {
  const employee = await prisma.employee.findUnique({ where: { userId } });
  if (!employee) throw new ApiError(400, 'This user has no employee profile');
  return employee;
};

const notify = (userId, type, title, message) =>
  prisma.notification.create({ data: { userId, type, title, message } });

 
// POST /goals  - manager assigns a goal to a direct report 
const createGoal = asyncHandler(async (req, res) => {
  const { employeeId, title, description, targetDate, priority = 'MEDIUM' } = req.body;
  if (!employeeId || !title || !targetDate) throw new ApiError(400, 'employeeId, title and targetDate are required');

  const creator = await getEmployeeForUser(req.user.id);

  if (req.user.role === 'MANAGER') {
    const target = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!target || target.managerId !== creator.id) {
      throw new ApiError(403, 'You can only assign goals to your direct reports');
    }
  }

  const goal = await prisma.goal.create({
    data: {
      employeeId,
      createdById: creator.id,
      title,
      description,
      targetDate: new Date(targetDate),
      priority,
      status: 'NOT_STARTED',
      progress: 0,
    },
  });

  const target = await prisma.employee.findUnique({ where: { id: employeeId } });
  await notify(target.userId, 'GOAL_ASSIGNED', 'New goal assigned', `A new goal "${title}" has been assigned to you.`);

  res.status(201).json({ success: true, data: goal });
});

 
// GET /goals  - employee sees own; manager sees direct reports' 
const listGoals = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(req.query, ['targetDate', 'createdAt', 'progress'], 'createdAt');
  const { status, employeeId } = req.query;

  let where = { ...(status ? { status } : {}) };

  if (req.user.role === 'EMPLOYEE') {
    const employee = await getEmployeeForUser(req.user.id);
    where.employeeId = employee.id;
  } else if (req.user.role === 'MANAGER' && !employeeId) {
    const manager = await getEmployeeForUser(req.user.id);
    where.employee = { managerId: manager.id };
  } else if (employeeId) {
    where.employeeId = employeeId;
  }

  const [total, goals] = await Promise.all([
    prisma.goal.count({ where }),
    prisma.goal.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        employee: { include: { user: { select: { fullName: true } } } },
        updates: { orderBy: { createdAt: 'desc' } },
      },
    }),
  ]);

  res.json({ success: true, data: goals, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const getGoal = asyncHandler(async (req, res) => {
  const goal = await prisma.goal.findUnique({
    where: { id: req.params.id },
    include: { updates: { orderBy: { createdAt: 'desc' } }, employee: { include: { user: true } } },
  });
  if (!goal) throw new ApiError(404, 'Goal not found');
  res.json({ success: true, data: goal });
});

 
// PATCH /goals/:id/progress  - employee edits percent-complete with a comment 
const updateProgress = asyncHandler(async (req, res) => {
  const { progress, comment } = req.body;
  if (progress === undefined || progress < 0 || progress > 100) throw new ApiError(400, 'progress must be 0-100');
  if (!comment) throw new ApiError(400, 'A comment is required for every progress update');

  const goal = await prisma.goal.findUnique({ where: { id: req.params.id }, include: { employee: true } });
  if (!goal) throw new ApiError(404, 'Goal not found');
  if (goal.employee.userId !== req.user.id) throw new ApiError(403, 'You can only update your own goal progress');

  const status = progress === 100 ? 'ACHIEVED' : progress > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';

  const [updated] = await prisma.$transaction([
    prisma.goal.update({ where: { id: goal.id }, data: { progress, status } }),
    prisma.goalUpdate.create({ data: { goalId: goal.id, progress, comment } }),
  ]);

  if (progress === 100) {
    const creator = await prisma.employee.findUnique({ where: { id: goal.createdById } });
    if (creator) {
      await notify(
        creator.userId,
        'GOAL_VALIDATION',
        'Goal ready for validation',
        `"${goal.title}" reached 100% and needs your validation.`
      );
    }
  }

  res.json({ success: true, data: updated });
});

 
// PATCH /goals/:id/validate  - manager validates a goal at 100% progress 
const validateGoal = asyncHandler(async (req, res) => {
  const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!goal) throw new ApiError(404, 'Goal not found');
  if (goal.progress !== 100) throw new ApiError(400, 'Goal must be at 100% progress before it can be validated');

  const manager = await getEmployeeForUser(req.user.id);
  if (req.user.role === 'MANAGER' && goal.createdById !== manager.id) {
    throw new ApiError(403, 'Only the goal creator (manager) can validate it');
  }

  const updated = await prisma.goal.update({
    where: { id: goal.id },
    data: { validatedAt: new Date(), status: 'ACHIEVED' },
  });

  res.json({ success: true, data: updated });
});

module.exports = { createGoal, listGoals, getGoal, updateProgress, validateGoal };
