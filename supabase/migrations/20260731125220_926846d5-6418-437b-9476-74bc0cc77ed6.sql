-- Catena versioni di un documento (risalita + discesa), sempre dentro l'organizzazione
CREATE OR REPLACE FUNCTION public.documento_version_chain(_org uuid, _id uuid)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE up AS (
    SELECT d.id, d.documento_precedente_id
    FROM public.documenti d
    WHERE d.id = _id AND d.organization_id = _org
    UNION
    SELECT p.id, p.documento_precedente_id
    FROM public.documenti p
    JOIN up ON up.documento_precedente_id = p.id
    WHERE p.organization_id = _org
  ),
  down AS (
    SELECT u.id FROM up u
    UNION
    SELECT c.id
    FROM public.documenti c
    JOIN down ON c.documento_precedente_id = down.id
    WHERE c.organization_id = _org
  )
  SELECT d.id FROM down d;
$$;

REVOKE ALL ON FUNCTION public.documento_version_chain(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.documento_version_chain(uuid, uuid) TO authenticated, service_role;

-- Archiviazione / ripristino atomico dell'intera catena versioni
CREATE OR REPLACE FUNCTION public.archive_documento_chain(_id uuid, _archive boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_ids uuid[];
  v_changed int := 0;
  v_now timestamptz := now();
BEGIN
  SELECT d.organization_id INTO v_org
  FROM public.documenti d
  WHERE d.id = _id;

  IF v_org IS NULL OR v_org <> public.current_organization_id() THEN
    RAISE EXCEPTION 'Elemento non trovato.';
  END IF;

  IF NOT public.has_any_role(v_org, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  SELECT array_agg(c.id) INTO v_ids
  FROM public.documento_version_chain(v_org, _id) c;

  IF _archive THEN
    UPDATE public.documenti d
    SET archived_at = v_now,
        archived_by = auth.uid(),
        stato = 'archiviato',
        updated_by = auth.uid()
    WHERE d.id = ANY(v_ids)
      AND d.organization_id = v_org
      AND d.archived_at IS NULL;
  ELSE
    UPDATE public.documenti d
    SET archived_at = NULL,
        archived_by = NULL,
        stato = 'valido',
        updated_by = auth.uid()
    WHERE d.id = ANY(v_ids)
      AND d.organization_id = v_org
      AND d.archived_at IS NOT NULL;
  END IF;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  INSERT INTO public.audit_log (organization_id, user_id, action, entity, entity_id, metadata)
  VALUES (
    v_org, auth.uid(),
    CASE WHEN _archive THEN 'documento_archiviato' ELSE 'documento_ripristinato' END,
    'documenti', _id,
    jsonb_build_object('versioni', array_length(v_ids, 1), 'modificate', v_changed)
  );

  RETURN jsonb_build_object(
    'id', _id,
    'archived', _archive,
    'versioni', array_length(v_ids, 1),
    'modificate', v_changed,
    'idempotent', v_changed = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.archive_documento_chain(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_documento_chain(uuid, boolean) TO authenticated, service_role;

-- Verifica se un path Storage è ancora referenziato da un documento (qualunque stato)
CREATE OR REPLACE FUNCTION public.documento_storage_path_referenced(_org uuid, _path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documenti d
    WHERE d.organization_id = _org
      AND d.storage_bucket = 'documenti'
      AND d.storage_path = _path
  );
$$;

REVOKE ALL ON FUNCTION public.documento_storage_path_referenced(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.documento_storage_path_referenced(uuid, text) TO authenticated, service_role;