-- Guard: rapportino accessibile + modificabile
CREATE OR REPLACE FUNCTION public._rap_extra_guard(_rapportino_id uuid, _write boolean)
RETURNS public.rapportini LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  IF _write THEN
    IF NOT public.can_edit_rapportino_extra(r.organization_id) THEN
      RAISE EXCEPTION 'Permessi insufficienti per modificare il rapportino';
    END IF;
    IF r.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Rapportino archiviato: non modificabile'; END IF;
    IF r.stato IN ('approvato','annullato') AND NOT public.has_any_role(r.organization_id, ARRAY['proprietario','amministratore']::app_role[]) THEN
      RAISE EXCEPTION 'Rapportino % : non modificabile', r.stato;
    END IF;
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public._rap_extra_guard(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._rap_extra_guard(uuid, boolean) TO authenticated, service_role;

-- ============================ BOLLE: lettura =================================
CREATE OR REPLACE FUNCTION public.get_rapportino_bolle(_rapportino_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rapportini; econ boolean; out jsonb;
BEGIN
  r := public._rap_extra_guard(_rapportino_id, false);
  econ := public.can_see_econ(r.organization_id);
  SELECT COALESCE(jsonb_agg(b ORDER BY b->>'data_bolla' DESC), '[]'::jsonb) INTO out
  FROM (
    SELECT jsonb_build_object(
      'id', bo.id,
      'numero_bolla', bo.numero_bolla,
      'data_bolla', bo.data_bolla,
      'data_consegna', bo.data_consegna,
      'fornitore_id', bo.fornitore_id,
      'fornitore_nome', f.ragione_sociale,
      'cantiere_id', bo.cantiere_id,
      'note', bo.note,
      'stato', bo.stato,
      'documento_id', bo.documento_id,
      'imponibile', CASE WHEN econ THEN bo.imponibile END,
      'iva', CASE WHEN econ THEN bo.iva END,
      'totale', CASE WHEN econ THEN bo.totale END,
      'updated_at', bo.updated_at,
      'righe', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', ri.id,
          'materiale_id', ri.materiale_id,
          'descrizione', ri.descrizione,
          'codice_articolo', ri.codice_articolo,
          'quantita', ri.quantita,
          'unita_misura', ri.unita_misura,
          'sconto_pct', ri.sconto_pct,
          'iva_pct', ri.iva_pct,
          'note', ri.note,
          'posizione', ri.posizione,
          'prezzo_unitario', CASE WHEN econ THEN ri.prezzo_unitario END,
          'totale_riga', CASE WHEN econ THEN ri.totale_riga END
        ) ORDER BY ri.posizione), '[]'::jsonb)
        FROM public.rapportini_bolle_righe ri WHERE ri.bolla_id = bo.id
      )
    ) AS b
    FROM public.rapportini_bolle bo
    LEFT JOIN public.fornitori f ON f.id = bo.fornitore_id
    WHERE bo.rapportino_id = _rapportino_id
  ) s;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.get_rapportino_bolle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rapportino_bolle(uuid) TO authenticated, service_role;

