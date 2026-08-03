-- 1) Helper: accesso realmente attivo (più restrittivo, mai più permissivo)
CREATE OR REPLACE FUNCTION public.is_access_active(_user uuid, _org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
      SELECT COALESCE(p.is_active, true)
      FROM public.profiles p
      WHERE p.id = _user AND p.organization_id = _org
    ), false)
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = _user
        AND m.organization_id = _org
        AND (m.archived_at IS NOT NULL OR m.stato_accesso = 'disabilitato')
    );
$$;

REVOKE ALL ON FUNCTION public.is_access_active(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_access_active(uuid, uuid) TO authenticated, service_role;

-- 2) Sincronizzazione user_roles dalla sorgente autorevole (organization_members)
CREATE OR REPLACE FUNCTION public._om_sync_user_roles(_member uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _m public.organization_members%ROWTYPE;
BEGIN
  SELECT * INTO _m FROM public.organization_members WHERE id = _member;
  IF NOT FOUND OR _m.user_id IS NULL THEN RETURN; END IF;

  DELETE FROM public.user_roles ur
   WHERE ur.user_id = _m.user_id
     AND ur.organization_id = _m.organization_id
     AND ur.role <> _m.ruolo_organizzativo;

  INSERT INTO public.user_roles (user_id, organization_id, role)
  VALUES (_m.user_id, _m.organization_id, _m.ruolo_organizzativo)
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public._om_sync_user_roles(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._om_sync_user_roles(uuid) TO service_role;

-- 3) update_organization_member: sincronizza i permessi effettivi + audit ruolo
CREATE OR REPLACE FUNCTION public.update_organization_member(_id uuid, _expected_updated_at timestamp with time zone, _nome text, _cognome text DEFAULT NULL::text, _email text DEFAULT NULL::text, _telefono text DEFAULT NULL::text, _ruolo app_role DEFAULT NULL::app_role, _qualifica text DEFAULT NULL::text)
RETURNS TABLE(id uuid, updated_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE; _upd timestamptz;
        _mail text := NULLIF(lower(btrim(COALESCE(_email,''))),'');
        _new_role public.app_role;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  PERFORM public._om_assert_manager(_org);
  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il membro è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001';
  END IF;
  IF _ruolo IS NOT NULL AND _ruolo = 'proprietario' THEN
    RAISE EXCEPTION 'Il ruolo Proprietario non è assegnabile' USING ERRCODE='42501';
  END IF;
  IF _m.ruolo_organizzativo = 'proprietario' AND _ruolo IS NOT NULL AND _ruolo <> 'proprietario' THEN
    RAISE EXCEPTION 'Il ruolo del proprietario non può essere modificato' USING ERRCODE='42501';
  END IF;
  IF _ruolo IS NOT NULL AND _ruolo = 'amministratore'
     AND NOT public.has_any_role(_org, ARRAY['proprietario']::public.app_role[]) THEN
    RAISE EXCEPTION 'Solo il proprietario può assegnare il ruolo Amministratore' USING ERRCODE='42501';
  END IF;
  IF _mail IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.organization_members m2
      WHERE m2.organization_id = _org AND m2.email = _mail
        AND m2.archived_at IS NULL AND m2.id <> _id) THEN
    RAISE EXCEPTION 'Esiste già un membro con questa email nell''organizzazione' USING ERRCODE='23505';
  END IF;

  UPDATE public.organization_members SET
    nome = COALESCE(_nome, nome),
    cognome = _cognome,
    email = COALESCE(_mail, email),
    telefono = _telefono,
    ruolo_organizzativo = COALESCE(_ruolo, ruolo_organizzativo),
    qualifica = _qualifica,
    updated_by = _me
  WHERE organization_members.id = _id
  RETURNING organization_members.ruolo_organizzativo, organization_members.updated_at
  INTO _new_role, _upd;

  PERFORM public._om_sync_user_roles(_id);

  IF _new_role IS DISTINCT FROM _m.ruolo_organizzativo THEN
    PERFORM public._log_audit(_org, 'ruolo_modificato', 'organization_members', _id,
      jsonb_build_object('da', _m.ruolo_organizzativo, 'a', _new_role));
  END IF;

  PERFORM public._log_audit(_org, 'membro_modificato', 'organization_members', _id, '{}'::jsonb);
  id := _id; updated_at := _upd; RETURN NEXT;
END $function$;

-- 4) set_organization_member_access: disabilita/riattiva in modo atomico
CREATE OR REPLACE FUNCTION public.set_organization_member_access(_id uuid, _stato member_access_state)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  PERFORM public._om_assert_manager(_org);
  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.ruolo_organizzativo = 'proprietario' THEN
    RAISE EXCEPTION 'Il proprietario non può essere modificato' USING ERRCODE='42501';
  END IF;
  IF _stato = 'attivo' AND _m.user_id IS NULL THEN
    RAISE EXCEPTION 'Il membro non ha un account collegato' USING ERRCODE='22023';
  END IF;

  UPDATE public.organization_members
    SET stato_accesso = _stato, updated_by = _me WHERE organization_members.id = _id;

  IF _m.user_id IS NOT NULL THEN
    PERFORM set_config('app.allow_member_admin', 'on', true);
    UPDATE public.profiles
      SET is_active = (_stato = 'attivo'),
          disattivato_at = CASE WHEN _stato = 'attivo' THEN NULL ELSE now() END,
          disattivato_da = CASE WHEN _stato = 'attivo' THEN NULL ELSE _me END
      WHERE id = _m.user_id AND organization_id = _org;

    IF _stato = 'attivo' THEN
      PERFORM public._om_sync_user_roles(_id);
    END IF;
  END IF;

  PERFORM public._log_audit(_org,
    CASE _stato WHEN 'disabilitato' THEN 'accesso_disabilitato'
                WHEN 'attivo' THEN 'accesso_riattivato'
                WHEN 'invitato' THEN 'membro_invitato'
                ELSE 'membro_modificato' END,
    'organization_members', _id, jsonb_build_object('stato_accesso', _stato));
