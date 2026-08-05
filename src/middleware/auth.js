const jwt = require("jsonwebtoken");
const ApiError = require("../utils/ApiError");
const prisma = require("../config/db");

// Verifies the access token and attaches the Db user with employee profile to req.user
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new ApiError(401, "Access token missing");

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { employee: true },
    });

    if (!user || user.deletedAt) throw new ApiError(401, "User not found");
    if (!user.isActive) throw new ApiError(403, "Account has been deactivated");

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    return next(new ApiError(401, "Invalid or expired access token"));
  }
};

// Restricts a route to one or more roles e.g. authorize('HR', 'ADMIN')
const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(new ApiError(401, "Not authenticated"));

    const role = (req.user.role || req.user.employee?.role || "").toUpperCase();

    if (!role || !roles.includes(role)) {
      return next(
        new ApiError(403, "You do not have permission to perform this action"),
      );
    }
    next();
  };

module.exports = { authenticate, authorize };
