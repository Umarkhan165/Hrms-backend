// // Comprehensive HRMS seed data.
// //
// // Safe to run repeatedly (`npm run seed`) - every write is either an
// // upsert keyed on a real unique field, or guarded by a "does this already
// // exist" check, so re-running never duplicates rows and never resets
// // something you changed by hand while testing.
// //
// // Creates:
// //   - 3 departments, 2 teams
// //   - 1 Admin, 1 HR, 2 Managers, 5 Employees (9 users, 8 with Employee profiles)
// //   - Leave balances for every employee, for every leave type (fixes the
// //     earlier bug where balances were only ever seeded inside a
// //     "brand new user" branch, so they silently stayed at 0 on any rerun)
// //   - A few days of attendance history per employee, in varied statuses
// //   - Leave requests sitting at every stage of the workflow
// //   - Goals in every status, including one sitting at 100% unvalidated
// //   - A full review cycle with a weighted template and reviews in every state
// //   - A handful of notifications so the notification screens have content
// require('dotenv/config');
// const bcrypt = require('bcryptjs');
// const { PrismaClient } = require('@prisma/client');

// const prisma = new PrismaClient();

// // ---------------------------------------------------------------------------
// // Small helpers
// // ---------------------------------------------------------------------------

// const hash = (plain) => bcrypt.hash(plain, 10);

// const daysAgo = (n) => {
//   const d = new Date();
//   d.setUTCDate(d.getUTCDate() - n);
//   d.setUTCHours(0, 0, 0, 0);
//   return d;
// };

// const atHour = (date, hour, minute = 0) => {
//   const d = new Date(date);
//   d.setUTCHours(hour, minute, 0, 0);
//   return d;
// };

// async function ensureDepartment(name) {
//   const existing = await prisma.department.findFirst({ where: { name } });
//   if (existing) return existing;
//   return prisma.department.create({ data: { name } });
// }

// async function ensureTeam(name, departmentId) {
//   const existing = await prisma.team.findFirst({ where: { name, departmentId } });
//   if (existing) return existing;
//   return prisma.team.create({ data: { name, departmentId } });
// }

// async function ensureUser({ email, fullName, role, password }) {
//   const existing = await prisma.user.findUnique({ where: { email } });
//   if (existing) return existing;
//   return prisma.user.create({
//     data: { email, fullName, role, isVerified: true, isActive: true, passwordHash: await hash(password) },
//   });
// }

// async function ensureEmployee({ userId, employeeCode, designation, departmentId, teamId, managerId, joiningDate }) {
//   const existing = await prisma.employee.findUnique({ where: { employeeCode } });
//   if (existing) return existing;
//   return prisma.employee.create({
//     data: {
//       userId,
//       employeeCode,
//       designation,
//       departmentId: departmentId || null,
//       teamId: teamId || null,
//       managerId: managerId || null,
//       joiningDate,
//       status: 'ACTIVE',
//       employmentType: 'FULL_TIME',
//     },
//   });
// }

// // The bug fix: this always upserts, regardless of whether the employee/user
// // already existed, so balances never silently stay at zero on a rerun.
// async function ensureLeaveBalance(employeeId, leaveTypeId, remainingDays) {
//   return prisma.leaveBalance.upsert({
//     where: { employeeId_leaveTypeId: { employeeId, leaveTypeId } },
//     update: {},
//     create: { employeeId, leaveTypeId, remainingDays },
//   });
// }

// async function ensureAttendance(employeeId, attendanceDate, { clockInHour, clockOutHour, status, breakMinutes = 0 }) {
//   const existing = await prisma.attendance.findUnique({
//     where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
//   });
//   if (existing) return existing;

//   if (status === 'ABSENT') {
//     return prisma.attendance.create({ data: { employeeId, attendanceDate, status: 'ABSENT' } });
//   }

