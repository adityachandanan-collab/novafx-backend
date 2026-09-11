const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateNumber } = require('../utils/validators');

const router = express.Router();
router.use(requireAuth);

// POST /api/orders — opens a market position.
// Every field is re-validated here. Price is NEVER taken from the client —
// it's read from symbols.last_price, which your price-feed job should keep
// updated. Wiring that feed up to a real market data source is outside this
// starter's scope (see README).
router.post('/', async (req, res) => {
  const { symbol, side, lots, sl, tp } = req.body;

  if (!['buy', 'sell'].includes(side)) {
    return res.status(400).json({ error: 'side must be "buy" or "sell"' });
  }

  try {
    const symResult = await pool.query(
      'SELECT * FROM symbols WHERE code = $1 AND is_active = true',
      [(symbol || '').toString().toUpperCase()]
    );
    if (symResult.rows.length === 0) return res.status(400).json({ error: 'Unknown or inactive symbol' });
    const sym = symResult.rows[0];

    if (sym.last_price == null) {
      return res.status(503).json({ error: 'No live price available for this symbol yet' });
    }

    const lotCheck = validateNumber(lots, { decimals: 2, min: parseFloat(sym.min_lot), max: parseFloat(sym.max_lot) });
    if (!lotCheck.valid) return res.status(400).json({ error: `lots: ${lotCheck.error}` });

    const slCheck = validateNumber(sl, { decimals: sym.decimals, min: 0.00001, allowEmpty: true });
    if (!slCheck.valid) return res.status(400).json({ error: `sl: ${slCheck.error}` });

    const tpCheck = validateNumber(tp, { decimals: sym.decimals, min: 0.00001, allowEmpty: true });
    if (!tpCheck.valid) return res.status(400).json({ error: `tp: ${tpCheck.error}` });

    // Minimal margin check — expand with real leverage/margin-call rules for production.
    const notional = sym.last_price * sym.contract_size * lotCheck.value;
    const accountResult = await pool.query('SELECT balance FROM trading_accounts WHERE id = $1', [req.accountId]);
    const requiredMargin = notional / 100; // placeholder 1:100 leverage
    if (requiredMargin > parseFloat(accountResult.rows[0].balance)) {
      return res.status(400).json({ error: 'Insufficient margin' });
    }

    const insertResult = await pool.query(
      `INSERT INTO positions (account_id, symbol_id, side, lots, entry_price, sl, tp)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.accountId, sym.id, side, lotCheck.value, sym.last_price, slCheck.value, tpCheck.value]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error('Order create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders — alias for open positions, kept for the API shape in the spec.
router.get('/', async (req, res) => {
  res.redirect(307, '/api/positions');
});

module.exports = router;
