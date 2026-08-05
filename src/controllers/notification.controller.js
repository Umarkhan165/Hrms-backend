const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { getPagination } = require("../utils/pagination");
const { writeAudit } = require("../middleware/audit");

const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { unreadOnly } = req.query;

  const where = {
    userId: req.user.id,
    ...(unreadOnly === "true" ? { read: false } : {}),
  };

  const [total, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.json({
    success: true,
    data: notifications,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await prisma.notification.findUnique({
    where: { id: req.params.id },
  });
  if (!notification) throw new ApiError(404, "Notification not found");
  if (notification.userId !== req.user.id)
    throw new ApiError(403, "Not your notification");

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { read: true },
  });
  res.json({ success: true, data: updated });
});

// POST /notifications/broadcast  - HR/Admin sends a notification to all staff or one role
const broadcastNotification = asyncHandler(async (req, res) => {
  const { title, message, targetRole } = req.body;
  if (!title || !message)
    throw new ApiError(400, "title and message are required");
  if (
    targetRole &&
    !["EMPLOYEE", "MANAGER", "HR", "ADMIN"].includes(targetRole)
  ) {
    throw new ApiError(400, "Invalid targetRole");
  }

  const targetUsers = await prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(targetRole ? { role: targetRole } : {}),
    },
    select: { id: true },
  });

  if (targetUsers.length === 0)
    throw new ApiError(400, "No matching active users to notify");

  await prisma.notification.createMany({
    data: targetUsers.map((u) => ({
      userId: u.id,
      type: "BROADCAST",
      title,
      message,
    })),
  });

  const broadcast = await prisma.broadcast.create({
    data: {
      title,
      message,
      targetRole: targetRole || null,
      recipientCount: targetUsers.length,
      sentById: req.user.id,
    },
  });

  await writeAudit({
    userId: req.user.id,
    action: "BROADCAST_NOTIFICATION",
    module: "Notifications",
    newData: broadcast,
  });

  res.status(201).json({ success: true, data: broadcast });
});

// GET /notifications/broadcasts  - HR/Admin broadcast history feed
const listBroadcasts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [total, broadcasts] = await Promise.all([
    prisma.broadcast.count(),
    prisma.broadcast.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.json({
    success: true,
    data: broadcasts,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

module.exports = {
  listNotifications,
  markRead,
  broadcastNotification,
  listBroadcasts,
};
