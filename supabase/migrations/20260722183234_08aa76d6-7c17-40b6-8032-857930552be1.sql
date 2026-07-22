
-- Revoke public execute on all SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.current_organization_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_member(UUID) FROM PUBLIC, anon;

-- Trigger-only functions: revoke all
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_calc_voce() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_recalc_preventivo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_doc_stato() FROM PUBLIC, anon, authenticated;
