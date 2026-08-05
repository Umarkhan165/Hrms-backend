const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { getPagination, getSort } = require('../utils/pagination');
const { writeAudit } = require('../middleware/audit');

const getEmployeeIdForUser = async (userId) => {
  const employee = await prisma.employee.findUnique({ where: { userId } });
  if (!employee) throw new ApiError(400, 'This user has no employee profile');
  return employee;
};

const daysBetweenInclusive = (start, end) => Math.floor((end - start) / 86400000) + 1;

const notify = (userId, type, title, message) =>
  prisma.notification.create({ data: { userId, type, title, message } });

 
// GET /leave-types 
const listLeaveTypes = asyncHandler(async (req, res) => {
  const leaveTypes = await prisma.leaveType.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: leaveTypes });
});

const createLeaveType = asyncHandler(async (req, res) => {
  const { name, defaultAllocation = 0 } = req.body;
  if (!name) throw new ApiError(400, 'name is required');
  const leaveType = await prisma.leaveType.create({ data: { name, defaultAllocation } });
  res.status(201).json({ success: true, data: leaveType });
});

 
// GET /leave-balances  - current employee's balances, or ?employeeId= for HR
 
const getLeaveBalances = asyncHandler(async (req, res) => {
  let employeeId = req.query.employeeId;
  if (req.user.role === 'EMPLOYEE' || !employeeId) {
    const employee = await getEmployeeIdForUser(req.user.id);
    employeeId = employee.id;
  }

  const balances = await prisma.leaveBalance.findMany({
    where: { employeeId },
    include: { leaveType: true },
  });

  res.json({ success: true, data: balances });
});

 
// POST /leave-requests  - employee submits, validated against balance quota
const createLeaveRequest = asyncHandler(async (req, res) => {
  const { leaveTypeId, startDate, endDate, reason } = req.body;
  if (!leaveTypeId || !startDate || !endDate || !reason) {
    throw new ApiError(400, 'leaveTypeId, startDate, endDate and reason are required');
  }

  const employee = await getEmployeeIdForUser(req.user.id);
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < start) throw new ApiError(400, 'endDate cannot be before startDate');
  const days = daysBetweenInclusive(start, end);

  const balance = await prisma.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId: { employeeId: employee.id, leaveTypeId } },
  });
  if (!balance || balance.remainingDays < days) {
    throw new ApiError(400, 'Insufficient leave balance for this request');
  }

  const leaveRequest = await prisma.leaveRequest.create({
    data: { employeeId: employee.id, leaveTypeId, startDate: start, endDate: end, days, reason },
  });

  if (employee.managerId) {
    const manager = await prisma.employee.findUnique({ where: { id: employee.managerId } });
    if (manager) {
      await notify(
        manager.userId,
        'LEAVE_REQUEST',
        'New leave request',
        `A leave request for ${days} day(s) is waiting for your review.`
      );
    }
  }

  res.status(201).json({ success: true, data: leaveRequest });
});

 
// GET /leave-requests  - employee sees own; manager sees direct reports'
// pending-manager-review; HR sees all pending-HR / all, filterable
 