//   const clockIn = atHour(attendanceDate, clockInHour);
//   const clockOut = clockOutHour != null ? atHour(attendanceDate, clockOutHour) : null;
//   let totalHours = null;
//   const attendance = await prisma.attendance.create({
//     data: { employeeId, attendanceDate, clockIn, clockOut, status },
//   });

//   if (breakMinutes > 0) {
//     const breakStart = atHour(attendanceDate, clockInHour, 30);
//     const breakEnd = new Date(breakStart.getTime() + breakMinutes * 60000);
//     await prisma.attendanceBreak.create({
//       data: { attendanceId: attendance.id, startTime: breakStart, endTime: breakEnd, durationMinutes: breakMinutes },
//     });
//   }

//   if (clockOut) {
//     const grossMinutes = (clockOut - clockIn) / 60000;
//     totalHours = ((grossMinutes - breakMinutes) / 60).toFixed(2);
//     await prisma.attendance.update({ where: { id: attendance.id }, data: { totalHours } });
//   }

//   return attendance;
// }

// async function notify(userId, type, title, message) {
//   return prisma.notification.create({ data: { userId, type, title, message } });
// }

// // ---------------------------------------------------------------------------
// // Main
// // ---------------------------------------------------------------------------

// async function main() {
//   // --- Leave types -----------------------------------------------------------
//   const leaveTypeDefs = [
//     { name: 'Casual Leave', defaultAllocation: 10 },
//     { name: 'Sick Leave', defaultAllocation: 15 },
//     { name: 'Earned Leave', defaultAllocation: 20 },
//   ];
//   const leaveTypes = [];
//   for (const lt of leaveTypeDefs) {
//     leaveTypes.push(await prisma.leaveType.upsert({ where: { name: lt.name }, update: {}, create: lt }));
//   }
//   const [casual, sick, earned] = leaveTypes;
//   console.log('Leave types ready');

//   // --- Org structure -----------------------------------------------------------
//   const engineering = await ensureDepartment('Engineering');
//   const sales = await ensureDepartment('Sales');
//   const people = await ensureDepartment('People');
//   const backend = await ensureTeam('Backend', engineering.id);
//   const frontend = await ensureTeam('Frontend', engineering.id);
//   console.log('Departments + teams ready');

//   // --- Admin (no Employee profile - pure system account) ---------------------
//   const admin = await ensureUser({
//     email: 'admin@hrms.local',
//     fullName: 'System Administrator',
//     role: 'ADMIN',
//     password: 'Admin123!',
//   });

//   // --- HR (has an Employee profile - HR staff use self-service too) ----------
//   const hrUser = await ensureUser({ email: 'hr@hrms.local', fullName: 'Priya HR', role: 'HR', password: 'HR123!' });
//   const hrEmployee = await ensureEmployee({
//     userId: hrUser.id,
//     employeeCode: 'HR-001',
//     designation: 'HR Manager',
//     departmentId: people.id,
//     joiningDate: new Date('2023-03-01'),
//   });

//   // --- Managers ----------------------------------------------------------------
//   const mgr1User = await ensureUser({
//     email: 'manager.eng@hrms.local',
//     fullName: 'John Smith',
//     role: 'MANAGER',
//     password: 'Manager123!',
//   });
//   const mgr1 = await ensureEmployee({
//     userId: mgr1User.id,
//     employeeCode: 'MGR-ENG-001',
//     designation: 'Engineering Manager',
//     departmentId: engineering.id,
//     teamId: backend.id,
//     joiningDate: new Date('2022-06-01'),
//   });

//   const mgr2User = await ensureUser({
//     email: 'manager.sales@hrms.local',
//     fullName: 'Priya Rao',
//     role: 'MANAGER',
//     password: 'Manager123!',
//   });
//   const mgr2 = await ensureEmployee({
//     userId: mgr2User.id,
//     employeeCode: 'MGR-SALES-001',
//     designation: 'Sales Manager',
//     departmentId: sales.id,
//     joiningDate: new Date('2022-09-01'),
//   });

