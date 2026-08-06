const crypto = require("crypto");
const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { getPagination, getSort } = require("../utils/pagination");

// Defensive module loading for mailer (supports both mailer.js and sendMail.js)
let sendMail;
try {
  sendMail = require("../utils/mailer").sendMail;
} catch (e1) {
  try {
    sendMail = require("../utils/sendMail").sendMail;
  } catch (e2) {
    sendMail = async ({ to, subject }) => {
      console.log(
        `[mailer fallback] Email dispatch skipped for ${to}: ${subject}`,
      );
    };
  }
}

// Defensive module loading for audit logging
let writeAudit = () => {};
try {
  const auditModule = require("../middleware/audit");
  if (auditModule && typeof auditModule.writeAudit === "function") {
    writeAudit = auditModule.writeAudit;
  }
} catch (e) {
  // Audit module is optional
}

// GET /users - Directory listing
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

// PATCH /users/:id/status - Activate/Deactivate user & onboarding dispatch
const setUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    throw new ApiError(400, "isActive boolean state is required");
  }

  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // ONBOARDING / ACTIVATION FLOW
  if (isActive) {
    const activationToken = crypto.randomBytes(32).toString("hex");
    const expiryMinutes =
      Number(process.env.ACTIVATION_TOKEN_EXPIRY_MINUTES) || 60;
    const activationTokenExpiry = new Date(
      Date.now() + expiryMinutes * 60 * 1000,
    );

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isActive: true,
        activationToken,
        activationTokenExpiry,
      },
    });

    const clientUrl =
      process.env.CLIENT_URL || "https://hrms-frontend-tau-gold.vercel.app";
    const activationLink = `${clientUrl}/setup?token=${activationToken}`;

    let emailStatus = "sent";
    try {
      await sendMail({
        to: user.email,
        subject: "Activate your HRMS Account",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Account Activation Link</h2>
            <p>Hello ${user.fullName},</p>
            <p>An administrator has activated your account. Click below to complete account setup:</p>
            <p style="margin: 20px 0;">
              <a href="${activationLink}" 
                 style="background: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                Activate Account
              </a>
            </p>
            <p>This link expires in ${expiryMinutes} minutes.</p>
          </div>
        `,
      });
    } catch (mailError) {
      console.error("Email send failure:", mailError.message);
      emailStatus = "failed_to_send";
    }

    try {
      if (req.user?.id) {
        await writeAudit({
          userId: req.user.id,
          action: "SET_USER_STATUS",
          module: "Users",
          oldData: { isActive: user.isActive },
          newData: { isActive: true },
        });
      }
    } catch (auditErr) {
      console.error("Audit log error:", auditErr.message);
    }

    return res.status(200).json({
      success: true,
      message:
        emailStatus === "sent"
          ? "User activated and onboarding email sent successfully"
          : "User activated successfully, but email notification could not be delivered.",
      data: updatedUser,
    });
  }

  // DEACTIVATION FLOW
  const deactivatedUser = await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  try {
    if (prisma.session) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }
  } catch (sessionErr) {
    console.error("Session delete error:", sessionErr.message);
  }

  try {
    if (req.user?.id) {
      await writeAudit({
        userId: req.user.id,
        action: "SET_USER_STATUS",
        module: "Users",
        oldData: { isActive: user.isActive },
        newData: { isActive: false },
      });
    }
  } catch (auditErr) {
    console.error("Audit log error:", auditErr.message);
  }

  return res.status(200).json({
    success: true,
    message: "User deactivated successfully",
    data: deactivatedUser,
  });
});

// PATCH /users/:id/role - Admin RBAC role change
const setUserRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const validRoles = ["EMPLOYEE", "MANAGER", "HR", "ADMIN"];
  if (!role || !validRoles.includes(role)) {
    throw new ApiError(400, "Invalid role specified");
  }

  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const updatedUser = await prisma.user.update({
    where: { id },
    data: { role },
  });

  try {
    if (req.user?.id) {
      await writeAudit({
        userId: req.user.id,
        action: "SET_USER_ROLE",
        module: "Users",
        oldData: { role: user.role },
        newData: { role },
      });
    }
  } catch (auditErr) {
    console.error("Audit log error:", auditErr.message);
  }

  return res.status(200).json({
    success: true,
    message: "User role updated successfully",
    data: updatedUser,
  });
});

module.exports = { listUsers, setUserStatus, setUserRole };
