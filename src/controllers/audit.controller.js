const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { getPagination, getSort } = require("../utils/pagination");

// GET /audit-logs  - HR/Admin only, filterable
const listAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(req.query, ["createdAt"], "createdAt");
  const { module, userId, action } = req.query;

  const where = {
    ...(module ? { module } : {}),
    ...(userId ? { userId } : {}),
    ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: { user: { select: { fullName: true, email: true } } },
    }),
  ]);

  res.json({
    success: true,
    data: logs,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

module.exports = { listAuditLogs };