-- ============================ BOLLE: salvataggio =============================
CREATE OR REPLACE FUNCTION public.save_rapportino_bolla(
  _rapportino_id uuid, _bolla jsonb, _righe jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.rapportini; bid uuid; fid uuid; cant uuid; econ boolean;
  el jsonb; pos int := 0; tot numeric(14,2) := 0; ivatot numeric(14,2) := 0;
  q numeric; pu numeric; sc numeric; ivp numeric; tr numeric; rid uuid; mid uuid;
BEGIN
  r := public._rap_extra_guard(_rapportino_id, true);
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
END $$;
REVOKE ALL ON FUNCTION public.save_rapportino_bolla(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_rapportino_bolla(uuid, jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.annulla_rapportino_bolla(_id uuid, _motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.rapportini_bolle;
BEGIN
  SELECT * INTO b FROM public.rapportini_bolle WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bolla non trovata'; END IF;
  PERFORM public._rap_extra_guard(b.rapportino_id, true);
  UPDATE public.rapportini_bolle SET stato = 'annullata', note = COALESCE(note,'') , updated_by = auth.uid() WHERE id = _id;
  PERFORM public._log_audit(b.organization_id, 'annulla_bolla', 'rapportini_bolle', _id,
    jsonb_build_object('motivo', _motivo));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.annulla_rapportino_bolla(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annulla_rapportino_bolla(uuid, text) TO authenticated, service_role;

-- ========================= SUBAPPALTATORI ====================================
CREATE OR REPLACE FUNCTION public.get_rapportino_subappalti(_rapportino_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rapportini; econ boolean; out jsonb;
BEGIN
  r := public._rap_extra_guard(_rapportino_id, false);
  econ := public.can_see_econ(r.organization_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'subappaltatore_id', s.subappaltatore_id,
    'subappaltatore_nome', f.ragione_sociale,
    'contratto_id', s.contratto_id,
    'cantiere_id', s.cantiere_id,
    'fase_id', s.fase_id,
    'lavorazione', s.lavorazione,
    'descrizione', s.descrizione,
    'quantita', s.quantita,
    'unita_misura', s.unita_misura,
    'modalita_compenso', s.modalita_compenso,
    'note', s.note,
    'documento_id', s.documento_id,
    'stato_contabilizzazione', s.stato_contabilizzazione,
    'annullato_at', s.annullato_at,
    'importo_unitario', CASE WHEN econ THEN s.importo_unitario END,
    'importo_totale', CASE WHEN econ THEN s.importo_totale END,
    'importo_congelato', CASE WHEN econ THEN s.importo_congelato END,
    'iva_pct', CASE WHEN econ THEN s.iva_pct END,
    'ritenuta_pct', CASE WHEN econ THEN s.ritenuta_pct END,
    'updated_at', s.updated_at
  ) ORDER BY s.created_at), '[]'::jsonb) INTO out
  FROM public.rapportini_subappaltatori s
  LEFT JOIN public.fornitori f ON f.id = s.subappaltatore_id
  WHERE s.rapportino_id = _rapportino_id;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.get_rapportino_subappalti(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rapportino_subappalti(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_rapportino_subappalto(_rapportino_id uuid, _riga jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.rapportini; sid uuid; sub uuid; econ boolean; cant uuid; fase uuid;
  q numeric; iu numeric; itot numeric; modo text; stato text; contr uuid;
BEGIN
  r := public._rap_extra_guard(_rapportino_id, true);
  econ := public.can_see_econ(r.organization_id);
  sub := NULLIF(_riga->>'subappaltatore_id','')::uuid;
  IF sub IS NULL THEN RAISE EXCEPTION 'Subappaltatore obbligatorio'; END IF;
  PERFORM 1 FROM public.fornitori
    WHERE id = sub AND organization_id = r.organization_id
      AND tipo_soggetto IN ('subappaltatore','entrambi');
  IF NOT FOUND THEN RAISE EXCEPTION 'Ditta non valida o non classificata come subappaltatore'; END IF;
  IF COALESCE(btrim(_riga->>'lavorazione'),'') = '' THEN RAISE EXCEPTION 'Lavorazione obbligatoria'; END IF;
  modo := COALESCE(NULLIF(_riga->>'modalita_compenso',''), 'a_corpo');

  cant := COALESCE(NULLIF(_riga->>'cantiere_id','')::uuid, r.cantiere_id);
  IF cant IS NOT NULL THEN
    PERFORM 1 FROM public.cantieri WHERE id = cant AND organization_id = r.organization_id AND commessa_id = r.commessa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cantiere non coerente con la commessa'; END IF;
  END IF;
  fase := COALESCE(NULLIF(_riga->>'fase_id','')::uuid, r.fase_id);
  IF fase IS NOT NULL THEN
    PERFORM 1 FROM public.commessa_fasi WHERE id = fase AND organization_id = r.organization_id AND commessa_id = r.commessa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fase non coerente con la commessa'; END IF;
  END IF;
  contr := NULLIF(_riga->>'contratto_id','')::uuid;
  IF contr IS NOT NULL THEN
    PERFORM 1 FROM public.subappalti_contratti
      WHERE id = contr AND organization_id = r.organization_id
        AND commessa_id = r.commessa_id AND subappaltatore_id = sub;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contratto non coerente con ditta e commessa'; END IF;
  END IF;

  q := NULLIF(_riga->>'quantita','')::numeric;
  iu := CASE WHEN econ THEN NULLIF(_riga->>'importo_unitario','')::numeric END;
  itot := CASE WHEN econ THEN NULLIF(_riga->>'importo_totale','')::numeric END;
  IF itot IS NULL AND iu IS NOT NULL AND q IS NOT NULL THEN itot := round(q * iu, 2); END IF;
  stato := CASE WHEN itot IS NULL THEN 'importo_mancante' ELSE 'contabilizzato' END;

  sid := NULLIF(_riga->>'id','')::uuid;
  IF sid IS NULL THEN
    INSERT INTO public.rapportini_subappaltatori (
      organization_id, rapportino_id, commessa_id, cantiere_id, fase_id, subappaltatore_id,
      contratto_id, lavorazione, descrizione, quantita, unita_misura, modalita_compenso,
      importo_unitario, importo_totale, importo_congelato, iva_pct, ritenuta_pct, note,
      documento_id, stato_contabilizzazione, contabilizzato_at, created_by, updated_by
    ) VALUES (
      r.organization_id, r.id, r.commessa_id, cant, fase, sub,
      contr, btrim(_riga->>'lavorazione'), NULLIF(_riga->>'descrizione',''), q,
      NULLIF(_riga->>'unita_misura',''), modo,
      iu, itot, itot,
      CASE WHEN econ THEN NULLIF(_riga->>'iva_pct','')::numeric END,
      CASE WHEN econ THEN NULLIF(_riga->>'ritenuta_pct','')::numeric END,
      NULLIF(_riga->>'note',''), NULLIF(_riga->>'documento_id','')::uuid,
      stato, CASE WHEN itot IS NOT NULL THEN now() END, auth.uid(), auth.uid()
    ) RETURNING id INTO sid;
  ELSE
    UPDATE public.rapportini_subappaltatori SET
      subappaltatore_id = sub, contratto_id = contr, cantiere_id = cant, fase_id = fase,
      lavorazione = btrim(_riga->>'lavorazione'),
      descrizione = NULLIF(_riga->>'descrizione',''),
      quantita = q, unita_misura = NULLIF(_riga->>'unita_misura',''),
      modalita_compenso = modo, note = NULLIF(_riga->>'note',''),
      documento_id = COALESCE(NULLIF(_riga->>'documento_id','')::uuid, documento_id),
      importo_unitario = CASE WHEN econ THEN iu ELSE importo_unitario END,
      importo_totale   = CASE WHEN econ THEN itot ELSE importo_totale END,
      importo_congelato = CASE WHEN econ AND itot IS NOT NULL THEN itot ELSE importo_congelato END,
      iva_pct = CASE WHEN econ THEN NULLIF(_riga->>'iva_pct','')::numeric ELSE iva_pct END,
      ritenuta_pct = CASE WHEN econ THEN NULLIF(_riga->>'ritenuta_pct','')::numeric ELSE ritenuta_pct END,
      stato_contabilizzazione = CASE WHEN econ THEN stato ELSE stato_contabilizzazione END,
      contabilizzato_at = CASE WHEN econ AND itot IS NOT NULL THEN now() ELSE contabilizzato_at END,
      updated_by = auth.uid()
    WHERE id = sid AND organization_id = r.organization_id AND rapportino_id = r.id AND annullato_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Riga subappalto non trovata o annullata'; END IF;
  END IF;

  PERFORM public._log_audit(r.organization_id, 'save_subappalto', 'rapportini_subappaltatori', sid,
    jsonb_build_object('rapportino_id', r.id));
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.save_rapportino_subappalto(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_rapportino_subappalto(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.annulla_rapportino_subappalto(_id uuid, _motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.rapportini_subappaltatori;
BEGIN
  SELECT * INTO s FROM public.rapportini_subappaltatori WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Riga subappalto non trovata'; END IF;
  PERFORM public._rap_extra_guard(s.rapportino_id, true);
  UPDATE public.rapportini_subappaltatori
     SET annullato_at = now(), stato_contabilizzazione = 'annullato', updated_by = auth.uid()
   WHERE id = _id;
  PERFORM public._log_audit(s.organization_id, 'annulla_subappalto', 'rapportini_subappaltatori', _id,
    jsonb_build_object('motivo', _motivo));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.annulla_rapportino_subappalto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annulla_rapportino_subappalto(uuid, text) TO authenticated, service_role;

-- ========================= RIEPILOGHI ECONOMICI ==============================
CREATE OR REPLACE FUNCTION public.get_rapportino_costi_riepilogo(_rapportino_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rapportini; econ boolean; mo numeric := 0; ma numeric := 0; su numeric := 0;
BEGIN
  r := public._rap_extra_guard(_rapportino_id, false);
  econ := public.can_see_econ(r.organization_id);
  IF NOT econ THEN RETURN jsonb_build_object('visibile', false); END IF;
  SELECT COALESCE(SUM(costo_totale),0) INTO mo FROM public.rapportini_costi
    WHERE rapportino_id = _rapportino_id AND stato <> 'stornato';
  SELECT COALESCE(SUM(b.imponibile),0) INTO ma FROM public.rapportini_bolle b
    WHERE b.rapportino_id = _rapportino_id AND b.stato <> 'annullata';
  SELECT COALESCE(SUM(s.importo_congelato),0) INTO su FROM public.rapportini_subappaltatori s
    WHERE s.rapportino_id = _rapportino_id AND s.annullato_at IS NULL;
  RETURN jsonb_build_object(
    'visibile', true, 'manodopera', mo, 'materiali', ma, 'subappalti', su,
    'totale', round(mo + ma + su, 2));
END $$;
REVOKE ALL ON FUNCTION public.get_rapportino_costi_riepilogo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rapportino_costi_riepilogo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_commessa_costi_extra(_commessa_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; ma numeric := 0; su numeric := 0;
BEGIN
  SELECT organization_id INTO org FROM public.commesse WHERE id = _commessa_id;
  IF org IS NULL OR org <> public.current_organization_id() THEN RAISE EXCEPTION 'Commessa non trovata'; END IF;
  IF NOT public.can_access_commessa(_commessa_id) THEN RAISE EXCEPTION 'Accesso negato alla commessa'; END IF;
  IF NOT public.can_see_econ(org) THEN RETURN jsonb_build_object('visibile', false); END IF;
  SELECT COALESCE(SUM(imponibile),0) INTO ma FROM public.rapportini_bolle
    WHERE commessa_id = _commessa_id AND stato <> 'annullata';
  SELECT COALESCE(SUM(importo_congelato),0) INTO su FROM public.rapportini_subappaltatori
    WHERE commessa_id = _commessa_id AND annullato_at IS NULL;
  RETURN jsonb_build_object('visibile', true, 'materiali', ma, 'subappalti', su,
    'totale', round(ma + su, 2));
END $$;
REVOKE ALL ON FUNCTION public.get_commessa_costi_extra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commessa_costi_extra(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_materiali_prezzi(
  _materiale_id uuid, _fornitore_id uuid, _from date, _to date, _q text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; out jsonb;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata'; END IF;
  IF NOT public.can_see_econ(org) THEN RAISE EXCEPTION 'Permessi insufficienti per i prezzi'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'data_prezzo', p.data_prezzo, 'prezzo_unitario', p.prezzo_unitario,
    'unita_misura', p.unita_misura, 'quantita_riferimento', p.quantita_riferimento,
    'materiale_id', p.materiale_id, 'materiale_nome', m.nome, 'descrizione', p.descrizione,
    'fornitore_id', p.fornitore_id, 'fornitore_nome', f.ragione_sociale,
    'commessa_id', p.commessa_id, 'bolla_id', p.bolla_id
  ) ORDER BY p.data_prezzo DESC), '[]'::jsonb) INTO out
  FROM public.materiali_prezzi_fornitori p
  LEFT JOIN public.materiali m ON m.id = p.materiale_id
  LEFT JOIN public.fornitori f ON f.id = p.fornitore_id
  WHERE p.organization_id = org
    AND (_materiale_id IS NULL OR p.materiale_id = _materiale_id)
    AND (_fornitore_id IS NULL OR p.fornitore_id = _fornitore_id)
    AND (_from IS NULL OR p.data_prezzo >= _from)
    AND (_to IS NULL OR p.data_prezzo <= _to)
    AND (_q IS NULL OR btrim(_q) = '' OR p.descrizione ILIKE '%'||btrim(_q)||'%' OR m.nome ILIKE '%'||btrim(_q)||'%');
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.get_materiali_prezzi(uuid, uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_materiali_prezzi(uuid, uuid, date, date, text) TO authenticated, service_role;