//   // Departments/teams reference their manager/lead now that those users exist
//   await prisma.department.update({ where: { id: engineering.id }, data: { managerId: mgr1User.id } });
//   await prisma.department.update({ where: { id: sales.id }, data: { managerId: mgr2User.id } });
//   await prisma.team.update({ where: { id: backend.id }, data: { leadId: mgr1User.id } });
//   await prisma.team.update({ where: { id: frontend.id }, data: { leadId: mgr1User.id } });
//   console.log('Admin, HR, Managers ready');

//   // --- Employees -----------------------------------------------------------------
//   const employeeDefs = [
//     { email: 'employee@hrms.local', fullName: 'Alex Employee', code: 'EMP-0001', designation: 'Software Engineer', teamId: backend.id, managerId: mgr1.id },
//     { email: 'alice.dev@hrms.local', fullName: 'Alice Chen', code: 'EMP-ENG-002', designation: 'Backend Developer', teamId: backend.id, managerId: mgr1.id },
//     { email: 'bob.frontend@hrms.local', fullName: 'Bob Martinez', code: 'EMP-ENG-003', designation: 'Frontend Developer', teamId: frontend.id, managerId: mgr1.id },
//     { email: 'carol.sales@hrms.local', fullName: 'Carol White', code: 'EMP-SALES-001', designation: 'Sales Executive', teamId: null, managerId: mgr2.id },
//     { email: 'dave.sales@hrms.local', fullName: 'Dave Kim', code: 'EMP-SALES-002', designation: 'Sales Executive', teamId: null, managerId: mgr2.id },
//   ];

//   const employees = [];
//   for (const def of employeeDefs) {
//     const user = await ensureUser({ email: def.email, fullName: def.fullName, role: 'EMPLOYEE', password: 'Employee123!' });
//     const employee = await ensureEmployee({
//       userId: user.id,
//       employeeCode: def.code,
//       designation: def.designation,
//       departmentId: def.teamId ? engineering.id : sales.id,
//       teamId: def.teamId,
//       managerId: def.managerId,
//       joiningDate: new Date('2024-01-15'),
//     });
//     employees.push({ ...def, user, employee });
//   }
//   const [alex, alice, bob, carol, dave] = employees;
//   console.log('5 employees ready, reporting to their managers');

//   // --- Leave balances for EVERY employee-holding person (this is the fix) ---
//   const allEmployeeHolders = [hrEmployee, mgr1, mgr2, ...employees.map((e) => e.employee)];
//   for (const emp of allEmployeeHolders) {
//     await ensureLeaveBalance(emp.id, casual.id, casual.defaultAllocation);
//     await ensureLeaveBalance(emp.id, sick.id, sick.defaultAllocation);
//     await ensureLeaveBalance(emp.id, earned.id, earned.defaultAllocation);
//   }
//   console.log('Leave balances ensured for all 8 employee profiles');

//   // --- Attendance history (last 4 weekdays, skipping today so you can still
//   // test live clock-in yourself) ----------------------------------------------
//   const attendancePatterns = [
//     { clockInHour: 9, clockOutHour: 18, status: 'PRESENT', breakMinutes: 30 },
//     { clockInHour: 10, clockOutHour: 18, status: 'LATE', breakMinutes: 30 },
//     { clockInHour: 9, clockOutHour: 13, status: 'HALF_DAY', breakMinutes: 0 },
//     { clockInHour: 9, clockOutHour: 17, status: 'PRESENT', breakMinutes: 45 },
//   ];
//   let dayOffset = 1;
//   let daysSeeded = 0;
//   while (daysSeeded < 4) {
//     const date = daysAgo(dayOffset);
//     dayOffset += 1;
//     const weekday = date.getUTCDay();
//     if (weekday === 0 || weekday === 6) continue; // skip weekends
//     for (const emp of allEmployeeHolders) {
//       const pattern = attendancePatterns[daysSeeded % attendancePatterns.length];
//       await ensureAttendance(emp.id, date, pattern);
//     }
//     daysSeeded += 1;
//   }
//   // One employee has an absence on record too
//   await ensureAttendance(bob.employee.id, daysAgo(5), { status: 'ABSENT' });
//   console.log('Attendance history seeded (4 weekdays per employee)');

