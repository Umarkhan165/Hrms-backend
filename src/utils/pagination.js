// Shared helper for the "every list endpoint must support pagination,
// filtering, sorting, search" non-functional requirement.
const getPagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getSort = (query, allowedFields = [], fallback = 'createdAt') => {
  const field = allowedFields.includes(query.sortBy) ? query.sortBy : fallback;
  const order = query.sortOrder === 'asc' ? 'asc' : 'desc';
  return { [field]: order };
};

module.exports = { getPagination, getSort };
