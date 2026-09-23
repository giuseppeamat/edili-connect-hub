
-- 1) Bolla indipendente dal rapportino
ALTER TABLE public.rapportini_bolle ALTER COLUMN rapportino_id DROP NOT NULL;
ALTER TABLE public.rapportini_bolle ALTER COLUMN commessa_id DROP NOT NULL;
ALTER TABLE public.rapportini_bolle ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.rapportini_bolle ADD COLUMN IF NOT EXISTS archived_by uuid;
CREATE INDEX IF NOT EXISTS rapportini_bolle_org_idx ON public.rapportini_bolle (organization_id, data_bolla DESC);

-- 2) Save generico (rapportino opzionale)
CREATE OR REPLACE FUNCTION public.save_bolla(_bolla jsonb, _righe jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org uuid; r public.rapportini; rap_id uuid; com uuid; cant uuid; fid uuid; bid uuid;
  econ boolean; el jsonb; pos int := 0; tot numeric(14,2) := 0; ivatot numeric(14,2) := 0;
  q numeric; pu numeric; sc numeric; ivp numeric; tr numeric; rid uuid; mid uuid;
  dbolla date; docid uuid; existing public.rapportini_bolle;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata'; END IF;
  IF NOT public.can_edit_rapportino_extra(org) THEN
    RAISE EXCEPTION 'Permessi insufficienti per registrare bolle';
  END IF;
  econ := public.can_see_econ(org);

  fid := NULLIF(_bolla->>'fornitore_id','')::uuid;
  IF fid IS NULL THEN RAISE EXCEPTION 'Fornitore obbligatorio'; END IF;
  PERFORM 1 FROM public.fornitori WHERE id = fid AND organization_id = org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fornitore non valido'; END IF;
  IF COALESCE(btrim(_bolla->>'numero_bolla'),'') = '' THEN RAISE EXCEPTION 'Numero bolla obbligatorio'; END IF;
  IF jsonb_typeof(_righe) <> 'array' THEN RAISE EXCEPTION 'Righe non valide'; END IF;

  rap_id := NULLIF(_bolla->>'rapportino_id','')::uuid;
  com := NULLIF(_bolla->>'commessa_id','')::uuid;
  cant := NULLIF(_bolla->>'cantiere_id','')::uuid;

  IF rap_id IS NOT NULL THEN
    r := public._rap_bolla_guard(rap_id);
    com := r.commessa_id;
    cant := COALESCE(cant, r.cantiere_id);
  ELSIF com IS NOT NULL THEN
    PERFORM 1 FROM public.commesse WHERE id = com AND organization_id = org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non valida'; END IF;
    IF NOT public.can_access_commessa(com) THEN RAISE EXCEPTION 'Accesso negato alla commessa'; END IF;
  END IF;

  IF cant IS NOT NULL THEN
    IF com IS NULL THEN
      SELECT k.commessa_id INTO com FROM public.cantieri k WHERE k.id = cant AND k.organization_id = org;
      IF com IS NULL THEN RAISE EXCEPTION 'Cantiere non valido'; END IF;
      IF NOT public.can_access_commessa(com) THEN RAISE EXCEPTION 'Accesso negato alla commessa'; END IF;
    ELSE
      PERFORM 1 FROM public.cantieri WHERE id = cant AND organization_id = org AND commessa_id = com;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cantiere non coerente con la commessa'; END IF;
    END IF;
  END IF;

  dbolla := COALESCE(NULLIF(_bolla->>'data_bolla','')::date, r.data, CURRENT_DATE);
  docid := NULLIF(_bolla->>'documento_id','')::uuid;
  IF docid IS NOT NULL THEN
    PERFORM 1 FROM public.documenti WHERE id = docid AND organization_id = org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Documento non valido'; END IF;
  END IF;

  bid := NULLIF(_bolla->>'id','')::uuid;
  IF bid IS NULL THEN
    INSERT INTO public.rapportini_bolle (
      organization_id, rapportino_id, commessa_id, cantiere_id, fornitore_id,
      numero_bolla, data_bolla, data_consegna, note, stato, documento_id, created_by, updated_by
    ) VALUES (
      org, rap_id, com, cant, fid,
      btrim(_bolla->>'numero_bolla'), dbolla,
      NULLIF(_bolla->>'data_consegna','')::date,
      NULLIF(_bolla->>'note',''),
      COALESCE(NULLIF(_bolla->>'stato',''),'registrata'),
      docid, auth.uid(), auth.uid()
    ) RETURNING id INTO bid;
  ELSE
    SELECT * INTO existing FROM public.rapportini_bolle WHERE id = bid AND organization_id = org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bolla non trovata'; END IF;
    IF existing.stato = 'annullata' THEN RAISE EXCEPTION 'Bolla annullata: non modificabile'; END IF;
    IF existing.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Bolla archiviata: non modificabile'; END IF;
    IF existing.rapportino_id IS NOT NULL AND rap_id IS NULL THEN
      rap_id := existing.rapportino_id;
      r := public._rap_bolla_guard(rap_id);
      com := r.commessa_id;
      cant := COALESCE(cant, r.cantiere_id);
    END IF;
    UPDATE public.rapportini_bolle SET
      rapportino_id = rap_id,
      commessa_id = com,
      cantiere_id = cant,
      fornitore_id = fid,
      numero_bolla = btrim(_bolla->>'numero_bolla'),
      data_bolla = dbolla,
      data_consegna = NULLIF(_bolla->>'data_consegna','')::date,
      note = NULLIF(_bolla->>'note',''),
      stato = COALESCE(NULLIF(_bolla->>'stato',''), stato),
      documento_id = COALESCE(docid, documento_id),
      updated_by = auth.uid()
    WHERE id = bid;
    DELETE FROM public.materiali_prezzi_fornitori WHERE bolla_id = bid;
    DELETE FROM public.rapportini_bolle_righe WHERE bolla_id = bid;
  END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(_righe) LOOP
    pos := pos + 1;
    IF COALESCE(btrim(el->>'descrizione'),'') = '' THEN RAISE EXCEPTION 'Descrizione riga % obbligatoria', pos; END IF;
    q := NULLIF(el->>'quantita','')::numeric;
    IF q IS NULL OR q <= 0 THEN RAISE EXCEPTION 'Quantità non valida alla riga %', pos; END IF;
    pu := NULLIF(el->>'prezzo_unitario','')::numeric;
    IF pu IS NOT NULL AND NOT econ THEN pu := NULL; END IF;
    sc := COALESCE(NULLIF(el->>'sconto_pct','')::numeric, 0);
    IF sc < 0 OR sc > 100 THEN RAISE EXCEPTION 'Sconto non valido alla riga %', pos; END IF;
    ivp := NULLIF(el->>'iva_pct','')::numeric;
    tr := CASE WHEN pu IS NULL THEN NULL ELSE round(q * pu * (1 - sc/100.0), 2) END;
    mid := NULLIF(el->>'materiale_id','')::uuid;
    IF mid IS NOT NULL THEN
      PERFORM 1 FROM public.materiali WHERE id = mid AND organization_id = org;
      IF NOT FOUND THEN RAISE EXCEPTION 'Materiale non valido alla riga %', pos; END IF;
    END IF;

    INSERT INTO public.rapportini_bolle_righe (
      organization_id, bolla_id, materiale_id, descrizione, codice_articolo,
      quantita, unita_misura, prezzo_unitario, sconto_pct, totale_riga, iva_pct, note, posizione
    ) VALUES (
      org, bid, mid, btrim(el->>'descrizione'), NULLIF(el->>'codice_articolo',''),
      q, NULLIF(el->>'unita_misura',''), pu, sc, tr, ivp, NULLIF(el->>'note',''), pos
    ) RETURNING id INTO rid;

    IF tr IS NOT NULL THEN
      tot := tot + tr;
      IF ivp IS NOT NULL THEN ivatot := ivatot + round(tr * ivp/100.0, 2); END IF;
      INSERT INTO public.materiali_prezzi_fornitori (
        organization_id, materiale_id, descrizione, fornitore_id, data_prezzo,
        prezzo_unitario, unita_misura, quantita_riferimento, bolla_riga_id, bolla_id, commessa_id
      ) VALUES (
        org, mid, btrim(el->>'descrizione'), fid, dbolla,
        pu, NULLIF(el->>'unita_misura',''), q, rid, bid, com
      );
    END IF;
  END LOOP;

  UPDATE public.rapportini_bolle
    SET imponibile = CASE WHEN tot = 0 THEN NULL ELSE tot END,
        iva = CASE WHEN ivatot = 0 THEN NULL ELSE ivatot END,
        totale = CASE WHEN tot = 0 THEN NULL ELSE tot + ivatot END
  WHERE id = bid;

  PERFORM public._log_audit(org, 'save_bolla', 'rapportini_bolle', bid,
    jsonb_build_object('rapportino_id', rap_id, 'righe', pos));
  RETURN bid;
END $function$;

REVOKE ALL ON FUNCTION public.save_bolla(jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_bolla(jsonb, jsonb) TO authenticated;

-- 3) Wrapper storico: la tab del rapportino continua a funzionare
CREATE OR REPLACE FUNCTION public.save_rapportino_bolla(_rapportino_id uuid, _bolla jsonb, _righe jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF jsonb_typeof(_righe) <> 'array' OR jsonb_array_length(_righe) = 0 THEN
    RAISE EXCEPTION 'Inserisci almeno una riga materiale';
  END IF;
  RETURN public.save_bolla(
    jsonb_set(COALESCE(_bolla,'{}'::jsonb), '{rapportino_id}', to_jsonb(_rapportino_id::text), true),
    _righe);
END $function$;

-- 4) Collegamento successivo a un rapportino
CREATE OR REPLACE FUNCTION public.collega_bolla_rapportino(_id uuid, _rapportino_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE b public.rapportini_bolle; r public.rapportini; cant uuid;
BEGIN
  SELECT * INTO b FROM public.rapportini_bolle WHERE id = _id AND organization_id = public.current_organization_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Bolla non trovata'; END IF;
  IF b.stato = 'annullata' THEN RAISE EXCEPTION 'Bolla annullata: non collegabile'; END IF;
  IF b.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Bolla archiviata: non collegabile'; END IF;
  IF b.rapportino_id IS NOT NULL AND b.rapportino_id <> _rapportino_id THEN
    RAISE EXCEPTION 'Bolla già collegata a un altro rapportino';
  END IF;
  r := public._rap_bolla_guard(_rapportino_id);
  IF b.commessa_id IS NOT NULL AND b.commessa_id <> r.commessa_id THEN
    RAISE EXCEPTION 'Rapportino non coerente con la commessa della bolla';
  END IF;
  cant := b.cantiere_id;
  IF cant IS NOT NULL THEN
    PERFORM 1 FROM public.cantieri WHERE id = cant AND commessa_id = r.commessa_id;
    IF NOT FOUND THEN cant := r.cantiere_id; END IF;
  ELSE
    cant := r.cantiere_id;
  END IF;

  UPDATE public.rapportini_bolle
     SET rapportino_id = r.id, commessa_id = r.commessa_id, cantiere_id = cant, updated_by = auth.uid()
   WHERE id = _id;

  UPDATE public.materiali_prezzi_fornitori SET commessa_id = r.commessa_id WHERE bolla_id = _id;

  IF b.documento_id IS NOT NULL THEN
    UPDATE public.documenti
       SET rapportino_id = r.id, commessa_id = r.commessa_id, cantiere_id = COALESCE(cantiere_id, cant), updated_by = auth.uid()
     WHERE id = b.documento_id AND organization_id = b.organization_id;
  END IF;

  PERFORM public._log_audit(b.organization_id, 'collega_bolla_rapportino', 'rapportini_bolle', _id,
    jsonb_build_object('rapportino_id', r.id));
  RETURN _id;
END $function$;

REVOKE ALL ON FUNCTION public.collega_bolla_rapportino(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.collega_bolla_rapportino(uuid, uuid) TO authenticated;

-- 5) Archiviazione / ripristino
CREATE OR REPLACE FUNCTION public.archive_bolla(_id uuid, _archive boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE org uuid;
BEGIN
  org := public.current_organization_id();
  IF NOT public.can_edit_rapportino_extra(org) THEN
    RAISE EXCEPTION 'Permessi insufficienti';
  END IF;
  UPDATE public.rapportini_bolle
     SET archived_at = CASE WHEN _archive THEN now() ELSE NULL END,
         archived_by = CASE WHEN _archive THEN auth.uid() ELSE NULL END,
         updated_by = auth.uid()
   WHERE id = _id AND organization_id = org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bolla non trovata'; END IF;
  PERFORM public._log_audit(org, CASE WHEN _archive THEN 'archivia_bolla' ELSE 'ripristina_bolla' END,
    'rapportini_bolle', _id, '{}'::jsonb);
  RETURN _id;
END $function$;

REVOKE ALL ON FUNCTION public.archive_bolla(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.archive_bolla(uuid, boolean) TO authenticated;

-- 6) Elenco bolle (archivio documentale)
CREATE OR REPLACE FUNCTION public.list_bolle(_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org uuid; econ boolean; items jsonb; tot int;
  _q text; _forn uuid; _com uuid; _coll text; _stato text; _arch boolean; _page int; _size int;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata'; END IF;
  econ := public.can_see_econ(org);
  _q := NULLIF(btrim(COALESCE(_filters->>'q','')),'');
  _forn := NULLIF(_filters->>'fornitore_id','')::uuid;
  _com := NULLIF(_filters->>'commessa_id','')::uuid;
  _coll := NULLIF(_filters->>'collegamento','');
  _stato := NULLIF(_filters->>'stato','');
  _arch := COALESCE((_filters->>'includeArchived')::boolean, false);
  _page := GREATEST(1, COALESCE((_filters->>'page')::int, 1));
  _size := LEAST(100, GREATEST(1, COALESCE((_filters->>'pageSize')::int, 25)));

  CREATE TEMP TABLE IF NOT EXISTS _tmp_noop(x int);

  WITH base AS (
    SELECT bo.*
    FROM public.rapportini_bolle bo
    LEFT JOIN public.fornitori f ON f.id = bo.fornitore_id
    WHERE bo.organization_id = org
      AND (_arch OR bo.archived_at IS NULL)
      AND (_forn IS NULL OR bo.fornitore_id = _forn)
      AND (_com IS NULL OR bo.commessa_id = _com)
      AND (_stato IS NULL OR bo.stato = _stato)
      AND (_coll IS NULL
           OR (_coll = 'collegata' AND bo.rapportino_id IS NOT NULL)
           OR (_coll = 'non_collegata' AND bo.rapportino_id IS NULL))
      AND (_q IS NULL OR bo.numero_bolla ILIKE '%'||_q||'%' OR f.ragione_sociale ILIKE '%'||_q||'%')
      AND (bo.commessa_id IS NULL OR public.can_access_commessa(bo.commessa_id))
  )
  SELECT count(*)::int INTO tot FROM base;

  WITH base AS (
    SELECT bo.*
    FROM public.rapportini_bolle bo
    LEFT JOIN public.fornitori f ON f.id = bo.fornitore_id
    WHERE bo.organization_id = org
      AND (_arch OR bo.archived_at IS NULL)
      AND (_forn IS NULL OR bo.fornitore_id = _forn)
      AND (_com IS NULL OR bo.commessa_id = _com)
      AND (_stato IS NULL OR bo.stato = _stato)
      AND (_coll IS NULL
           OR (_coll = 'collegata' AND bo.rapportino_id IS NOT NULL)
           OR (_coll = 'non_collegata' AND bo.rapportino_id IS NULL))
      AND (_q IS NULL OR bo.numero_bolla ILIKE '%'||_q||'%' OR f.ragione_sociale ILIKE '%'||_q||'%')
      AND (bo.commessa_id IS NULL OR public.can_access_commessa(bo.commessa_id))
    ORDER BY bo.data_bolla DESC, bo.created_at DESC
    LIMIT _size OFFSET (_page - 1) * _size
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'numero_bolla', b.numero_bolla,
    'data_bolla', b.data_bolla,
    'data_consegna', b.data_consegna,
    'stato', b.stato,
    'archived_at', b.archived_at,
    'note', b.note,
    'fornitore_id', b.fornitore_id,
    'fornitore_nome', f.ragione_sociale,
    'commessa_id', b.commessa_id,
    'commessa_codice', c.codice,
    'commessa_titolo', c.titolo,
    'cantiere_id', b.cantiere_id,
    'cantiere_nome', k.nome,
    'rapportino_id', b.rapportino_id,
    'rapportino_data', rp.data,
    'documento_id', b.documento_id,
    'righe_count', (SELECT count(*) FROM public.rapportini_bolle_righe ri WHERE ri.bolla_id = b.id),
    'imponibile', CASE WHEN econ THEN b.imponibile END,
    'iva', CASE WHEN econ THEN b.iva END,
    'totale', CASE WHEN econ THEN b.totale END
  ) ORDER BY b.data_bolla DESC, b.created_at DESC), '[]'::jsonb) INTO items
  FROM base b
  LEFT JOIN public.fornitori f ON f.id = b.fornitore_id
  LEFT JOIN public.commesse c ON c.id = b.commessa_id
  LEFT JOIN public.cantieri k ON k.id = b.cantiere_id
  LEFT JOIN public.rapportini rp ON rp.id = b.rapportino_id;

  RETURN jsonb_build_object(
    'items', items,
    'total', tot,
    'capabilities', jsonb_build_object(
      'canManage', public.can_edit_rapportino_extra(org),
      'canSeeEcon', econ
    )
  );
END $function$;

REVOKE ALL ON FUNCTION public.list_bolle(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_bolle(jsonb) TO authenticated;

-- 7) Dettaglio bolla singola
CREATE OR REPLACE FUNCTION public.get_bolla(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE org uuid; econ boolean; out jsonb;
BEGIN
  org := public.current_organization_id();
  econ := public.can_see_econ(org);
  SELECT jsonb_build_object(
    'id', b.id,
    'numero_bolla', b.numero_bolla,
    'data_bolla', b.data_bolla,
    'data_consegna', b.data_consegna,
    'stato', b.stato,
    'archived_at', b.archived_at,
    'note', b.note,
    'fornitore_id', b.fornitore_id,
    'fornitore_nome', f.ragione_sociale,
    'commessa_id', b.commessa_id,
    'cantiere_id', b.cantiere_id,
    'rapportino_id', b.rapportino_id,
    'documento_id', b.documento_id,
    'imponibile', CASE WHEN econ THEN b.imponibile END,
    'iva', CASE WHEN econ THEN b.iva END,
    'totale', CASE WHEN econ THEN b.totale END,
    'righe', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ri.id, 'materiale_id', ri.materiale_id, 'descrizione', ri.descrizione,
        'codice_articolo', ri.codice_articolo, 'quantita', ri.quantita,
        'unita_misura', ri.unita_misura, 'sconto_pct', ri.sconto_pct, 'iva_pct', ri.iva_pct,
        'note', ri.note, 'posizione', ri.posizione,
        'prezzo_unitario', CASE WHEN econ THEN ri.prezzo_unitario END,
        'totale_riga', CASE WHEN econ THEN ri.totale_riga END
      ) ORDER BY ri.posizione), '[]'::jsonb)
      FROM public.rapportini_bolle_righe ri WHERE ri.bolla_id = b.id
    )
  ) INTO out
  FROM public.rapportini_bolle b
  LEFT JOIN public.fornitori f ON f.id = b.fornitore_id
  WHERE b.id = _id AND b.organization_id = org;
  IF out IS NULL THEN RAISE EXCEPTION 'Bolla non trovata'; END IF;
  IF (out->>'commessa_id') IS NOT NULL AND NOT public.can_access_commessa((out->>'commessa_id')::uuid) THEN
    RAISE EXCEPTION 'Accesso negato alla commessa';
  END IF;
  RETURN out;
