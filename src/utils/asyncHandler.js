// Wraps an async route handler so thrown errors go to Express's error middleware
// instead of crashing the process or needing a try/catch in every controller.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
