const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { validateEmail, validatePassword } = require('../utils/validators');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, mobile, password, confirmPassword } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return res.status(400).json({ error: emailCheck.error });

  const passCheck = validatePassword(password);
  if (!passCheck.valid) return res.status(400).json({ error: passCheck.error });

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailCheck.value]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(passCheck.value, 12);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        `INSERT INTO users (name, email, mobile, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [name.trim(), emailCheck.value, mobile || null, passwordHash]
      );
      const userId = userResult.rows[0].id;
      await client.query(
        `INSERT INTO trading_accounts (user_id, balance, currency) VALUES ($1, 10000.00, 'USD')`,
        [userId]
      );
      await client.query('COMMIT');

      const token = signToken(userId);
      res.status(201).json({ token, user: { id: userId, name: name.trim(), email: emailCheck.value } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;
  const emailCheck = validateEmail(email);

  const logAttempt = (success) =>
    pool.query(
      `INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)`,
      [emailCheck.valid ? emailCheck.value : (email || '').toString().slice(0, 255), ip, success]
    ).catch((e) => console.error('login_attempts insert failed:', e));

  if (!emailCheck.valid || !password) {
    await logAttempt(false);
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, is_active FROM users WHERE email = $1',
      [emailCheck.value]
    );

    if (rows.length === 0) {
      await logAttempt(false);
      // Same generic message as a wrong password — don't reveal which part was wrong.
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    if (!user.is_active) {
      await logAttempt(false);
      return res.status(403).json({ error: 'This account has been suspended' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await logAttempt(false);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await logAttempt(true);
    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
// With stateless JWTs, "logout" is enforced client-side (delete the token).
// For real forced-logout / "log out other devices" support, swap to
// server-side sessions or keep a token-blacklist table — noted in README.
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out. Discard the token on the client.' });
});

module.exports = router;
