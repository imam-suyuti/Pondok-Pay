ALTER TABLE cards ADD COLUMN deactivation_reason VARCHAR(30);
ALTER TABLE cards ADD COLUMN deactivated_at TIMESTAMPTZ;