END $function$;

REVOKE ALL ON FUNCTION public.get_bolla(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_bolla(uuid) TO authenticated;

-- 8) Possibili duplicati
CREATE OR REPLACE FUNCTION public.check_bolla_duplicati(_fornitore_id uuid, _numero text, _data date, _exclude uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE org uuid; out jsonb;
BEGIN
  org := public.current_organization_id();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id, 'numero_bolla', b.numero_bolla, 'data_bolla', b.data_bolla,
    'fornitore_nome', f.ragione_sociale, 'rapportino_id', b.rapportino_id,
    'archived_at', b.archived_at, 'stato', b.stato
  )), '[]'::jsonb) INTO out
  FROM public.rapportini_bolle b
  LEFT JOIN public.fornitori f ON f.id = b.fornitore_id
  WHERE b.organization_id = org
    AND b.fornitore_id = _fornitore_id
    AND lower(btrim(b.numero_bolla)) = lower(btrim(COALESCE(_numero,'')))
    AND (_exclude IS NULL OR b.id <> _exclude)
    AND b.stato <> 'annullata';
  RETURN out;
END $function$;

REVOKE ALL ON FUNCTION public.check_bolla_duplicati(uuid, text, date, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_bolla_duplicati(uuid, text, date, uuid) TO authenticated;

-- 9) Annullamento: supporta anche bolle senza rapportino
CREATE OR REPLACE FUNCTION public.annulla_rapportino_bolla(_id uuid, _motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE b public.rapportini_bolle;
BEGIN
  SELECT * INTO b FROM public.rapportini_bolle WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bolla non trovata'; END IF;
  IF b.organization_id <> public.current_organization_id() THEN
    RAISE EXCEPTION 'Accesso negato alla bolla';
  END IF;
  IF b.rapportino_id IS NOT NULL THEN
    PERFORM public._rap_extra_guard(b.rapportino_id, true);
  ELSIF NOT public.can_edit_rapportino_extra(b.organization_id) THEN
    RAISE EXCEPTION 'Permessi insufficienti';
  END IF;
  UPDATE public.rapportini_bolle SET stato = 'annullata', updated_by = auth.uid() WHERE id = _id;
  DELETE FROM public.materiali_prezzi_fornitori WHERE bolla_id = _id;
  PERFORM public._log_audit(b.organization_id, 'annulla_bolla', 'rapportini_bolle', _id,
    jsonb_build_object('motivo', _motivo));
  RETURN _id;
END $function$;
