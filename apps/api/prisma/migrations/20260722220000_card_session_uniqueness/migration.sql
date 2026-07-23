CREATE UNIQUE INDEX uq_open_card_registration_session_uid
  ON card_registration_sessions(tenant_id, card_uid)
  WHERE status IN ('SCANNED','SANTRI_SELECTED');
CREATE UNIQUE INDEX uq_open_card_pin_reset_session_card
  ON card_pin_reset_sessions(tenant_id, card_id)
  WHERE status IN ('SCANNED','IDENTITY_CONFIRMED');
