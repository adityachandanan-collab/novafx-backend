const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Admin protection
async function requireAdmin(req, res, next) {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Dashboard
router.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users`
    );

    const accounts = await pool.query(
      `SELECT COALESCE(SUM(balance), 0) AS total_balance
       FROM trading_accounts`
    );

    const transactions = await pool.query(
      `SELECT COUNT(*)::int AS count FROM transactions`
    );

    res.json({
      users: users.rows[0].count,
      totalBalance: accounts.rows[0].total_balance,
      transactions: transactions.rows[0].count
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// All users
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.mobile,
        u.is_active,
        u.role,
        u.created_at,
        ta.id AS account_id,
        ta.balance
      FROM users u
      LEFT JOIN trading_accounts ta ON ta.user_id = u.id
      ORDER BY u.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;