const listLeaveRequests = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(req.query, ['requestedAt', 'startDate'], 'requestedAt');
  const { status, employeeId } = req.query;

  let where = { ...(status ? { status } : {}) };

  if (req.user.role === 'EMPLOYEE') {
    const employee = await getEmployeeIdForUser(req.user.id);
    where.employeeId = employee.id;
  } else if (req.user.role === 'MANAGER') {
    const manager = await getEmployeeIdForUser(req.user.id);
    where.employee = { managerId: manager.id };
    if (!status) where.status = 'PENDING';
  } else if (employeeId) {
    where.employeeId = employeeId;
  }

  const [total, requests] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        leaveType: true,
        employee: { include: { user: { select: { fullName: true, email: true } } } },
      },
    }),
  ]);

  res.json({ success: true, data: requests, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

 
// PUT /leave-requests/:id/manager-review  - first-gate approval
 
const managerReview = asyncHandler(async (req, res) => {
  const { decision, comment } = req.body; // decision: 'APPROVE' | 'REJECT'
  if (!['APPROVE', 'REJECT'].includes(decision)) throw new ApiError(400, "decision must be 'APPROVE' or 'REJECT'");

  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include: { employee: true },
  });
  if (!leaveRequest) throw new ApiError(404, 'Leave request not found');
  if (leaveRequest.status !== 'PENDING') throw new ApiError(400, 'This request has already moved past manager review');

  const manager = await getEmployeeIdForUser(req.user.id);
  if (req.user.role === 'MANAGER' && leaveRequest.employee.managerId !== manager.id) {
    throw new ApiError(403, 'You can only review requests from your direct reports');
  }

  const status = decision === 'APPROVE' ? 'APPROVED_MANAGER' : 'REJECTED';

  const updated = await prisma.leaveRequest.update({
    where: { id: leaveRequest.id },
    data: { status, managerComment: comment || null, decidedAt: decision === 'REJECT' ? new Date() : null },
  });

  await notify(
    leaveRequest.employee.userId,
    status === 'REJECTED' ? 'LEAVE_REJECTED' : 'LEAVE_REQUEST',
    status === 'REJECTED' ? 'Leave request rejected' : 'Leave request approved by manager',
    status === 'REJECTED'
      ? `Your manager rejected your leave request. Reason: ${comment || 'No reason given'}`
      : 'Your manager approved your leave request. It now moves to HR for final approval.'
  );

  await writeAudit({
    userId: req.user.id,
    action: `LEAVE_MANAGER_${decision}`,
    module: 'Leave',
    oldData: leaveRequest,
    newData: updated,
  });

  res.json({ success: true, data: updated });
});

 
// PUT /leave-requests/:id/hr-approve  - second-gate, atomic balance deduction
 
const hrApprove = asyncHandler(async (req, res) => {
  const { decision, comment } = req.body; // decision: 'APPROVE' | 'REJECT'
  if (!['APPROVE', 'REJECT'].includes(decision)) throw new ApiError(400, "decision must be 'APPROVE' or 'REJECT'");

  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include: { employee: true },
  });
  if (!leaveRequest) throw new ApiError(404, 'Leave request not found');
  if (leaveRequest.status !== 'APPROVED_MANAGER') {
    throw new ApiError(400, 'This request is not awaiting HR approval');
  }

  const status = decision === 'APPROVE' ? 'APPROVED_HR' : 'REJECTED';

  const updated = await prisma.$transaction(async (tx) => {
    const req_ = await tx.leaveRequest.update({
      where: { id: leaveRequest.id },
      data: { status, hrComment: comment || null, decidedAt: new Date() },
    });

    if (decision === 'APPROVE') {
      await tx.leaveBalance.update({
        where: { employeeId_leaveTypeId: { employeeId: leaveRequest.employeeId, leaveTypeId: leaveRequest.leaveTypeId } },
        data: { remainingDays: { decrement: leaveRequest.days } },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: req.user.id,
        action: `LEAVE_HR_${decision}`,
        module: 'Leave',
        oldData: leaveRequest,
        newData: req_,
      },
    });

    return req_;
  });

  await notify(
    leaveRequest.employee.userId,
    status === 'REJECTED' ? 'LEAVE_REJECTED' : 'LEAVE_APPROVED',
    status === 'REJECTED' ? 'Leave request rejected by HR' : 'Leave request fully approved',
    status === 'REJECTED'
      ? `HR rejected your leave request. Reason: ${comment || 'No reason given'}`
      : 'Your leave request has been fully approved and your balance has been updated.'
  );

  res.json({ success: true, data: updated });
});

module.exports = {
  listLeaveTypes,
  createLeaveType,
  getLeaveBalances,
  createLeaveRequest,
  listLeaveRequests,
  managerReview,
  hrApprove,
};
