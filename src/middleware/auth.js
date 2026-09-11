const jwt = require('jsonwebtoken');
const pool = require('../db');

// Protects a route: verifies the JWT, confirms the user still exists and is
// active, and attaches req.userId / req.accountId. Never trust a user_id or
// account_id sent in the request body — always derive it from the token.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing or invalid Authorization header' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.is_active, u.role,  ta.id AS account_id
       FROM users u
       JOIN trading_accounts ta ON ta.user_id = u.id
       WHERE u.id = $1`,
      [payload.sub]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Account no longer exists' });
    if (!rows[0].is_active) return res.status(403).json({ error: 'Account is suspended' });

    req.userId = rows[0].user_id;
req.userRole = rows[0].role;
req.accountId = rows[0].account_id;
    next();
  } catch (err) {
    console.error('requireAuth DB error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { requireAuth };
