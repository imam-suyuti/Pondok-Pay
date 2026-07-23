-- Narrow, audited RLS bootstrap exception: terminal authentication cannot know tenant_id before lookup.
-- It returns one terminal's authentication context only; all tenant business queries remain RLS-bound.
CREATE FUNCTION terminal_authentication_bootstrap(p_device_id VARCHAR)
RETURNS TABLE (terminal_id UUID, tenant_id UUID, merchant_id UUID, terminal_type VARCHAR, status VARCHAR, device_token_hash TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, merchant_id, terminal_type, status, device_token_hash
  FROM terminals
  WHERE device_id = p_device_id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION terminal_authentication_bootstrap(VARCHAR) FROM PUBLIC;
-- Grant EXECUTE only to the non-BYPASSRLS PondokPay application database role during deployment.
