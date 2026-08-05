const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { getPagination, getSort } = require("../utils/pagination");
const { writeAudit } = require("../middleware/audit");

// =========================
// ROLES
// =========================

// GET /rbac/roles
const listRoles = asyncHandler(async (req, res) => {
  const roles = await prisma.rbacRole.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { permissions: true } } },
  });
  res.json({ success: true, data: roles });
});

// POST /rbac/roles
const createRole = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) throw new ApiError(400, "name is required");

  const role = await prisma.rbacRole.create({
    data: { name, description: description || null },
  });

  await writeAudit({
    userId: req.user.id,
    action: "CREATE_ROLE",
    module: "RBAC",
    newData: role,
  });

  res.status(201).json({ success: true, data: role });
});

// =========================
// PERMISSIONS
// =========================

// GET /rbac/permissions  - filterable by module, paginated
const listPermissions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(req.query, ["module", "name", "createdAt"], "module");
  const { module } = req.query;

  const where = { ...(module ? { module } : {}) };

  const [total, permissions] = await Promise.all([
    prisma.permission.count({ where }),
    prisma.permission.findMany({ where, skip, take: limit, orderBy }),
  ]);

  res.json({
    success: true,
    data: permissions,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// POST /rbac/permissions
const createPermission = asyncHandler(async (req, res) => {
  const { name, module, action } = req.body;
  if (!name || !module || !action)
    throw new ApiError(400, "name, module and action are required");
  if (!["CREATE", "READ", "UPDATE", "DELETE"].includes(action))
    throw new ApiError(400, "action must be CREATE, READ, UPDATE or DELETE");

  const permission = await prisma.permission.create({
    data: { name, module, action },
  });

  await writeAudit({
    userId: req.user.id,
    action: "CREATE_PERMISSION",
    module: "RBAC",
    newData: permission,
  });

  res.status(201).json({ success: true, data: permission });
});

// =========================
// ROLE <-> PERMISSION ASSIGNMENT
// =========================

// GET /rbac/roles/:id/permissions  - permission ids currently assigned to a role
const getRolePermissions = asyncHandler(async (req, res) => {
  const role = await prisma.rbacRole.findUnique({
    where: { id: req.params.id },
  });
  if (!role) throw new ApiError(404, "Role not found");

  const assignments = await prisma.rbacRolePermission.findMany({
    where: { roleId: role.id },
    include: { permission: true },
  });

  res.json({
    success: true,
    data: assignments.map((a) => a.permission),
  });
});

// PUT /rbac/roles/:id/permissions  - body: { permissionIds: string[] }
// Replaces the full assignment set for a role atomically.
const setRolePermissions = asyncHandler(async (req, res) => {
  const { permissionIds } = req.body;
  if (!Array.isArray(permissionIds))
    throw new ApiError(400, "permissionIds must be an array");

  const role = await prisma.rbacRole.findUnique({
    where: { id: req.params.id },
  });
  if (!role) throw new ApiError(404, "Role not found");

  const before = await prisma.rbacRolePermission.findMany({
    where: { roleId: role.id },
    select: { permissionId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.rbacRolePermission.deleteMany({ where: { roleId: role.id } });

    if (permissionIds.length > 0) {
      await tx.rbacRolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
    }
  });

  await writeAudit({
    userId: req.user.id,
    action: "SET_ROLE_PERMISSIONS",
    module: "RBAC",
    oldData: { permissionIds: before.map((b) => b.permissionId) },
    newData: { permissionIds },
  });

  const updated = await prisma.rbacRolePermission.findMany({
    where: { roleId: role.id },
    include: { permission: true },
  });

  res.json({
    success: true,
    data: updated.map((a) => a.permission),
  });
});

module.exports = {
  listRoles,
  createRole,
  listPermissions,
  createPermission,
  getRolePermissions,
  setRolePermissions,
};