//   // --- Leave requests at every workflow stage --------------------------------
//   const existingRequestCount = await prisma.leaveRequest.count({ where: { employeeId: alex.employee.id } });
//   if (existingRequestCount === 0) {
//     // 1) Still PENDING - waiting on manager.eng
//     await prisma.leaveRequest.create({
//       data: {
//         employeeId: alex.employee.id,
//         leaveTypeId: casual.id,
//         startDate: new Date('2026-08-10'),
//         endDate: new Date('2026-08-11'),
//         days: 2,
//         reason: 'Family event',
//         status: 'PENDING',
//       },
//     });

//     // 2) Manager already approved - waiting on HR
//     await prisma.leaveRequest.create({
//       data: {
//         employeeId: alex.employee.id,
//         leaveTypeId: sick.id,
//         startDate: new Date('2026-08-15'),
//         endDate: new Date('2026-08-15'),
//         days: 1,
//         reason: 'Doctor appointment',
//         status: 'APPROVED_MANAGER',
//         managerComment: 'Approved, feel better',
//       },
//     });

//     // 3) Fully approved by HR - balance already reflects the deduction
//     await prisma.leaveRequest.create({
//       data: {
//         employeeId: alex.employee.id,
//         leaveTypeId: earned.id,
//         startDate: new Date('2026-05-01'),
//         endDate: new Date('2026-05-03'),
//         days: 3,
//         reason: 'Vacation',
//         status: 'APPROVED_HR',
//         managerComment: 'Enjoy!',
//         hrComment: 'Approved',
//         decidedAt: new Date('2026-04-20'),
//       },
//     });
//     await prisma.leaveBalance.update({
//       where: { employeeId_leaveTypeId: { employeeId: alex.employee.id, leaveTypeId: earned.id } },
//       data: { remainingDays: { decrement: 3 } },
//     });

//     // 4) Rejected by manager
//     await prisma.leaveRequest.create({
//       data: {
//         employeeId: alex.employee.id,
//         leaveTypeId: casual.id,
//         startDate: new Date('2026-03-01'),
//         endDate: new Date('2026-03-05'),
//         days: 5,
//         reason: 'Extended trip',
//         status: 'REJECTED',
//         managerComment: 'Too close to the release date, please pick different dates',
//         decidedAt: new Date('2026-02-25'),
//       },
//     });

//     await notify(alex.user.id, 'LEAVE_APPROVED', 'Leave approved', 'Your Earned Leave request was fully approved.');
//     await notify(alex.user.id, 'LEAVE_REJECTED', 'Leave rejected', 'Your Casual Leave request was rejected by your manager.');
//     console.log('Sample leave requests seeded for Alex (all 4 workflow states)');
//   }

//   const carolRequestCount = await prisma.leaveRequest.count({ where: { employeeId: carol.employee.id } });
//   if (carolRequestCount === 0) {
//     await prisma.leaveRequest.create({
//       data: {
//         employeeId: carol.employee.id,
//         leaveTypeId: casual.id,
//         startDate: new Date('2026-08-05'),
//         endDate: new Date('2026-08-05'),
//         days: 1,
//         reason: 'Personal errand',
//         status: 'PENDING',
//       },
//     });
//     console.log('Sample leave request seeded for Carol (pending, for manager.sales to review)');
//   }

//   // --- Goals in every status ---------------------------------------------------
//   const alexGoalCount = await prisma.goal.count({ where: { employeeId: alex.employee.id } });
//   if (alexGoalCount === 0) {
//     await prisma.goal.create({
//       data: {
//         employeeId: alex.employee.id,
//         createdById: mgr1.id,
//         title: 'Ship the new auth module',
//         description: 'Design and implement JWT-based auth with refresh tokens',
//         targetDate: new Date('2026-09-30'),
//         priority: 'HIGH',
//         status: 'IN_PROGRESS',
//         progress: 40,
//         updates: { create: [{ progress: 20, comment: 'API design done' }, { progress: 40, comment: 'Login + refresh implemented' }] },
//       },
//     });

