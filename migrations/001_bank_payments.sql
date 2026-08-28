CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

CREATE INDEX IF NOT EXISTS bank_payments_user_created
ON bank_payments(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bank_payments_status_created
ON bank_payments(status, created_at DESC);

CREATE OR REPLACE FUNCTION credit_approved_bank_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved'
     AND (OLD.status IS DISTINCT FROM 'approved') THEN

    INSERT INTO transactions (
      user_id,
      reference,
      type,
      amount,
      currency,
      status,
      source,
      provider_reference,
      completed_at
    )
    VALUES (
      NEW.user_id,
      'BANK-' || REPLACE(NEW.id::text, '-', ''),
      'deposit',
      NEW.amount,
      'ZAR',
      'completed',
      'manual_bank_verification',
      'BANKPAY-' || NEW.id::text,
      now()
    )
    ON CONFLICT (reference) DO NOTHING;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_approved_bank_payment
ON bank_payments;

CREATE TRIGGER trg_credit_approved_bank_payment
AFTER UPDATE OF status ON bank_payments
FOR EACH ROW
EXECUTE FUNCTION credit_approved_bank_payment();
