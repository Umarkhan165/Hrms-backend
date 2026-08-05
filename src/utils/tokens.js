const jwt = require('jsonwebtoken');

const signAccessToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '1d' }
  );

const signRefreshToken = (user) =>
  jwt.sign({ id: user.id }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '10d',
  });

// Converts "10d" / "1d" / "15m" style strings into a millisecond offset for
// storing Session.expiresAt.
const expiryToDate = (expiryStr) => {
  const match = /^(\d+)([smhd])$/.exec(expiryStr || '10d');
  const [, amountStr, unit] = match || [null, '10', 'd'];
  const amount = Number(amountStr);
  const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return new Date(Date.now() + amount * unitMs);
};

module.exports = { signAccessToken, signRefreshToken, expiryToDate };
