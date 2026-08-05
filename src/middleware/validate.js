const ApiError = require('../utils/ApiError');

// Generic Zod validation middleware - fulfils the "strict schema validation on
// every boundary endpoint" non-functional requirement without a framework.
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return next(new ApiError(400, message));
  }
  req.body = result.data;
  next();
};

module.exports = validate;
