ALTER TABLE merchant_settlement_invoices ADD COLUMN paid_out_amount NUMERIC(15,2);
ALTER TABLE merchant_settlement_invoices ADD COLUMN paid_out_journal_id UUID;
ALTER TABLE merchant_settlement_invoices ADD COLUMN settled_by UUID REFERENCES staff_users(id);
ALTER TABLE merchant_settlement_invoices ADD COLUMN settled_at TIMESTAMPTZ;
