CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'investor' CHECK(role IN('investor','admin','compliance')),
 kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK(kyc_status IN('pending','verified','rejected')),
 referral_code TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investment_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL, description TEXT, min_amount NUMERIC(14,2) NOT NULL,
 max_amount NUMERIC(14,2) NOT NULL, term_days INT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','paused','closed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id),
 plan_id UUID NOT NULL REFERENCES investment_plans(id),
 principal NUMERIC(14,2) NOT NULL CHECK(principal>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('pending','active','matured','cancelled')),
 started_at TIMESTAMPTZ,
 maturity_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id),
 reference TEXT NOT NULL UNIQUE,
 type TEXT NOT NULL CHECK(type IN('deposit','withdrawal','investment','return','fee','refund')),
 amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
 currency CHAR(3) NOT NULL DEFAULT 'ZAR',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','completed','failed','reversed')),
 source TEXT, provider_reference TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kyc_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id),
 document_type TEXT NOT NULL,
 storage_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_user_id UUID REFERENCES users(id),
 action TEXT NOT NULL,
 entity_type TEXT, entity_id UUID, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tx_user_created ON transactions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_created ON audit_logs(created_at DESC);

INSERT INTO investment_plans(name,description,min_amount,max_amount,term_days,status)
SELECT 'Starter Grove','Entry-level timber portfolio.',500,49999,365,'active'
WHERE NOT EXISTS(SELECT 1 FROM investment_plans WHERE name='Starter Grove');
INSERT INTO investment_plans(name,description,min_amount,max_amount,term_days,status)
SELECT 'Growth Grove','Longer-term timber portfolio.',50000,249999,730,'active'
WHERE NOT EXISTS(SELECT 1 FROM investment_plans WHERE name='Growth Grove');
INSERT INTO investment_plans(name,description,min_amount,max_amount,term_days,status)
SELECT 'Forest Partner','Large portfolio allocation.',250000,10000000,1095,'active'
WHERE NOT EXISTS(SELECT 1 FROM investment_plans WHERE name='Forest Partner');

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
