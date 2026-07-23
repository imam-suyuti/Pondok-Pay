-- User-approved terminal operator authentication for sensitive Admin-terminal actions.
ALTER TABLE staff_users ADD COLUMN action_pin_hash TEXT;
-- Transport contract: terminal sends SHA-256(staff_user_id + salt_tenant + PIN). The server
-- stores that transport value using Argon2id in action_pin_hash; plaintext PIN is never sent.
