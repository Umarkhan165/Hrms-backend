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
import crypto from "crypto";
import { prisma } from "../config/prisma.js"; // Adjust path to your Prisma client instance
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendMail } from "../utils/sendMail.js";

// PATCH /api/users/:id/status
export const setUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    throw new ApiError(400, "isActive boolean state is required");
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // IF ACTIVATING AN INACTIVE USER: Generate new token and email link
  if (isActive) {
    const activationToken = crypto.randomBytes(32).toString("hex");
    const activationTokenExpiry = new Date(
      Date.now() +
        (Number(process.env.ACTIVATION_TOKEN_EXPIRY_MINUTES) || 60) * 60 * 1000,
    );

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        activationToken,
        activationTokenExpiry,
      },
    });

    const activationLink = `${process.env.CLIENT_URL}/setup?token=${activationToken}`;

    try {
      await sendMail({
        to: user.email,
        subject: "Activate your Account",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Account Activation Link</h2>
            <p>Hello ${user.fullName},</p>
            <p>An administrator has generated an activation link for your account.</p>
            <p>Click below to complete account setup:</p>
            <p style="margin: 20px 0;">
              <a href="${activationLink}" 
                 style="background: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Activate Account
              </a>
            </p>
            <p>This link expires in ${process.env.ACTIVATION_TOKEN_EXPIRY_MINUTES || 60} minutes.</p>
          </div>
        `,
      });
    } catch (error) {
      throw new ApiError(
        500,
        `Failed to send activation email: ${error.message}`,
      );
    }

    return res.status(200).json({
      success: true,
      message: "Activation token generated and email dispatched successfully",
      data: updatedUser,
    });
  }

  // IF DEACTIVATING: Deactivate status and clear active session flags
  const deactivatedUser = await prisma.user.update({
    where: { id },
    data: {
      isActive: false,
    },
  });

  return res.status(200).json({
    success: true,
    message: "User deactivated successfully",
    data: deactivatedUser,
  });
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
