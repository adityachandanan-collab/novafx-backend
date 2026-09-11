const rateLimit = require('express-rate-limit');

// Blunt but effective brute-force protection on top of the login_attempts
// table (which lets you build smarter per-account lockouts later).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

module.exports = { loginLimiter };
