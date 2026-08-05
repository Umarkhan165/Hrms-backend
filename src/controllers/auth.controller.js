const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const {
  signAccessToken,
  signRefreshToken,
  expiryToDate,
} = require("../utils/tokens");
const { sendMail } = require("../utils/mailer");
const { writeAudit } = require("../middleware/audit");

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
};

// POST /auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    throw new ApiError(400, "Email and password are required");

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user || user.deletedAt) throw new ApiError(401, "Invalid credentials");
  if (!user.isActive) throw new ApiError(403, "Account has been deactivated");
  if (!user.isVerified || !user.passwordHash) {
    throw new ApiError(
      403,
      "Account not activated yet - please check your onboarding email",
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new ApiError(401, "Invalid credentials");

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      ipAddress: req.ip,
      deviceInfo: req.headers["user-agent"] || null,
      expiresAt: expiryToDate(process.env.REFRESH_TOKEN_EXPIRY),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  res.cookie("refreshToken", refreshToken, cookieOptions);
  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    },
  });
});
// POST /auth/activate
// Activate account + save document URLs

const activate = asyncHandler(async (req, res) => {
  const { token, password, documents = [] } = req.body;

  if (!token || !password) {
    throw new ApiError(400, "Token and password are required");
  }

  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const user = await prisma.user.findUnique({
    where: {
      activationToken: token,
    },
  });

  if (!user) {
    throw new ApiError(400, "Invalid activation token");
  }

  if (user.activationTokenExpiry && user.activationTokenExpiry < new Date()) {
    throw new ApiError(400, "Activation token expired");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash: passwordHash,

        isActive: true,

        isVerified: true,

        activationToken: null,

        activationTokenExpiry: null,
      },
    });

    const employee = await tx.employee.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!employee) {
      throw new ApiError(404, "Employee profile not found");
    }

    await tx.employee.update({
      where: {
        id: employee.id,
      },

      data: {
        status: "ACTIVE",
      },
    });

    if (documents.length > 0) {
      await tx.employeeDocument.createMany({
        data: documents.map((doc) => ({
          employeeId: employee.id,

          docType: doc.docType,

          fileUrl: doc.fileUrl,
        })),
      });
    }

    return {
      employeeId: employee.id,
      userId: updatedUser.id,
    };
  });

  await writeAudit({
    userId: user.id,

    action: "ACCOUNT_ACTIVATED",

    module: "Employees",

    newData: result,
  });

  res.json({
    success: true,

    message: "Account activated successfully",
  });
});

// POST /auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const token = req.body.refreshToken || req.cookies?.refreshToken;
  if (!token) throw new ApiError(401, "Refresh token missing");

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const session = await prisma.session.findFirst({
    where: { userId: decoded.id, refreshToken: token },
  });
  if (!session || session.expiresAt < new Date())
    throw new ApiError(401, "Session expired, please log in again");

  const user = await prisma.user.findUnique({ where: { id: decoded.id } });
  if (!user || !user.isActive || user.deletedAt)
    throw new ApiError(401, "User not found or inactive");

  const accessToken = signAccessToken(user);
  res.json({ success: true, data: { accessToken } });
});

// POST /auth/logout
const logout = asyncHandler(async (req, res) => {
  const token = req.body.refreshToken || req.cookies?.refreshToken;
  if (token)
    await prisma.session.deleteMany({ where: { refreshToken: token } });
  res.clearCookie("refreshToken", cookieOptions);
  res.json({ success: true, message: "Logged out" });
});

// GET /auth/me
const me = asyncHandler(async (req, res) => {
  const { passwordHash, activationToken, ...safeUser } = req.user;
  res.json({ success: true, data: safeUser });
});

// DELETE /sessions/:id
const revokeSession = asyncHandler(async (req, res) => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
  });
  if (!session) throw new ApiError(404, "Session not found");
  if (session.userId !== req.user.id && req.user.role !== "ADMIN") {
    throw new ApiError(403, "Not allowed to revoke this session");
  }
  await prisma.session.delete({ where: { id: session.id } });
  res.json({ success: true, message: "Session revoked" });
});
// Show my sessions
const listMySessions = asyncHandler(async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.user.id },
    select: {
      id: true,
      ipAddress: true,
      deviceInfo: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ success: true, data: sessions });
});

module.exports = {
  login,
  activate,
  refresh,
  logout,
  me,
  revokeSession,
  listMySessions,
  _internal: { sendMail, crypto },
};
