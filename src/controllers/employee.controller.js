const crypto = require("crypto");
const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { getPagination, getSort } = require("../utils/pagination");
const { writeAudit } = require("../middleware/audit");
const { sendMail } = require("../utils/mailer");
const getMyProfile = asyncHandler(async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: {
      userId: req.user.id,
      deletedAt: null,
    },

    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
        },
      },

      department: true,

      team: true,

      manager: {
        include: {
          user: {
            select: {
              fullName: true,
            },
          },
        },
      },

      documents: true,
    },
  });

  if (!employee) {
    throw new ApiError(404, "Employee profile not found");
  }

  res.json({
    success: true,
    data: employee,
  });
});

// POST /employees/onboard  - HR creates the USERS + EMPLOYEES instance,
// generates the activation token and emails the invite link.
// POST /employees/onboard  - HR creates the USERS + EMPLOYEES instance,
// generates the activation token and emails the invite link.
const onboardEmployee = asyncHandler(async (req, res) => {
  const {
    email,
    fullName,
    role = "EMPLOYEE",
    employeeCode,
    designation,
    departmentId,
    teamId,
    managerId,
    employmentType = "FULL_TIME",
    salary,
    joiningDate,
  } = req.body;

  if (!email || !fullName || !employeeCode || !designation || !joiningDate) {
    throw new ApiError(
      400,
      "email, fullName, employeeCode, designation and joiningDate are required",
    );
  }

  // Safe parsing to prevent type errors
  const safeEmail = String(email).toLowerCase().trim();
  const parsedJoiningDate = new Date(joiningDate);
  if (isNaN(parsedJoiningDate.getTime())) {
    throw new ApiError(400, "Invalid joiningDate format");
  }

  let parsedSalary = null;
  if (salary !== undefined && salary !== null) {
    parsedSalary = parseFloat(salary);
    if (isNaN(parsedSalary)) throw new ApiError(400, "Invalid salary format");
  }

  const existing = await prisma.user.findUnique({
    where: { email: safeEmail },
  });

  if (existing) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const activationToken = crypto.randomBytes(32).toString("hex");
  const expiryMinutes =
    Number(process.env.ACTIVATION_TOKEN_EXPIRY_MINUTES) || 60;
  const activationTokenExpiry = new Date(
    Date.now() + expiryMinutes * 60 * 1000,
  );

  let result;

  // Guarded DB Creation Transaction
  try {
    result = await prisma.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          email: safeEmail,
          fullName,
          role,
          isActive: false,
          isVerified: false,
          activationToken,
          activationTokenExpiry,
        },
      });

      // 2. Create Employee
      const employee = await tx.employee.create({
        data: {
          userId: user.id,
          employeeCode,
          designation,
          employmentType,
          salary: parsedSalary,
          joiningDate: parsedJoiningDate,
          status: "PENDING",
          departmentId: departmentId || null,
          teamId: teamId || null,
          managerId: managerId || null,
        },
      });

      // 3. Create Default Leave Balances
      // Replaced createMany with Promise.all to support SQLite and edge cases
      const defaultLeaves = [
        { leaveType: "CASUAL", allocatedDays: 12, remainingDays: 12 },
        { leaveType: "SICK", allocatedDays: 10, remainingDays: 10 },
        { leaveType: "ANNUAL", allocatedDays: 15, remainingDays: 15 },
      ];

      await Promise.all(
        defaultLeaves.map((leave) =>
          tx.leaveBalance.create({
            data: {
              employee: { connect: { id: employee.id } }, // <-- Fixed relation connection
              leaveType: leave.leaveType,
              allocatedDays: leave.allocatedDays,
              remainingDays: leave.remainingDays,
            },
          }),
        ),
      );

      return { user, employee };
    });
  } catch (dbError) {
    console.error("Database Transaction Error:", dbError);

    if (dbError.code === "P2002") {
      const target = dbError.meta?.target || "field";
      throw new ApiError(
        409,
        `An employee with this ${target} already exists.`,
      );
    }

    if (dbError.code === "P2003") {
      throw new ApiError(
        400,
        "Invalid reference provided for departmentId, teamId, or managerId.",
      );
    }

    throw new ApiError(
      500,
      `Database error during onboarding: ${dbError.message}`,
    );
  }

  // Guarded Audit Logging
  try {
    if (typeof writeAudit === "function" && req.user?.id) {
      await writeAudit({
        userId: req.user.id,
        action: "ONBOARD_EMPLOYEE",
        module: "Employees",
        newData: {
          userId: result.user.id,
          employeeId: result.employee.id,
        },
      });
    }
  } catch (auditError) {
    console.error("Audit log error during onboarding:", auditError.message);
  }

  // Non-blocking Mailer Dispatch
  const clientUrl =
    process.env.CLIENT_URL || "https://hrms-frontend-tau-gold.vercel.app";
  const activationLink = `${clientUrl}/setup?token=${activationToken}`;
  let emailSent = false;

  try {
    if (typeof sendMail === "function") {
      await sendMail({
        to: safeEmail,
        subject: "Activate your HRMS Account",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Welcome ${fullName}</h2>
            <p>Your HRMS account has been created.</p>
            <p>Click below to activate your account:</p>
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
      emailSent = true;
    }
  } catch (mailError) {
    console.error(
      "Onboarding activation email failed to send:",
      mailError.message,
    );
  }

  // Return success response regardless of mail status
  return res.status(201).json({
    success: true,
    message: emailSent
      ? "Employee onboarded successfully - activation email sent"
      : "Employee onboarded successfully (activation email delivery failed - check SMTP setup)",
    data: {
      userId: result.user.id,
      employeeId: result.employee.id,
      ...(!emailSent && { activationToken }),
    },
  });
});
// GET /employees  - directory list with pagination/filter/search/sort
const listEmployees = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const orderBy = getSort(
    req.query,
    ["joiningDate", "createdAt", "designation"],
    "createdAt",
  );
  const { search, departmentId, teamId, status } = req.query;

  const where = {
    deletedAt: null,
    ...(departmentId ? { departmentId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { designation: { contains: search, mode: "insensitive" } },
            { employeeCode: { contains: search, mode: "insensitive" } },
            { user: { fullName: { contains: search, mode: "insensitive" } } },
            { user: { email: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, employees] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
      },
    }),
  ]);

  res.json({
    success: true,
    data: employees,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// GET /employees/:id

const getEmployee = asyncHandler(async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isActive: true,
          isVerified: true,
        },
      },
      department: true,
      team: true,
      manager: { include: { user: { select: { fullName: true } } } },
      documents: true,
    },
  });
  if (!employee) throw new ApiError(404, "Employee not found");
  res.json({ success: true, data: employee });
});

