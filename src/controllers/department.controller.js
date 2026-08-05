const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { getPagination, getSort } = require('../utils/pagination');
const { writeAudit } = require('../middleware/audit');

const createDepartment = asyncHandler(async (req, res) => {
  const { name, managerId } = req.body;
  if (!name) throw new ApiError(400, 'name is required');

  const department = await prisma.department.create({ data: { name, managerId: managerId || null } });
  await writeAudit({ userId: req.user.id, action: 'CREATE_DEPARTMENT', module: 'Departments', newData: department });
  res.status(201).json({ success: true, data: department });
});

const listDepartments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(req.query, ['name', 'createdAt'], 'name');
  const { search } = req.query;

  const where = {
    deletedAt: null,
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };

  const [total, departments] = await Promise.all([
    prisma.department.count({ where }),
    prisma.department.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        manager: { select: { id: true, fullName: true, email: true } },
        _count: { select: { employees: true, teams: true } },
      },
    }),
  ]);

  res.json({ success: true, data: departments, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const getDepartment = asyncHandler(async (req, res) => {
  const department = await prisma.department.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { manager: { select: { id: true, fullName: true } }, teams: true },
  });
  if (!department) throw new ApiError(404, 'Department not found');
  res.json({ success: true, data: department });
});

const updateDepartment = asyncHandler(async (req, res) => {
  const { name, managerId } = req.body;
  const department = await prisma.department.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!department) throw new ApiError(404, 'Department not found');

  const updated = await prisma.department.update({
    where: { id: department.id },
    data: { ...(name && { name }), ...(managerId !== undefined && { managerId }) },
  });

  await writeAudit({
    userId: req.user.id,
    action: 'UPDATE_DEPARTMENT',
    module: 'Departments',
    oldData: department,
    newData: updated,
  });

  res.json({ success: true, data: updated });
});

const deleteDepartment = asyncHandler(async (req, res) => {
  const department = await prisma.department.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!department) throw new ApiError(404, 'Department not found');

  await prisma.department.update({ where: { id: department.id }, data: { deletedAt: new Date() } });
  await writeAudit({ userId: req.user.id, action: 'DELETE_DEPARTMENT', module: 'Departments', oldData: department });

  res.json({ success: true, message: 'Department removed' });
});

module.exports = { createDepartment, listDepartments, getDepartment, updateDepartment, deleteDepartment };