//     await prisma.goal.create({
//       data: {
//         employeeId: alex.employee.id,
//         createdById: mgr1.id,
//         title: 'Complete onboarding checklist',
//         targetDate: new Date('2026-02-01'),
//         priority: 'LOW',
//         status: 'ACHIEVED',
//         progress: 100,
//         validatedAt: new Date('2026-02-02'),
//         updates: { create: [{ progress: 100, comment: 'All onboarding tasks done' }] },
//       },
//     });

//     // Sitting at 100% but NOT yet validated - exactly what the manager's
//     // "pending validation" view should surface
//     await prisma.goal.create({
//       data: {
//         employeeId: alex.employee.id,
//         createdById: mgr1.id,
//         title: 'Write API documentation',
//         targetDate: new Date('2026-07-15'),
//         priority: 'MEDIUM',
//         status: 'ACHIEVED',
//         progress: 100,
//         updates: { create: [{ progress: 100, comment: 'Docs published to the wiki' }] },
//       },
//     });

//     await notify(alex.user.id, 'GOAL_ASSIGNED', 'New goal assigned', 'Your manager assigned you "Ship the new auth module".');
//     console.log('Sample goals seeded for Alex (in-progress, achieved+validated, achieved+unvalidated)');
//   }

//   const aliceGoalCount = await prisma.goal.count({ where: { employeeId: alice.employee.id } });
//   if (aliceGoalCount === 0) {
//     await prisma.goal.create({
//       data: {
//         employeeId: alice.employee.id,
//         createdById: mgr1.id,
//         title: 'Reduce API p95 latency by 20%',
//         targetDate: new Date('2026-10-01'),
//         priority: 'HIGH',
//         status: 'NOT_STARTED',
//         progress: 0,
//       },
//     });
//     console.log('Sample goal seeded for Alice (not started)');
//   }

//   // --- A full review cycle -----------------------------------------------------
//   let cycle = await prisma.reviewCycle.findFirst({ where: { name: 'H1 2026 Performance Review' } });
//   if (!cycle) {
//     cycle = await prisma.reviewCycle.create({
//       data: { name: 'H1 2026 Performance Review', startDate: new Date('2026-06-01'), endDate: new Date('2026-07-31'), active: true },
//     });

//     const template = await prisma.reviewTemplate.create({ data: { cycleId: cycle.id, name: 'Standard 360 Template' } });

//     const questionDefs = [
//       { category: 'Technical Skills', text: 'Demonstrates strong technical/domain expertise', weight: 2 },
//       { category: 'Communication', text: 'Communicates clearly with the team and stakeholders', weight: 1 },
//       { category: 'Collaboration', text: 'Works well with others and supports teammates', weight: 1 },
//       { category: 'Ownership', text: 'Takes ownership of tasks and follows through', weight: 2 },
//     ];
//     const questions = [];
//     for (const q of questionDefs) {
//       questions.push(await prisma.reviewQuestion.create({ data: { templateId: template.id, ...q } }));
//     }

//     // Self-appraisal - PENDING (Alex hasn't filled it in yet)
//     await prisma.review.create({
//       data: {
//         cycleId: cycle.id,
//         templateId: template.id,
//         employeeId: alex.employee.id,
//         reviewerId: alex.employee.id,
//         reviewType: 'SELF',
//         status: 'PENDING',
//       },
//     });

