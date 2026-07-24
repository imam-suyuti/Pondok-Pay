-- Phase 2 DoD completion fields used by ledger limits, manual deactivation, and santri exit.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS card_fee_monthly NUMERIC(15,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS merchant_fee_monthly NUMERIC(15,2);

ALTER TABLE santri ADD COLUMN IF NOT EXISTS daily_spend_limit NUMERIC(15,2);
ALTER TABLE santri ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(30);
ALTER TABLE santri ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS platform_billing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_card_fee_monthly NUMERIC(15,2) NOT NULL DEFAULT 2000,
  default_merchant_fee_monthly NUMERIC(15,2) NOT NULL DEFAULT 25000,
  card_fee_debit_day INT NOT NULL DEFAULT 1 CHECK (card_fee_debit_day BETWEEN 1 AND 28),
  merchant_fee_debit_day INT NOT NULL DEFAULT 1 CHECK (merchant_fee_debit_day BETWEEN 1 AND 28),
  payment_deadline_days INT NOT NULL DEFAULT 7 CHECK (payment_deadline_days > 0),
  max_consecutive_negative_debits INT NOT NULL DEFAULT 2 CHECK (max_consecutive_negative_debits > 0),
  manual_deactivation_fee_cutoff_day INT NOT NULL DEFAULT 12 CHECK (manual_deactivation_fee_cutoff_day BETWEEN 1 AND 28),
  merchant_deactivation_writeoff_threshold NUMERIC(15,2) NOT NULL DEFAULT 50000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES staff_users(id)
);

INSERT INTO platform_billing_config (default_card_fee_monthly, default_merchant_fee_monthly)
SELECT 2000, 25000
WHERE NOT EXISTS (SELECT 1 FROM platform_billing_config);

CREATE TABLE IF NOT EXISTS platform_fee_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  active_card_count INT NOT NULL,
  card_fee_per_unit NUMERIC(15,2) NOT NULL,
  total_card_fee_amount NUMERIC(15,2) NOT NULL,
  active_merchant_count INT NOT NULL,
  merchant_fee_per_unit NUMERIC(15,2) NOT NULL,
  total_merchant_fee_amount NUMERIC(15,2) NOT NULL,
  total_amount NUMERIC(15,2) NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  payment_reference VARCHAR(100),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, period_year, period_month)
);

ALTER TABLE platform_fee_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_fee_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_platform_fee_invoices ON platform_fee_invoices;
CREATE POLICY tenant_isolation_platform_fee_invoices ON platform_fee_invoices
  USING (tenant_id=current_setting('app.current_tenant_id',true)::uuid)
  WITH CHECK (tenant_id=current_setting('app.current_tenant_id',true)::uuid);
