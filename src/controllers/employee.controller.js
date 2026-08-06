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

  const existing = await prisma.user.findUnique({
    where: {
      email: email.toLowerCase(),
    },
  });

  if (existing) {
    throw new ApiError(409, "A user with this email already exists");
  }

  const activationToken = crypto.randomBytes(32).toString("hex");

  const activationTokenExpiry = new Date(
    Date.now() +
      (Number(process.env.ACTIVATION_TOKEN_EXPIRY_MINUTES) || 60) * 60 * 1000,
  );

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email.toLowerCase(),
        fullName,
        role,

        isActive: false,
        isVerified: false,

        activationToken,
        activationTokenExpiry,
      },
    });

    const employee = await tx.employee.create({
      data: {
        userId: user.id,

        employeeCode,

        designation,

        employmentType,

        salary: salary ?? null,

        joiningDate: new Date(joiningDate),

        status: "PENDING",

        departmentId: departmentId || null,

        teamId: teamId || null,

        managerId: managerId || null,
      },
    });

    return {
      user,
      employee,
    };
  });

  await writeAudit({
    userId: req.user.id,

    action: "ONBOARD_EMPLOYEE",

    module: "Employees",

    newData: {
      userId: result.user.id,
      employeeId: result.employee.id,
    },
  });

  const activationLink = `${process.env.CLIENT_URL}/setup?token=${activationToken}`;

  // TRY SENDING EMAIL
  try {
    await sendMail({
      to: email,

      subject: "Activate your HRMS Account",

      html: `
      <div style="font-family:Arial">
        <h2>Welcome ${fullName}</h2>
        <p>Your HRMS account has been created.</p>
        <p>Click below to activate your account:</p>
        <a href="${activationLink}"
          style="
          background:#2563eb;
          color:white;
          padding:12px 20px;
          text-decoration:none;
          border-radius:5px;
          ">
          Activate Account
        </a>
        <p>
          This link expires in ${process.env.ACTIVATION_TOKEN_EXPIRY_MINUTES || 60} minutes.
        </p>
      </div>
      `,
    });
  } catch (error) {
    console.error("Onboarding email failed to send:", error.message);

    // ROLLBACK: Delete DB records so account creation is cancelled
    await prisma.employee.delete({
      where: { id: result.employee.id },
    });

    await prisma.user.delete({
      where: { id: result.user.id },
    });

    // Send HTTP error response back to frontend
    throw new ApiError(
      500,
      `Failed to send activation email (${error.message}). Onboarding cancelled.`,
    );
  }

  // ONLY SENT IF EMAIL SUCCESSFUL
  res.status(201).json({
    success: true,
    message: "Employee onboarded successfully - activation email sent",
    data: {
      userId: result.user.id,
      employeeId: result.employee.id,
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
