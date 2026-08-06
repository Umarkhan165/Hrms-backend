require("dotenv/config");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const hash = (plain) => bcrypt.hash(plain, 10);

const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const atHour = (date, hour, minute = 0) => {
  const d = new Date(date);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
};

async function ensureDepartment(name) {
  const existing = await prisma.department.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.department.create({ data: { name } });
}

async function ensureTeam(name, departmentId) {
  const existing = await prisma.team.findFirst({
    where: { name, departmentId },
  });
  if (existing) return existing;
  return prisma.team.create({ data: { name, departmentId } });
}

async function ensureUser({ email, fullName, role, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      fullName,
      role,
      isVerified: true,
      isActive: true,
      passwordHash: await hash(password),
    },
  });
}

async function ensureEmployee({
  userId,
  employeeCode,
  designation,
  departmentId,
  teamId,
  managerId,
  joiningDate,
}) {
  const existing = await prisma.employee.findUnique({
    where: { employeeCode },
  });
  if (existing) return existing;
  return prisma.employee.create({
    data: {
      userId,
      employeeCode,
      designation,
      departmentId: departmentId || null,
      teamId: teamId || null,
      managerId: managerId || null,
      joiningDate,
      status: "ACTIVE",
      employmentType: "FULL_TIME",
    },
  });
}

async function ensureLeaveBalance(employeeId, leaveTypeId, remainingDays) {
  return prisma.leaveBalance.upsert({
    where: { employeeId_leaveTypeId: { employeeId, leaveTypeId } },
    update: {},
    create: { employeeId, leaveTypeId, remainingDays },
  });
}

async function ensureAttendance(
  employeeId,
  attendanceDate,
  { clockInHour, clockOutHour, status, breakMinutes = 0 },
) {
  const existing = await prisma.attendance.findUnique({
    where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
  });
  if (existing) return existing;

  if (status === "ABSENT") {
    return prisma.attendance.create({
      data: { employeeId, attendanceDate, status: "ABSENT" },
    });
  }

  const clockIn = atHour(attendanceDate, clockInHour);
  const clockOut =
    clockOutHour != null ? atHour(attendanceDate, clockOutHour) : null;
  let totalHours = null;
  const attendance = await prisma.attendance.create({
    data: { employeeId, attendanceDate, clockIn, clockOut, status },
  });

  if (breakMinutes > 0) {
    const breakStart = atHour(attendanceDate, clockInHour, 30);
    const breakEnd = new Date(breakStart.getTime() + breakMinutes * 60000);
    await prisma.attendanceBreak.create({
      data: {
        attendanceId: attendance.id,
        startTime: breakStart,
        endTime: breakEnd,
        durationMinutes: breakMinutes,
      },
    });
  }

  if (clockOut) {
    const grossMinutes = (clockOut - clockIn) / 60000;
    totalHours = ((grossMinutes - breakMinutes) / 60).toFixed(2);
    await prisma.attendance.update({
      where: { id: attendance.id },
      data: { totalHours },
    });
  }

  return attendance;
}