//     // Manager assessment of Alex - SUBMITTED (has answers, not published yet)
//     await prisma.review.create({
//       data: {
//         cycleId: cycle.id,
//         templateId: template.id,
//         employeeId: alex.employee.id,
//         reviewerId: mgr1.id,
//         reviewType: 'MANAGER',
//         status: 'SUBMITTED',
//         submittedAt: new Date(),
//         comments: 'Strong quarter, especially on the auth module.',
//         answers: {
//           create: questions.map((q, i) => ({ questionId: q.id, rating: [5, 4, 4, 5][i], comment: null })),
//         },
//       },
//     });

//     // Peer evaluation - Alice reviewing Alex, PENDING so it can be submitted
//     // during testing
//     await prisma.review.create({
//       data: {
//         cycleId: cycle.id,
//         templateId: template.id,
//         employeeId: alex.employee.id,
//         reviewerId: alice.employee.id,
//         reviewType: 'PEER',
//         status: 'PENDING',
//       },
//     });

//     // A fully published + acknowledged review, for Bob - so the "acknowledge"
//     // and score-viewing endpoints have something to hit immediately
//     const bobRatings = [4, 4, 3, 4];
//     const bobScoreAnswers = questions.map((q, i) => ({ questionId: q.id, rating: bobRatings[i] }));
//     const weightedSum = bobScoreAnswers.reduce((s, a, i) => s + a.rating * Number(questions[i].weight), 0);
//     const weightTotal = questions.reduce((s, q) => s + Number(q.weight), 0);
//     await prisma.review.create({
//       data: {
//         cycleId: cycle.id,
//         templateId: template.id,
//         employeeId: bob.employee.id,
//         reviewerId: mgr1.id,
//         reviewType: 'MANAGER',
//         status: 'ACKNOWLEDGED',
//         submittedAt: new Date('2026-07-10'),
//         acknowledgedAt: new Date('2026-07-12'),
//         overallScore: (weightedSum / weightTotal).toFixed(2),
//         answers: { create: bobScoreAnswers },
//       },
//     });

//     await notify(alex.user.id, 'REVIEW_DUE', 'Self-appraisal due', 'Please complete your self-appraisal for H1 2026.');
//     console.log('Review cycle "H1 2026 Performance Review" seeded with reviews in every state');
//   }

//   console.log('\nSeed complete. Login accounts:');
//   console.log('  Admin    -> admin@hrms.local          / Admin123!');
//   console.log('  HR       -> hr@hrms.local              / HR123!');
//   console.log('  Manager  -> manager.eng@hrms.local     / Manager123!  (Engineering, leads Alex/Alice/Bob)');
//   console.log('  Manager  -> manager.sales@hrms.local   / Manager123!  (Sales, leads Carol/Dave)');
//   console.log('  Employee -> employee@hrms.local        / Employee123! (Alex - has the richest sample data)');
//   console.log('  Employee -> alice.dev@hrms.local       / Employee123!');
//   console.log('  Employee -> bob.frontend@hrms.local    / Employee123!');
//   console.log('  Employee -> carol.sales@hrms.local     / Employee123!');
//   console.log('  Employee -> dave.sales@hrms.local      / Employee123!');
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
// prisma/seed-rbac.js
//
// Standalone seed script (kept separate from any existing prisma/seed.js
// you may already have, so it doesn't clash with it — additive, same as
// the rest of this feature).
//
// Run with:
//   node prisma/seed-rbac.js

// const { PrismaClient } = require("@prisma/client");
// const prisma = new PrismaClient();

// const ROLES = [
//   {
//     name: "EMPLOYEE",
//     isSystem: true,
//     description: "Base access — own profile, own requests",
//   },
//   {
//     name: "MANAGER",
//     isSystem: true,
//     description: "Team-level access on top of employee access",
//   },
//   { name: "HR", isSystem: true, description: "Org-wide HR operations" },
//   { name: "ADMIN", isSystem: true, description: "Full system access" },
// ];

