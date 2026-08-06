const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { getPagination, getSort } = require("../utils/pagination");
const { writeAudit } = require("../middleware/audit");

// GET /users  - Admin HR directory of raw user accounts RBAC + session mgmt screens
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(req.query, ["fullName", "createdAt"], "createdAt");
  const { role, search } = req.query;

  const where = {
    deletedAt: null,
    ...(role ? { role } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        isVerified: true,
        lastLogin: true,
        createdAt: true,
      },
    }),
  ]);

  res.json({
    success: true,
    data: users,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// PATCH /users/:id/status  - Admin activate/deactivate override
const setUserStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== "boolean")
    throw new ApiError(400, "isActive must be true or false");

  const user = await prisma.user.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!user) throw new ApiError(404, "User not found");

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isActive },
  });

  if (!isActive) {
    // Deactivation also kills any live sessions immediately.
    await prisma.session.deleteMany({ where: { userId: user.id } });
  }

  await writeAudit({
    userId: req.user.id,
    action: "SET_USER_STATUS",
    module: "Users",
    oldData: { isActive: user.isActive },
    newData: { isActive },
  });

  res.json({ success: true, data: updated });
});

// PATCH /users/:id/role  - Admin RBAC role change
const setUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!["EMPLOYEE", "MANAGER", "HR", "ADMIN"].includes(role))
    throw new ApiError(400, "Invalid role");

  const user = await prisma.user.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!user) throw new ApiError(404, "User not found");

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role },
  });

  await writeAudit({
    userId: req.user.id,
    action: "SET_USER_ROLE",
    module: "Users",
    oldData: { role: user.role },
    newData: { role },
  });

  res.json({ success: true, data: updated });
});

module.exports = { listUsers, setUserStatus, setUserRole };
