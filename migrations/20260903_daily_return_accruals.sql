CREATE TABLE IF NOT EXISTS investment_return_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id UUID NOT NULL
    REFERENCES investments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES users(id),
  accrual_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  transaction_id UUID
    REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(investment_id, accrual_date)
);

CREATE INDEX IF NOT EXISTS return_accrual_user_date
ON investment_return_accruals(user_id, accrual_date DESC);
