CREATE OR REPLACE FUNCTION public._rap_bolla_guard(_rapportino_id uuid)
RETURNS public.rapportini
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.rapportini;
BEGIN
  SELECT * INTO r FROM public.rapportini WHERE id = _rapportino_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rapportino non trovato'; END IF;
  IF r.organization_id <> public.current_organization_id() THEN
    RAISE EXCEPTION 'Accesso negato al rapportino';
  END IF;
  IF NOT public.can_access_commessa(r.commessa_id) THEN
    RAISE EXCEPTION 'Accesso negato alla commessa';
  END IF;
  IF NOT public.can_edit_rapportino_extra(r.organization_id) THEN
    RAISE EXCEPTION 'Permessi insufficienti per registrare bolle';
  END IF;
  IF r.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Rapportino archiviato: non modificabile'; END IF;
  IF r.stato = 'annullato' THEN
    RAISE EXCEPTION 'Rapportino annullato: non modificabile';
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.save_rapportino_bolla(_rapportino_id uuid, _bolla jsonb, _righe jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.rapportini; bid uuid; fid uuid; cant uuid; econ boolean;
  el jsonb; pos int := 0; tot numeric(14,2) := 0; ivatot numeric(14,2) := 0;
  q numeric; pu numeric; sc numeric; ivp numeric; tr numeric; rid uuid; mid uuid;
BEGIN
  r := public._rap_bolla_guard(_rapportino_id);
  econ := public.can_see_econ(r.organization_id);
  fid := NULLIF(_bolla->>'fornitore_id','')::uuid;
  IF fid IS NULL THEN RAISE EXCEPTION 'Fornitore obbligatorio'; END IF;
  PERFORM 1 FROM public.fornitori WHERE id = fid AND organization_id = r.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fornitore non valido'; END IF;
  IF COALESCE(btrim(_bolla->>'numero_bolla'),'') = '' THEN RAISE EXCEPTION 'Numero bolla obbligatorio'; END IF;
  IF jsonb_typeof(_righe) <> 'array' OR jsonb_array_length(_righe) = 0 THEN
    RAISE EXCEPTION 'Inserisci almeno una riga materiale';
  END IF;

  cant := COALESCE(NULLIF(_bolla->>'cantiere_id','')::uuid, r.cantiere_id);
  IF cant IS NOT NULL THEN
    PERFORM 1 FROM public.cantieri WHERE id = cant AND organization_id = r.organization_id AND commessa_id = r.commessa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cantiere non coerente con la commessa'; END IF;
  END IF;

  bid := NULLIF(_bolla->>'id','')::uuid;
  IF bid IS NULL THEN
    INSERT INTO public.rapportini_bolle (
      organization_id, rapportino_id, commessa_id, cantiere_id, fornitore_id,
      numero_bolla, data_bolla, data_consegna, note, stato, documento_id, created_by, updated_by
    ) VALUES (
      r.organization_id, r.id, r.commessa_id, cant, fid,
      btrim(_bolla->>'numero_bolla'),
      COALESCE(NULLIF(_bolla->>'data_bolla','')::date, r.data),
      NULLIF(_bolla->>'data_consegna','')::date,
      NULLIF(_bolla->>'note',''),
      COALESCE(NULLIF(_bolla->>'stato',''),'registrata'),
      NULLIF(_bolla->>'documento_id','')::uuid,
      auth.uid(), auth.uid()
    ) RETURNING id INTO bid;
  ELSE
    UPDATE public.rapportini_bolle SET
      fornitore_id = fid,
      cantiere_id = cant,
      numero_bolla = btrim(_bolla->>'numero_bolla'),
      data_bolla = COALESCE(NULLIF(_bolla->>'data_bolla','')::date, data_bolla),
      data_consegna = NULLIF(_bolla->>'data_consegna','')::date,
      note = NULLIF(_bolla->>'note',''),
      stato = COALESCE(NULLIF(_bolla->>'stato',''), stato),
      documento_id = COALESCE(NULLIF(_bolla->>'documento_id','')::uuid, documento_id),
      updated_by = auth.uid()
    WHERE id = bid AND organization_id = r.organization_id AND rapportino_id = r.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bolla non trovata'; END IF;
    IF (SELECT stato FROM public.rapportini_bolle WHERE id = bid) = 'annullata' THEN
      RAISE EXCEPTION 'Bolla annullata: non modificabile';
    END IF;
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
      PERFORM 1 FROM public.materiali WHERE id = mid AND organization_id = r.organization_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Materiale non valido alla riga %', pos; END IF;
    END IF;

    INSERT INTO public.rapportini_bolle_righe (
      organization_id, bolla_id, materiale_id, descrizione, codice_articolo,
      quantita, unita_misura, prezzo_unitario, sconto_pct, totale_riga, iva_pct, note, posizione
    ) VALUES (
      r.organization_id, bid, mid, btrim(el->>'descrizione'), NULLIF(el->>'codice_articolo',''),
      q, NULLIF(el->>'unita_misura',''), pu, sc, tr, ivp, NULLIF(el->>'note',''), pos
    ) RETURNING id INTO rid;

    IF tr IS NOT NULL THEN
      tot := tot + tr;
      IF ivp IS NOT NULL THEN ivatot := ivatot + round(tr * ivp/100.0, 2); END IF;
      INSERT INTO public.materiali_prezzi_fornitori (
        organization_id, materiale_id, descrizione, fornitore_id, data_prezzo,
        prezzo_unitario, unita_misura, quantita_riferimento, bolla_riga_id, bolla_id, commessa_id
      ) VALUES (
        r.organization_id, mid, btrim(el->>'descrizione'), fid,
        COALESCE(NULLIF(_bolla->>'data_bolla','')::date, r.data),
        pu, NULLIF(el->>'unita_misura',''), q, rid, bid, r.commessa_id
      );
    END IF;
  END LOOP;

  UPDATE public.rapportini_bolle
    SET imponibile = CASE WHEN tot = 0 THEN NULL ELSE tot END,
        iva = CASE WHEN ivatot = 0 THEN NULL ELSE ivatot END,
        totale = CASE WHEN tot = 0 THEN NULL ELSE tot + ivatot END
  WHERE id = bid;

  PERFORM public._log_audit(r.organization_id, 'save_bolla', 'rapportini_bolle', bid,
    jsonb_build_object('rapportino_id', r.id, 'righe', pos));
  RETURN bid;
END $function$;