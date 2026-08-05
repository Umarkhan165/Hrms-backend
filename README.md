# HRMS Backend

Simple Node.js + Express + Prisma + PostgreSQL backend implementing the
features used by the React screens (attendance, multi-level leave approval,
goals, 360° performance reviews, notifications, RBAC, audit log) as described
in the HRMS blueprint.

Deliberately kept flat: routes -> controllers -> Prisma. No service/repository
layering, no TypeScript build step — plain JS so you can read every file
top to bottom.

## 1. Setup

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed      # creates default leave types + a super admin login
npm run dev        # http://localhost:5000
```

Default admin login after seeding: `admin@hrms.local` / `ChangeMe123!`
(change this password immediately in a real environment).

## 2. About the .env

Two `.env` files were provided in the request — one for a Prisma/Postgres
project (`PORT=5000`, `DATABASE_URL=postgresql://...`) and one from a
different Mongo/Cloudinary project. Since this backend uses Postgres+Prisma
only, the `.env` here keeps:
- `PORT` and `DATABASE_URL` from the Postgres block
- the JWT secrets/expiries from the second block (I fixed two typos:
  `ACCESS_TOKEN_SECREt` → `ACCESS_TOKEN_SECRET`, `REFRESGH_TOKEN_SECRET` →
  `REFRESH_TOKEN_SECRET`, and `10D` → `10d` so the expiry parser understands it)
- Mongo and Cloudinary variables were dropped — nothing in this backend uses
  Mongo or file storage yet. SMTP fields are blank placeholders for
  Mailtrap/Brevo; without them the server just logs onboarding/notification
  emails to the console instead of sending them, so local dev works with
  zero email setup.

## 3. Auth flow

- HR calls `POST /api/v1/employees/onboard` → creates `User` (unverified) +
  `Employee` (status `PENDING`) + emails an activation link with a token.
- Candidate calls `POST /api/v1/auth/activate` with that token + a new
  password → account becomes verified/active.
- `POST /api/v1/auth/login` → returns an access token (short-lived JWT) and a
  refresh token (stored in `Session`, also set as an httpOnly cookie).
- `POST /api/v1/auth/refresh` → exchanges a valid refresh token for a new
  access token.
- All other routes require `Authorization: Bearer <accessToken>`.

Roles: `EMPLOYEE`, `MANAGER`, `HR`, `ADMIN` (enum on `User`, checked via the
`authorize(...)` middleware — this is the RBAC layer; a full separate
ROLES/PERMISSIONS table was left out on purpose since 4 fixed roles don't
need one, but it's a straightforward addition if you need dynamic
permissions later).

## 4. API map

| Module | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/activate`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET /auth/sessions`, `DELETE /sessions/:id` |
| Users (Admin) | `GET /users`, `PATCH /users/:id/status`, `PATCH /users/:id/role` |
| Employees | `POST /employees/onboard`, `GET /employees`, `GET/PUT /employees/:id`, `DELETE /employees/:id`, `POST /employees/:id/documents` |
| Departments | `GET/POST /departments`, `GET/PUT/DELETE /departments/:id` |
| Teams | `GET/POST /teams`, `GET/PUT/DELETE /teams/:id`, `GET /teams/:id/attendance` |
| Attendance | `POST /attendance/clock-in`, `/clock-out`, `/breaks/start`, `/breaks/end`, `GET /attendance` |
| Leave | `GET/POST /leave-types`, `GET /leave-balances`, `POST/GET /leave-requests`, `PUT /leave-requests/:id/manager-review`, `PUT /leave-requests/:id/hr-approve` |
| Goals | `POST/GET /goals`, `GET /goals/:id`, `PATCH /goals/:id/progress`, `PATCH /goals/:id/validate` |
| Reviews | `POST/GET /review-cycles`, `POST /review-templates`, `POST /review-templates/:id/questions`, `POST/GET /reviews`, `POST /reviews/:id/answers`, `GET /reviews/:id/score`, `PATCH /reviews/:id/publish`, `PATCH /reviews/:id/acknowledge` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read` |
| Audit | `GET /audit-logs` (HR/Admin) |

Every list endpoint (`GET`) supports `page`, `limit`, `sortBy`, `sortOrder`,
plus module-specific filters (e.g. `search`, `status`, `departmentId`) —
matching the "every list response needs pagination/filter/sort" requirement
from the blueprint.

## 5. Business rules implemented

- **Onboarding**: token-based activation, bcrypt password hashing, status
  flips PENDING → ACTIVE.
- **Attendance**: one record per employee per day; clock-in after 09:00 is
  marked `LATE`; breaks tracked separately and subtracted from `totalHours`
  on clock-out; record effectively locks once `clockOut` is set (no update
  route offered after that).
- **Leave**: quota checked against `LeaveBalance` before a request is
  created; manager approval (first gate) → HR approval (second gate, inside
  a DB transaction that decrements the balance and writes the audit log
  atomically); rejection at either gate stops the flow and notifies the
  employee.
- **Goals**: managers create goals for direct reports; employees log
  progress with a mandatory comment; hitting 100% notifies the creating
  manager; manager validates once at 100%.
- **Reviews**: HR defines a cycle + template + weighted questions; Self /
  Peer / Manager review records are created against that template;
  `score = Σ(rating × weight) / Σweight`; publishing locks the score in and
  prompts the employee to acknowledge.
- **Notifications**: written for leave state changes, goal assignment/100%
  validation trigger, and review publish.
- **Audit log**: written for onboarding, employee/department/team edits,
  leave manager/HR decisions, and admin user status/role changes, storing
  before/after JSON.
- **Soft deletes**: `deletedAt` on User/Employee/Department/Team — no route
  issues a hard `DELETE`.

## 6. Not included (kept out to stay "simple")

- Document/file storage (upload endpoint just stores a `fileUrl` you already
  have — wire up S3/Cloudinary/local disk in front of it if needed).
- A separate dynamic ROLES/PERMISSIONS/ROLE_PERMISSIONS table — 4 fixed
  roles are handled via an enum + middleware instead.
- Complex escalation tiers (Director/CEO) mentioned as an "if the deeper
  chain is required" extension in the blueprint — only the standard
  Manager → HR two-gate flow is implemented.
