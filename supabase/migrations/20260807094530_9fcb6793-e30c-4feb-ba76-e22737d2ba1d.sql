REVOKE ALL ON FUNCTION public._cs_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cov_immutable_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cs_touch_updated_at() FROM PUBLIC, anon, authenticated;