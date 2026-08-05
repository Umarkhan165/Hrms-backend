const prisma = require('../config/db');

// Fire-and-forget audit log writer used by controllers after a mutating action.
const writeAudit = async ({ userId, action, module, oldData, newData }) => {
  try {
    await prisma.auditLog.create({
      data: { userId, action, module, oldData: oldData ?? undefined, newData: newData ?? undefined },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
};

module.exports = { writeAudit };