// // key = "module:action", module groups rows in the matrix UI
// const PERMISSIONS = [
//   // Employees
//   {
//     key: "employees:view_self",
//     module: "Employees",
//     description: "View own profile",
//   },
//   {
//     key: "employees:view_all",
//     module: "Employees",
//     description: "View any employee profile",
//   },
//   {
//     key: "employees:onboard",
//     module: "Employees",
//     description: "Create new employee accounts",
//   },
//   {
//     key: "employees:edit",
//     module: "Employees",
//     description: "Edit employee org/pay fields",
//   },
//   {
//     key: "employees:delete",
//     module: "Employees",
//     description: "Soft-delete / offboard an employee",
//   },

//   // Departments
//   {
//     key: "departments:view",
//     module: "Departments",
//     description: "View department list",
//   },
//   {
//     key: "departments:manage",
//     module: "Departments",
//     description: "Create, edit, delete departments",
//   },

//   // Teams
//   { key: "teams:view", module: "Teams", description: "View team list" },
//   {
//     key: "teams:manage",
//     module: "Teams",
//     description: "Create, edit, delete teams",
//   },
//   {
//     key: "teams:view_attendance",
//     module: "Teams",
//     description: "View a team's attendance",
//   },

//   // Reviews
//   {
//     key: "reviews:view_self",
//     module: "Reviews",
//     description: "View own reviews",
//   },
//   {
//     key: "reviews:manage_cycles",
//     module: "Reviews",
//     description: "Create review cycles and templates",
//   },
//   {
//     key: "reviews:publish",
//     module: "Reviews",
//     description: "Publish a submitted review",
//   },

//   // Users
//   { key: "users:view", module: "Users", description: "View user accounts" },
//   {
//     key: "users:set_status",
//     module: "Users",
//     description: "Activate / deactivate a user",
//   },
//   {
//     key: "users:set_role",
//     module: "Users",
//     description: "Change a user's role",
//   },

//   // RBAC
//   {
//     key: "rbac:manage",
//     module: "RBAC",
//     description: "Manage roles and permission grants",
//   },

//   // Audit
//   { key: "audit:view", module: "Audit", description: "View audit logs" },
// ];

// // Which permission keys each system role starts with — edit freely after seeding,
// // this only sets the initial state.
// const DEFAULT_GRANTS = {
//   EMPLOYEE: ["employees:view_self", "reviews:view_self"],
//   MANAGER: [
//     "employees:view_self",
//     "employees:view_all",
//     "teams:view",
//     "teams:view_attendance",
//     "reviews:view_self",
//   ],
//   HR: [
//     "employees:view_self",
//     "employees:view_all",
//     "employees:onboard",
//     "employees:edit",
//     "employees:delete",
//     "departments:view",
//     "departments:manage",
//     "teams:view",
//     "teams:manage",
//     "teams:view_attendance",
//     "reviews:view_self",
//     "reviews:manage_cycles",
//     "reviews:publish",
//     "users:view",
//     "audit:view",
//   ],
//   ADMIN: PERMISSIONS.map((p) => p.key), // everything
// };

// async function main() {
//   console.log("Seeding roles...");
//   const roleMap = {};
//   for (const r of ROLES) {
//     const role = await prisma.role.upsert({
//       where: { name: r.name },
//       update: {},
//       create: r,
//     });
//     roleMap[r.name] = role;
//   }

//   console.log("Seeding permissions...");
//   const permMap = {};
//   for (const p of PERMISSIONS) {
//     const perm = await prisma.permission.upsert({
//       where: { key: p.key },
//       update: { module: p.module, description: p.description },
//       create: p,
//     });
//     permMap[p.key] = perm;
//   }

//   console.log("Applying default grants...");
//   for (const [roleName, keys] of Object.entries(DEFAULT_GRANTS)) {
//     const role = roleMap[roleName];
//     for (const key of keys) {
//       const perm = permMap[key];
//       if (!perm) continue;
//       await prisma.rolePermission.upsert({
//         where: {
//           roleId_permissionId: { roleId: role.id, permissionId: perm.id },
//         },
//         update: {},
//         create: { roleId: role.id, permissionId: perm.id },
//       });
//     }
//   }

//   console.log("Done.");
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
