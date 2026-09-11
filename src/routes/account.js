const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/user/profile
router.get('/profile', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, mobile, is_active, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/account/balance
// Equity = balance + floating P/L of open positions, computed server-side
// from symbols.last_price — never from a value the client sends.
router.get('/balance', async (req, res) => {
  try {
    const accountResult = await pool.query(
      'SELECT balance, currency FROM trading_accounts WHERE id = $1',
      [req.accountId]
    );
    const positionsResult = await pool.query(
      `SELECT p.side, p.lots, p.entry_price, s.last_price, s.contract_size
       FROM positions p JOIN symbols s ON s.id = p.symbol_id
       WHERE p.account_id = $1 AND p.status = 'open'`,
      [req.accountId]
    );

    const floatingPnl = positionsResult.rows.reduce((sum, p) => {
      const diff = p.side === 'buy' ? (p.last_price - p.entry_price) : (p.entry_price - p.last_price);
      return sum + diff * p.contract_size * p.lots;
    }, 0);

    const balance = parseFloat(accountResult.rows[0].balance);
    res.json({
      balance,
      floatingPnl: Number(floatingPnl.toFixed(2)),
      equity: Number((balance + floatingPnl).toFixed(2)),
      currency: accountResult.rows[0].currency,
    });
  } catch (err) {
    console.error('Balance fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
