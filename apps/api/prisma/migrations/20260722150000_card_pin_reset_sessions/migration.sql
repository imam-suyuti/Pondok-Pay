CREATE TABLE card_pin_reset_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  terminal_id UUID NOT NULL REFERENCES terminals(id),
  card_id UUID NOT NULL REFERENCES cards(id),
  status VARCHAR(30) NOT NULL DEFAULT 'SCANNED',
  confirmed_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE card_pin_reset_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_pin_reset_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_card_pin_reset_sessions ON card_pin_reset_sessions USING (tenant_id=current_setting('app.current_tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.current_tenant_id',true)::uuid);
