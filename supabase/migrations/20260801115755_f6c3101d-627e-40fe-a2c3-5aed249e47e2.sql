REVOKE ALL ON FUNCTION public._om_assert_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_costo_orario_membro_at_date(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._om_assert_manager(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_costo_orario_membro_at_date(uuid, uuid, date) TO service_role;