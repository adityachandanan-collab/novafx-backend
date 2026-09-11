const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/positions
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, s.code AS symbol, p.side, p.lots, p.entry_price, s.last_price AS current_price,
              p.sl, p.tp,
              CASE WHEN p.side = 'buy' THEN (s.last_price - p.entry_price) * s.contract_size * p.lots
                   ELSE (p.entry_price - s.last_price) * s.contract_size * p.lots END AS pnl,
              p.opened_at
       FROM positions p JOIN symbols s ON s.id = p.symbol_id
       WHERE p.account_id = $1 AND p.status = 'open'
       ORDER BY p.opened_at DESC`,
      [req.accountId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Positions fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/positions/:id/close
router.post('/:id/close', async (req, res) => {
  const positionId = parseInt(req.params.id, 10);
  if (!Number.isInteger(positionId)) return res.status(400).json({ error: 'Invalid position id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Row lock so two simultaneous close requests can't double-credit the account.
    const posResult = await client.query(
      `SELECT p.*, s.last_price, s.contract_size
       FROM positions p JOIN symbols s ON s.id = p.symbol_id
       WHERE p.id = $1 AND p.account_id = $2 AND p.status = 'open'
       FOR UPDATE`,
      [positionId, req.accountId]
    );
    if (posResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Open position not found' });
    }
    const pos = posResult.rows[0];

    const diff = pos.side === 'buy' ? (pos.last_price - pos.entry_price) : (pos.entry_price - pos.last_price);
    const pnl = diff * pos.contract_size * pos.lots;

    await client.query(
      `UPDATE positions SET status = 'closed', close_price = $1, pnl = $2, closed_at = now() WHERE id = $3`,
      [pos.last_price, pnl, positionId]
    );
    await client.query(
      `UPDATE trading_accounts SET balance = balance + $1 WHERE id = $2`,
      [pnl, req.accountId]
    );

    await client.query('COMMIT');
    res.json({ id: positionId, closePrice: pos.last_price, pnl: Number(pnl.toFixed(2)) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Position close error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
