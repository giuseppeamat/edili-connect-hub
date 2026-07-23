
CREATE OR REPLACE FUNCTION public.admin_set_member_active(
  _user uuid, _org uuid, _active boolean, _actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_ok boolean;
  target_org uuid;
  is_owner boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND organization_id = _org
      AND role IN ('proprietario','amministratore')
  ) INTO actor_ok;
  IF NOT actor_ok THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO target_org FROM public.profiles WHERE id = _user;
  IF target_org IS DISTINCT FROM _org THEN
    RAISE EXCEPTION 'Utente non appartenente all''organizzazione' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user AND organization_id = _org AND role = 'proprietario'
  ) INTO is_owner;
  IF is_owner THEN
    RAISE EXCEPTION 'Il proprietario non può essere disattivato' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.allow_member_admin', 'on', true);
  UPDATE public.profiles
    SET is_active = _active,
        disattivato_at = CASE WHEN _active THEN NULL ELSE now() END,
        disattivato_da = CASE WHEN _active THEN NULL ELSE _actor END
    WHERE id = _user;
END; $$;

REVOKE ALL ON FUNCTION public.admin_set_member_active(uuid, uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
-- Solo service_role può chiamarla (server function usa admin client)
GRANT EXECUTE ON FUNCTION public.admin_set_member_active(uuid, uuid, boolean, uuid) TO service_role;
