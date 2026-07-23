REVOKE ALL ON FUNCTION public.is_valid_responsabile(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_responsabile(uuid, uuid) TO service_role;