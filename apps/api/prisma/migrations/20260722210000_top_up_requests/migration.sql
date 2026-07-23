CREATE TABLE top_up_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  santri_id UUID NOT NULL REFERENCES santri(id),
  initiated_by_type VARCHAR(20) NOT NULL,
  initiated_by_id UUID NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK(amount > 0),
  channel VARCHAR(20) NOT NULL,
  gateway_reference VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  journal_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);
ALTER TABLE top_up_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE top_up_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_top_up_requests ON top_up_requests USING (tenant_id=current_setting('app.current_tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.current_tenant_id',true)::uuid);
