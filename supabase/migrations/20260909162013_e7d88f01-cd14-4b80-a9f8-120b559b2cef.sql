CREATE OR REPLACE FUNCTION public.submit_rapportino(_id uuid, _expected_updated_at timestamp with time zone)
 RETURNS TABLE(id uuid, stato text, updated_at timestamp with time zone, transition_at timestamp with time zone, transition_by uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _c_closed TIMESTAMPTZ;
  _c_arch TIMESTAMPTZ;
  _now TIMESTAMPTZ := now();
  _is_admin BOOLEAN;
  _persone INT;
  _max_ore NUMERIC;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato: ripristina prima di inviarlo' USING ERRCODE='22023';
  END IF;
  IF _row.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _is_admin := public.has_any_role(_org,
    ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[]);
  IF _row.user_id <> _me AND _row.created_by <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non sei autorizzato a inviare questo rapportino' USING ERRCODE='42501';
  END IF;

  -- validazioni minime
  IF _row.descrizione_lavori IS NULL OR btrim(_row.descrizione_lavori) = '' THEN
    RAISE EXCEPTION 'Descrizione lavori obbligatoria' USING ERRCODE='22023';
  END IF;
  SELECT COUNT(*) INTO _persone
    FROM public.rapportini_personale rp
    WHERE rp.rapportino_id = _id;
  _max_ore := LEAST(240, 24 * GREATEST(1, _persone));
  IF _row.ore IS NULL OR _row.ore <= 0 OR _row.ore > _max_ore THEN
    RAISE EXCEPTION 'Ore non valide: inserite % ore, massimo consentito % (24 ore per persona)', _row.ore, _max_ore USING ERRCODE='22023';
  END IF;
  IF _row.data IS NULL THEN
    RAISE EXCEPTION 'Data obbligatoria' USING ERRCODE='22023';
  END IF;
  SELECT closed_at, archived_at INTO _c_closed, _c_arch FROM public.commesse WHERE commesse.id = _row.commessa_id;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'La commessa è chiusa o archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'La commessa è chiusa o archiviata' USING ERRCODE='22023'; END IF;

  UPDATE public.rapportini SET
    stato = 'inviato',
    submitted_at = _now,
    submitted_by = _me
  WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.submitted', 'rapportini', _id, jsonb_build_object('by', _me));

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, r.submitted_at, r.submitted_by
    FROM public.rapportini r WHERE r.id = _id;
END; $function$