async function notify(userId, type, title, message) {
  return prisma.notification.create({ data: { userId, type, title, message } });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Starting full dummy data seed...");

  // --- Leave types -----------------------------------------------------------
  const leaveTypeDefs = [
    { name: "Casual Leave", defaultAllocation: 10 },
    { name: "Sick Leave", defaultAllocation: 15 },
    { name: "Earned Leave", defaultAllocation: 20 },
  ];
  const leaveTypes = [];
  for (const lt of leaveTypeDefs) {
    leaveTypes.push(
      await prisma.leaveType.upsert({
        where: { name: lt.name },
        update: {},
        create: lt,
      }),
    );
  }
  const [casual, sick, earned] = leaveTypes;
  console.log("✔ Leave types ready");

  // --- Org structure -----------------------------------------------------------
  const engineering = await ensureDepartment("Engineering");
  const sales = await ensureDepartment("Sales");
  const people = await ensureDepartment("People");
  const backend = await ensureTeam("Backend", engineering.id);
  const frontend = await ensureTeam("Frontend", engineering.id);
  console.log("✔ Departments + teams ready");

  // --- Admin -------------------------------------------------------------------
  await ensureUser({
    email: "admin@hrms.local",
    fullName: "System Administrator",
    role: "ADMIN",
    password: "Admin123!",
  });

  // --- HR ----------------------------------------------------------------------
  const hrUser = await ensureUser({
    email: "hr@hrms.local",
    fullName: "Priya HR",
    role: "HR",
    password: "HR123!",
  });
  const hrEmployee = await ensureEmployee({
    userId: hrUser.id,
    employeeCode: "HR-001",
    designation: "HR Manager",
    departmentId: people.id,
    joiningDate: new Date("2023-03-01"),
  });

  // --- Managers ----------------------------------------------------------------
  const mgr1User = await ensureUser({
    email: "manager.eng@hrms.local",
    fullName: "John Smith",
    role: "MANAGER",
    password: "Manager123!",
  });
  const mgr1 = await ensureEmployee({
    userId: mgr1User.id,
    employeeCode: "MGR-ENG-001",
    designation: "Engineering Manager",
    departmentId: engineering.id,
    teamId: backend.id,
    joiningDate: new Date("2022-06-01"),
  });

  const mgr2User = await ensureUser({
    email: "manager.sales@hrms.local",
    fullName: "Priya Rao",
    role: "MANAGER",
    password: "Manager123!",
  });
  const mgr2 = await ensureEmployee({
    userId: mgr2User.id,
    employeeCode: "MGR-SALES-001",
    designation: "Sales Manager",
    departmentId: sales.id,
    joiningDate: new Date("2022-09-01"),
  });

  // Link managers to departments and teams
  await prisma.department.update({
    where: { id: engineering.id },
    data: { managerId: mgr1User.id },
  });
  await prisma.department.update({
    where: { id: sales.id },
    data: { managerId: mgr2User.id },
  });
  await prisma.team.update({
    where: { id: backend.id },
    data: { leadId: mgr1User.id },
  });
  await prisma.team.update({
    where: { id: frontend.id },
    data: { leadId: mgr1User.id },
  });
  console.log("✔ Admin, HR, Managers ready");

  // --- Employees -----------------------------------------------------------------
  const employeeDefs = [
    {
      email: "employee@hrms.local",
      fullName: "Alex Employee",
      code: "EMP-0001",
      designation: "Software Engineer",
      teamId: backend.id,
      managerId: mgr1.id,
    },
    {
      email: "alice.dev@hrms.local",
      fullName: "Alice Chen",
      code: "EMP-ENG-002",
      designation: "Backend Developer",
      teamId: backend.id,
      managerId: mgr1.id,
    },
    {
      email: "bob.frontend@hrms.local",
      fullName: "Bob Martinez",
      code: "EMP-ENG-003",
      designation: "Frontend Developer",
      teamId: frontend.id,
      managerId: mgr1.id,
    },
    {
      email: "carol.sales@hrms.local",
      fullName: "Carol White",
      code: "EMP-SALES-001",
      designation: "Sales Executive",
      teamId: null,
      managerId: mgr2.id,
    },
    {
      email: "dave.sales@hrms.local",
      fullName: "Dave Kim",
      code: "EMP-SALES-002",
      designation: "Sales Executive",
      teamId: null,
      managerId: mgr2.id,
    },
  ];

  const employees = [];
  for (const def of employeeDefs) {
    const user = await ensureUser({
      email: def.email,
      fullName: def.fullName,
      role: "EMPLOYEE",
      password: "Employee123!",
    });
    const employee = await ensureEmployee({
      userId: user.id,
      employeeCode: def.code,
      designation: def.designation,
      departmentId: def.teamId ? engineering.id : sales.id,
      teamId: def.teamId,
      managerId: def.managerId,
      joiningDate: new Date("2024-01-15"),
    });
    employees.push({ ...def, user, employee });
  }
  const [alex, alice, bob, carol, dave] = employees;
  console.log("✔ 5 employees ready");

  // --- Leave balances ----------------------------------------------------------
  const allEmployeeHolders = [
    hrEmployee,
    mgr1,
    mgr2,
    ...employees.map((e) => e.employee),
  ];
  for (const emp of allEmployeeHolders) {
    await ensureLeaveBalance(emp.id, casual.id, casual.defaultAllocation);
    await ensureLeaveBalance(emp.id, sick.id, sick.defaultAllocation);
    await ensureLeaveBalance(emp.id, earned.id, earned.defaultAllocation);
  }
  console.log("✔ Leave balances ensured for all employee profiles");

  // --- Attendance history ------------------------------------------------------
  const attendancePatterns = [
    { clockInHour: 9, clockOutHour: 18, status: "PRESENT", breakMinutes: 30 },
    { clockInHour: 10, clockOutHour: 18, status: "LATE", breakMinutes: 30 },
    { clockInHour: 9, clockOutHour: 13, status: "HALF_DAY", breakMinutes: 0 },
    { clockInHour: 9, clockOutHour: 17, status: "PRESENT", breakMinutes: 45 },
  ];
  let dayOffset = 1;
  let daysSeeded = 0;
  while (daysSeeded < 4) {
    const date = daysAgo(dayOffset);
    dayOffset += 1;
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const emp of allEmployeeHolders) {
      const pattern =
        attendancePatterns[daysSeeded % attendancePatterns.length];
      await ensureAttendance(emp.id, date, pattern);
    }
    daysSeeded += 1;
  }
  await ensureAttendance(bob.employee.id, daysAgo(5), { status: "ABSENT" });
  console.log("✔ Attendance history seeded");

  // --- Leave requests ----------------------------------------------------------
  const existingRequestCount = await prisma.leaveRequest.count({
    where: { employeeId: alex.employee.id },
  });
  if (existingRequestCount === 0) {
    await prisma.leaveRequest.create({
      data: {
        employeeId: alex.employee.id,
        leaveTypeId: casual.id,
        startDate: new Date("2026-08-10"),
        endDate: new Date("2026-08-11"),
        days: 2,
        reason: "Family event",
        status: "PENDING",
      },
    });

    await prisma.leaveRequest.create({
      data: {
        employeeId: alex.employee.id,
        leaveTypeId: sick.id,
        startDate: new Date("2026-08-15"),
        endDate: new Date("2026-08-15"),
        days: 1,
        reason: "Doctor appointment",
        status: "APPROVED_MANAGER",
        managerComment: "Approved, feel better",
      },
    });

    await prisma.leaveRequest.create({
      data: {
        employeeId: alex.employee.id,
        leaveTypeId: earned.id,
        startDate: new Date("2026-05-01"),
        endDate: new Date("2026-05-03"),
        days: 3,
        reason: "Vacation",
        status: "APPROVED_HR",
        managerComment: "Enjoy!",
        hrComment: "Approved",
        decidedAt: new Date("2026-04-20"),
      },
    });
    await prisma.leaveBalance.update({
      where: {
        employeeId_leaveTypeId: {
          employeeId: alex.employee.id,
          leaveTypeId: earned.id,
        },
      },
      data: { remainingDays: { decrement: 3 } },
    });

    await prisma.leaveRequest.create({
      data: {
        employeeId: alex.employee.id,
        leaveTypeId: casual.id,
        startDate: new Date("2026-03-01"),
        endDate: new Date("2026-03-05"),
        days: 5,
        reason: "Extended trip",
        status: "REJECTED",
        managerComment:
          "Too close to the release date, please pick different dates",
        decidedAt: new Date("2026-02-25"),
      },
    });

    await notify(
      alex.user.id,
      "LEAVE_APPROVED",
      "Leave approved",
      "Your Earned Leave request was fully approved.",
    );
    await notify(
      alex.user.id,
      "LEAVE_REJECTED",
      "Leave rejected",
      "Your Casual Leave request was rejected by your manager.",
    );
    console.log("✔ Sample leave requests seeded for Alex");
  }

  // --- Goals -------------------------------------------------------------------
  const alexGoalCount = await prisma.goal.count({
    where: { employeeId: alex.employee.id },
  });
  if (alexGoalCount === 0) {
    await prisma.goal.create({
      data: {
        employeeId: alex.employee.id,
        createdById: mgr1.id,
        title: "Ship the new auth module",
        description: "Design and implement JWT-based auth with refresh tokens",
        targetDate: new Date("2026-09-30"),
        priority: "HIGH",
        status: "IN_PROGRESS",
        progress: 40,
        updates: {
          create: [
            { progress: 20, comment: "API design done" },
            { progress: 40, comment: "Login + refresh implemented" },
          ],
        },
      },
    });

    await prisma.goal.create({
      data: {
        employeeId: alex.employee.id,
        createdById: mgr1.id,
        title: "Complete onboarding checklist",
        targetDate: new Date("2026-02-01"),
        priority: "LOW",
        status: "ACHIEVED",
        progress: 100,
        validatedAt: new Date("2026-02-02"),
        updates: {
          create: [{ progress: 100, comment: "All onboarding tasks done" }],
        },
      },
    });

    await prisma.goal.create({
      data: {
        employeeId: alex.employee.id,
        createdById: mgr1.id,
        title: "Write API documentation",
        targetDate: new Date("2026-07-15"),
        priority: "MEDIUM",
        status: "ACHIEVED",
        progress: 100,
        updates: {
          create: [{ progress: 100, comment: "Docs published to the wiki" }],
        },
      },
    });

    await notify(
      alex.user.id,
      "GOAL_ASSIGNED",
      "New goal assigned",
      'Your manager assigned you "Ship the new auth module".',
    );
    console.log("✔ Sample goals seeded for Alex");
  }

  // --- Review Cycle ------------------------------------------------------------
  let cycle = await prisma.reviewCycle.findFirst({
    where: { name: "H1 2026 Performance Review" },
  });
  if (!cycle) {
    cycle = await prisma.reviewCycle.create({
      data: {
        name: "H1 2026 Performance Review",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-07-31"),
        active: true,
      },
    });

    const template = await prisma.reviewTemplate.create({
      data: { cycleId: cycle.id, name: "Standard 360 Template" },
    });

    const questionDefs = [
      {
        category: "Technical Skills",
        text: "Demonstrates strong technical/domain expertise",
        weight: 2,
      },
      {
        category: "Communication",
        text: "Communicates clearly with the team and stakeholders",
        weight: 1,
      },
      {
        category: "Collaboration",
        text: "Works well with others and supports teammates",
        weight: 1,
      },
      {
        category: "Ownership",
        text: "Takes ownership of tasks and follows through",
        weight: 2,
      },
    ];
    const questions = [];
    for (const q of questionDefs) {
      questions.push(
        await prisma.reviewQuestion.create({
          data: { templateId: template.id, ...q },
        }),
      );
    }

    await prisma.review.create({
      data: {
        cycleId: cycle.id,
        templateId: template.id,
        employeeId: alex.employee.id,
        reviewerId: alex.employee.id,
        reviewType: "SELF",
        status: "PENDING",
      },
    });

    await prisma.review.create({
      data: {
        cycleId: cycle.id,
        templateId: template.id,
        employeeId: alex.employee.id,
        reviewerId: mgr1.id,
        reviewType: "MANAGER",
        status: "SUBMITTED",
        submittedAt: new Date(),
        comments: "Strong quarter, especially on the auth module.",
        answers: {
          create: questions.map((q, i) => ({
            questionId: q.id,
            rating: [5, 4, 4, 5][i],
            comment: null,
          })),
        },
      },
    });

    await notify(
      alex.user.id,
      "REVIEW_DUE",
      "Self-appraisal due",
      "Please complete your self-appraisal for H1 2026.",
    );
    console.log("✔ Performance review cycle seeded");
  }

  console.log("\n========================================");
  console.log("🎉 Full Dummy Data Seed Complete!");
  console.log("========================================");
  console.log(" Login accounts available:");
  console.log("   Admin    -> admin@hrms.local        / Admin123!");
  console.log("   HR       -> hr@hrms.local             / HR123!");
  console.log("   Manager  -> manager.eng@hrms.local    / Manager123!");
  console.log("   Manager  -> manager.sales@hrms.local  / Manager123!");
  console.log("   Employee -> employee@hrms.local       / Employee123! (Alex)");
  console.log("========================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
