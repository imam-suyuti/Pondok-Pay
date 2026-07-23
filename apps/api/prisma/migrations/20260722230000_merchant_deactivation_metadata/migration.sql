ALTER TABLE merchants ADD COLUMN deactivation_reason VARCHAR(30);
ALTER TABLE merchants ADD COLUMN deactivated_at TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN has_unsettled_receivable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN unsettled_receivable_amount NUMERIC(15,2);