END $function$;

-- 5) Notifiche: nessuna nuova notifica ai membri con accesso disabilitato/archiviato
CREATE OR REPLACE FUNCTION public.create_notifica_event(_org uuid, _destinatari uuid[], _tipo text, _severita text, _titolo text, _messaggio text, _entity_type text, _entity_id uuid, _route text, _dedupe_scope text DEFAULT NULL::text, _metadata jsonb DEFAULT '{}'::jsonb, _source_event_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u uuid; n integer := 0; k text;
BEGIN
  IF _org IS NULL OR _destinatari IS NULL THEN RETURN 0; END IF;
  FOREACH u IN ARRAY _destinatari LOOP
    CONTINUE WHEN u IS NULL;
    CONTINUE WHEN NOT public.is_access_active(u, _org);
    k := _tipo || ':' || COALESCE(_dedupe_scope, COALESCE(_entity_id::text, 'global')) || ':' || u::text;
    INSERT INTO public.notifiche (
      organization_id, destinatario_user_id, tipo, severita, titolo, messaggio,
      entity_type, entity_id, route, dedupe_key, metadata, source_event_id, created_by
    ) VALUES (
      _org, u, _tipo, _severita, _titolo, _messaggio,
      _entity_type, _entity_id, _route, k, COALESCE(_metadata,'{}'::jsonb), _source_event_id, auth.uid()
    )
    ON CONFLICT (organization_id, destinatario_user_id, dedupe_key) WHERE archived_at IS NULL
    DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END; $function$;

-- 6) Backfill: allinea i permessi effettivi alla sorgente autorevole
DELETE FROM public.user_roles ur
USING public.organization_members m
WHERE m.user_id = ur.user_id
  AND m.organization_id = ur.organization_id
  AND m.archived_at IS NULL
  AND ur.role <> m.ruolo_organizzativo;

INSERT INTO public.user_roles (user_id, organization_id, role)
SELECT m.user_id, m.organization_id, m.ruolo_organizzativo
FROM public.organization_members m
WHERE m.user_id IS NOT NULL AND m.archived_at IS NULL
ON CONFLICT (user_id, organization_id, role) DO NOTHING;