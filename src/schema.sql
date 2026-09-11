-- NovaFX starter schema — run this once against your Postgres database.
-- psql "$DATABASE_URL" -f src/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  mobile        VARCHAR(20),
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tracks every login attempt (success or fail) for rate-limiting / lockout logic.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  ip_address  VARCHAR(64),
  success     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts(email, created_at);

-- One trading account per user for this starter (a user could have many in a real system).
CREATE TABLE IF NOT EXISTS trading_accounts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance     NUMERIC(18,2) NOT NULL DEFAULT 10000.00,
  currency    VARCHAR(10) NOT NULL DEFAULT 'USD',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_user ON trading_accounts(user_id);

-- Instrument reference data. last_price is written by YOUR price feed job —
-- never take price from the client when opening/closing a position.
CREATE TABLE IF NOT EXISTS symbols (
  id             SERIAL PRIMARY KEY,
  code           VARCHAR(20) UNIQUE NOT NULL,      -- e.g. EURUSD
  display_name   VARCHAR(40) NOT NULL,             -- e.g. EUR/USD
  group_name     VARCHAR(20) NOT NULL,             -- Forex / Metals / Crypto
  decimals       SMALLINT NOT NULL,
  pip            NUMERIC(18,8) NOT NULL,
  contract_size  NUMERIC(18,2) NOT NULL,
  min_lot        NUMERIC(8,2) NOT NULL DEFAULT 0.01,
  max_lot        NUMERIC(8,2) NOT NULL DEFAULT 50.00,
  last_price     NUMERIC(18,8),
  is_active      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS positions (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  symbol_id    INTEGER NOT NULL REFERENCES symbols(id),
  side         VARCHAR(4) NOT NULL CHECK (side IN ('buy','sell')),
  lots         NUMERIC(8,2) NOT NULL CHECK (lots > 0),
  entry_price  NUMERIC(18,8) NOT NULL,
  sl           NUMERIC(18,8),
  tp           NUMERIC(18,8),
  status       VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  close_price  NUMERIC(18,8),
  pnl          NUMERIC(18,2),
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id, status);

-- Deposit / withdrawal REQUESTS. Inserting a row here never changes balance —
-- balance only changes when an authorized, audited process marks a deposit
-- 'approved' after real payment verification. That process is intentionally
-- not included in this starter — see README.
CREATE TABLE IF NOT EXISTS transactions (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  type        VARCHAR(12) NOT NULL CHECK (type IN ('deposit','withdrawal')),
  method      VARCHAR(30),
  amount      NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  status      VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reference   VARCHAR(80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id, created_at);

-- Seed a few instruments so the API has something to trade against.
INSERT INTO symbols (code, display_name, group_name, decimals, pip, contract_size, min_lot, max_lot, last_price)
VALUES
  ('EURUSD','EUR/USD','Forex',5,0.0001,100000,0.01,50,1.08420),
  ('GBPUSD','GBP/USD','Forex',5,0.0001,100000,0.01,50,1.27310),
  ('USDJPY','USD/JPY','Forex',3,0.01,100000,0.01,50,151.220),
  ('XAUUSD','XAU/USD','Metals',2,0.1,100,0.01,20,2418.50),
  ('BTCUSD','BTC/USD','Crypto',1,1,1,0.01,5,64250.0)
ON CONFLICT (code) DO NOTHING;
