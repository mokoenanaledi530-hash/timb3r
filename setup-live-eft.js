const { Client } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

const sql = `
BEGIN;

CREATE TABLE IF NOT EXISTS bank_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  profile_reference TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  sender_name TEXT,
  sender_bank TEXT,
  payment_date TIMESTAMPTZ,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_payments_created
  ON bank_payments(created_at DESC);

CREATE INDEX IF NOT EXISTS bank_payments_status
  ON bank_payments(status);

CREATE INDEX IF NOT EXISTS bank_payments_user_created
  ON bank_payments(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION credit_approved_bank_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO transactions (
    user_id, reference, type, amount, currency, status,
    source, provider_reference, completed_at
  ) VALUES (
    NEW.user_id, 'BANK-' || NEW.id::text, 'deposit', NEW.amount,
    'ZAR', 'completed', 'manual_bank_verification',
    'BANK-' || NEW.id::text, now()
  ) ON CONFLICT (reference) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bank_payments_credit_on_approval ON bank_payments;

CREATE TRIGGER bank_payments_credit_on_approval
AFTER UPDATE OF status ON bank_payments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'approved')
EXECUTE FUNCTION credit_approved_bank_payment();

COMMIT;
`;

(async () => {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await db.connect();
    await db.query(sql);
    console.log('Live EFT payment schema is ready.');
  } finally {
    await db.end();
  }
})().catch(error => {
  console.error('Setup failed:', error.message);
  process.exit(1);
});
