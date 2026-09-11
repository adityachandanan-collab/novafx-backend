const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateNumber } = require('../utils/validators');

const router = express.Router();
router.use(requireAuth);

// POST /api/transactions — user submits a deposit/withdrawal REQUEST.
// This only ever inserts a 'pending' row. It intentionally does NOT touch
// trading_accounts.balance. Crediting a deposit must only happen after a
// real payment gateway confirms the payment (e.g. via a signed webhook), and
// approving a withdrawal must go through an authenticated admin/finance role
// with its own audit trail. Neither of those is implemented in this starter
// — wiring in a specific payment gateway and building the admin approval
// flow is a separate, deliberate step. Do not add a route that lets a
// regular user mark their own transaction 'approved'.
router.post('/', async (req, res) => {
  const { type, method, amount } = req.body;

  if (!['deposit', 'withdrawal'].includes(type)) {
    return res.status(400).json({ error: 'type must be "deposit" or "withdrawal"' });
  }
  const amountCheck = validateNumber(amount, { decimals: 2, min: 1 });
  if (!amountCheck.valid) return res.status(400).json({ error: `amount: ${amountCheck.error}` });

  try {
    if (type === 'withdrawal') {
      const accountResult = await pool.query('SELECT balance FROM trading_accounts WHERE id = $1', [req.accountId]);
      if (amountCheck.value > parseFloat(accountResult.rows[0].balance)) {
        return res.status(400).json({ error: 'Withdrawal amount exceeds available balance' });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO transactions (account_id, type, method, amount, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [req.accountId, type, (method || '').toString().slice(0, 30) || null, amountCheck.value]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Transaction create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/transactions?type=deposit&status=pending
router.get('/', async (req, res) => {
  const { type, status } = req.query;
  const clauses = ['account_id = $1'];
  const params = [req.accountId];

  if (type && ['deposit', 'withdrawal'].includes(type)) {
    params.push(type);
    clauses.push(`type = $${params.length}`);
  }
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM transactions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Transactions fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
