require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const orderRoutes = require('./routes/orders');
const positionRoutes = require('./routes/positions');
const transactionRoutes = require('./routes/transactions');
const adminRoutes = require('./routes/admin');
const depositRoutes = require('./routes/deposits');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '100kb' }));

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  })
);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/user', accountRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/deposits', depositRoutes);

// Fallback error handler — never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`NovaFX backend listening on port ${port}`);
});
