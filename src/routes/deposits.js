const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        method,
        enabled,
        upi_id,
        bank_name,
        account_name,
        account_number,
        ifsc,
        qr_code_url,
        instructions,
        updated_at
      FROM payment_settings
      WHERE enabled = true
      ORDER BY id ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Deposit settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      method = 'upi',
      enabled = true,
      upi_id = null,
      bank_name = null,
      account_name = null,
      account_number = null,
      ifsc = null,
      qr_code_url = null,
      instructions = null
    } = req.body;

    const { rows } = await pool.query(
      `
      INSERT INTO payment_settings (
        method,
        enabled,
        upi_id,
        bank_name,
        account_name,
        account_number,
        ifsc,
        qr_code_url,
        instructions,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      RETURNING *
      `,
      [
        method,
        Boolean(enabled),
        upi_id,
        bank_name,
        account_name,
        account_number,
        ifsc,
        qr_code_url,
        instructions
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('Update deposit settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      amount,
      method = 'upi',
      utr = null,
      screenshot_url = null
    } = req.body;

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        error: 'Valid deposit amount is required'
      });
    }

    if (numericAmount > 10000000) {
      return res.status(400).json({
        error: 'Deposit amount is too large'
      });
    }

    const settings = await client.query(
      `
      SELECT id
      FROM payment_settings
      WHERE method = $1
        AND enabled = true
      LIMIT 1
      `,
      [method]
    );

    if (settings.rowCount === 0) {
      return res.status(400).json({
        error: 'This deposit method is not available'
      });
    }

    if (utr) {
      const duplicate = await client.query(
        `
        SELECT id
        FROM deposit_requests
        WHERE utr = $1
          AND status IN ('pending', 'approved')
        LIMIT 1
        `,
        [utr.trim()]
      );

      if (duplicate.rowCount > 0) {
        return res.status(409).json({
          error: 'This UTR has already been used'
        });
      }
    }

    const { rows } = await client.query(
      `
      INSERT INTO deposit_requests (
        user_id,
        account_id,
        amount,
        method,
        utr,
        screenshot_url,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,'pending')
      RETURNING *
      `,
      [
        req.userId,
        req.accountId,
        numericAmount,
        method,
        utr ? utr.trim() : null,
        screenshot_url
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create deposit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.get('/my', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        amount,
        method,
        utr,
        screenshot_url,
        status,
        rejection_reason,
        admin_note,
        reviewed_at,
        created_at
      FROM deposit_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.userId]
    );

    res.json(rows);
  } catch (err) {
    console.error('My deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        d.id,
        d.amount,
        d.method,
        d.utr,
        d.screenshot_url,
        d.status,
        d.rejection_reason,
        d.admin_note,
        d.reviewed_at,
        d.created_at,
        u.id AS user_id,
        u.name,
        u.email,
        u.mobile,
        ta.id AS account_id,
        ta.balance
      FROM deposit_requests d
      JOIN users u ON u.id = d.user_id
      JOIN trading_accounts ta ON ta.id = d.account_id
      ORDER BY d.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Admin deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const depositResult = await client.query(
      `
      SELECT *
      FROM deposit_requests
      WHERE id = $1
      FOR UPDATE
      `,
      [req.params.id]
    );

    if (depositResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Deposit not found'
      });
    }

    const deposit = depositResult.rows[0];

    if (deposit.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Deposit is already ${deposit.status}`
      });
    }

    await client.query(
      `
      UPDATE trading_accounts
      SET balance = balance + $1
      WHERE id = $2
      `,
      [deposit.amount, deposit.account_id]
    );

    await client.query(
      `
      UPDATE deposit_requests
      SET
        status = 'approved',
        reviewed_by = $1,
        reviewed_at = now()
      WHERE id = $2
      `,
      [req.userId, deposit.id]
    );

    const reference = `DEP-${deposit.id}-${Date.now()}`;

    await client.query(
      `
      INSERT INTO transactions (
        account_id,
        type,
        method,
        amount,
        status,
        reference,
        created_at
      )
      VALUES ($1,'deposit',$2,$3,'approved',$4,now())
      `,
      [
        deposit.account_id,
        deposit.method,
        deposit.amount,
        reference
      ]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Deposit approved successfully',
      deposit_id: deposit.id,
      amount: deposit.amount,
      reference
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve deposit error:', err);
    res.status(500).json({
      error: 'Internal server error'
    });
  } finally {
    client.release();
  }
});

router.post('/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const reason =
      typeof req.body?.reason === 'string'
        ? req.body.reason.trim()
        : '';

    if (!reason) {
      return res.status(400).json({
        error: 'Rejection reason is required'
      });
    }

    const result = await client.query(
      `
      UPDATE deposit_requests
      SET
        status = 'rejected',
        rejection_reason = $1,
        reviewed_by = $2,
        reviewed_at = now()
      WHERE id = $3
        AND status = 'pending'
      RETURNING *
      `,
      [reason, req.userId, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: 'Deposit not found or already reviewed'
      });
    }

    res.json({
      message: 'Deposit rejected successfully',
      deposit: result.rows[0]
    });
  } catch (err) {
    console.error('Reject deposit error:', err);
    res.status(500).json({
      error: 'Internal server error'
    });
  } finally {
    client.release();
  }
});

module.exports = router;