// PUT /employees/:id  - update profile fields (self or HR/Admin)
const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!employee) throw new ApiError(404, "Employee not found");

  const isSelf = employee.userId === req.user.id;
  const isPrivileged = ["HR", "ADMIN"].includes(req.user.role);
  if (!isSelf && !isPrivileged)
    throw new ApiError(403, "Not allowed to update this employee");

  // Self-service employees may only touch their own contact-ish fields;
  // org placement / pay / status stays HR & Admin only.
  const selfAllowed = ["designation"];
  const privilegedOnly = [
    "departmentId",
    "teamId",
    "managerId",
    "employmentType",
    "salary",
    "status",
  ];

  const data = {};
  for (const key of Object.keys(req.body)) {
    if (
      isPrivileged &&
      (selfAllowed.includes(key) || privilegedOnly.includes(key))
    )
      data[key] = req.body[key];
    else if (isSelf && selfAllowed.includes(key)) data[key] = req.body[key];
  }

  const updated = await prisma.employee.update({
    where: { id: employee.id },
    data,
  });

  await writeAudit({
    userId: req.user.id,
    action: "UPDATE_EMPLOYEE",
    module: "Employees",
    oldData: employee,
    newData: updated,
  });

  res.json({ success: true, data: updated });
});

// DELETE /employees/:id  - soft delete (HR/Admin only)

const softDeleteEmployee = asyncHandler(async (req, res) => {
  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!employee) throw new ApiError(404, "Employee not found");

  await prisma.employee.update({
    where: { id: employee.id },
    data: { deletedAt: new Date(), status: "TERMINATED" },
  });
  await prisma.user.update({
    where: { id: employee.userId },
    data: { deletedAt: new Date(), isActive: false },
  });

  await writeAudit({
    userId: req.user.id,
    action: "DELETE_EMPLOYEE",
    module: "Employees",
    oldData: employee,
  });

  res.json({ success: true, message: "Employee removed" });
});

// POST /employees/:id/documents  - record an uploaded personal/tax document
// (expects the file to already be uploaded to storage; this just stores the URL)

const addDocument = asyncHandler(async (req, res) => {
  const { docType, fileUrl } = req.body;
  if (!docType || !fileUrl)
    throw new ApiError(400, "docType and fileUrl are required");

  const employee = await prisma.employee.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!employee) throw new ApiError(404, "Employee not found");
  if (
    employee.userId !== req.user.id &&
    !["HR", "ADMIN"].includes(req.user.role)
  ) {
    throw new ApiError(
      403,
      "Not allowed to upload documents for this employee",
    );
  }

  const doc = await prisma.employeeDocument.create({
    data: { employeeId: employee.id, docType, fileUrl },
  });

  res.status(201).json({ success: true, data: doc });
});

module.exports = {
  onboardEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  softDeleteEmployee,
  getMyProfile,
  addDocument,
};
