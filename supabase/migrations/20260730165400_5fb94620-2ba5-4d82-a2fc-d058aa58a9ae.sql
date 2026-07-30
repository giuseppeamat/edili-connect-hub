CREATE OR REPLACE FUNCTION public.create_commessa_fase(_commessa_id uuid, _titolo text, _descrizione text DEFAULT NULL::text, _cantiere_id uuid DEFAULT NULL::uuid, _responsabile_id uuid DEFAULT NULL::uuid, _peso_percentuale numeric DEFAULT 0, _data_inizio_prevista date DEFAULT NULL::date, _data_fine_prevista date DEFAULT NULL::date, _note text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.commesse;
  _uid uuid := auth.uid();
  _cant_commessa uuid;
  _next_pos int;
  _new_id uuid;
  _new_upd timestamptz;
BEGIN
  IF _titolo IS NULL OR length(trim(_titolo)) = 0 THEN
    RAISE EXCEPTION 'Titolo obbligatorio' USING ERRCODE='22023';
  END IF;
  IF _peso_percentuale IS NULL OR _peso_percentuale < 0 OR _peso_percentuale > 100 THEN
    RAISE EXCEPTION 'Peso fuori range (0-100)' USING ERRCODE='22023';
  END IF;
  IF _data_inizio_prevista IS NOT NULL AND _data_fine_prevista IS NOT NULL
     AND _data_fine_prevista < _data_inizio_prevista THEN
    RAISE EXCEPTION 'La data di fine prevista non può essere antecedente alla data di inizio prevista' USING ERRCODE='22023';
  END IF;

  c := public._assert_commessa_fase_editabile(_commessa_id);

  IF _cantiere_id IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE cantieri.id = _cantiere_id;
    IF _cant_commessa IS DISTINCT FROM _commessa_id THEN
      RAISE EXCEPTION 'Il cantiere selezionato non appartiene alla commessa' USING ERRCODE='22023';
    END IF;
  END IF;

  IF _responsabile_id IS NOT NULL THEN
    IF NOT public.is_valid_responsabile_fase(_responsabile_id, c.organization_id, _commessa_id, _cantiere_id) THEN
      RAISE EXCEPTION 'Responsabile fase non valido' USING ERRCODE='22023';
    END IF;
  END IF;

  SELECT COALESCE(MAX(posizione), -1) + 1 INTO _next_pos
  FROM public.commessa_fasi
  WHERE commessa_id = _commessa_id AND organization_id = c.organization_id;

  INSERT INTO public.commessa_fasi(
    organization_id, commessa_id, cantiere_id, titolo, descrizione,
    posizione, stato, peso_percentuale, avanzamento_percentuale,
    data_inizio_prevista, data_fine_prevista,
    responsabile_id, note, created_by
  ) VALUES (
    c.organization_id, _commessa_id, _cantiere_id, trim(_titolo), _descrizione,
    _next_pos, 'non_iniziata', _peso_percentuale, 0,
    _data_inizio_prevista, _data_fine_prevista,
    _responsabile_id, _note, _uid
  ) RETURNING commessa_fasi.id, commessa_fasi.updated_at INTO _new_id, _new_upd;

  PERFORM public._log_audit(c.organization_id, 'fase.created', 'commessa_fasi', _new_id,
    jsonb_build_object('commessa_id', _commessa_id, 'titolo', _titolo));

  PERFORM public.recalculate_commessa_avanzamento(_commessa_id);
  RETURN QUERY SELECT _new_id, _new_upd;
END $function$;

CREATE OR REPLACE FUNCTION public._assert_commessa_budget_mutabile(_commessa_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_org uuid; v_my_org uuid; v_active boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessione scaduta: effettua nuovamente l''accesso.' USING ERRCODE='42501';
  END IF;
  SELECT organization_id, is_active INTO v_my_org, v_active FROM public.profiles WHERE profiles.id = v_uid;
  IF v_my_org IS NULL OR COALESCE(v_active,false) = false THEN
    RAISE EXCEPTION 'Non sei autorizzato a modificare il Budget.' USING ERRCODE='42501';
  END IF;
  SELECT organization_id INTO v_org FROM public.commesse WHERE commesse.id = _commessa_id;
  IF v_org IS NULL OR v_org <> v_my_org THEN
    RAISE EXCEPTION 'Elemento non trovato.' USING ERRCODE='P0002';
  END IF;
  IF public.is_commessa_budget_locked(_commessa_id) THEN
    RAISE EXCEPTION 'La commessa non è modificabile nello stato attuale.' USING ERRCODE='42501';
  END IF;
  IF NOT public.can_manage_commessa_budget(_commessa_id, 'mutate') THEN
    RAISE EXCEPTION 'Non sei autorizzato a modificare il Budget.' USING ERRCODE='42501';
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public._assert_commessa_budget_mutabile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_commessa_budget_mutabile(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_commessa_budget_voce(_commessa_id uuid, _expected_updated_at timestamp with time zone, _tipo text, _categoria text, _descrizione text, _sottocategoria text DEFAULT NULL::text, _codice text DEFAULT NULL::text, _unita text DEFAULT NULL::text, _quantita numeric DEFAULT NULL::numeric, _prezzo_unitario numeric DEFAULT NULL::numeric, _importo_previsto numeric DEFAULT NULL::numeric, _importo_impegnato numeric DEFAULT 0, _importo_sostenuto numeric DEFAULT 0, _costo_residuo numeric DEFAULT 0, _cantiere_id uuid DEFAULT NULL::uuid, _fase_id uuid DEFAULT NULL::uuid, _fornitore_id uuid DEFAULT NULL::uuid, _note text DEFAULT NULL::text)
 RETURNS commessa_budget_voci
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_mod TEXT; v_pos INT; v_imp NUMERIC; v_row public.commessa_budget_voci;
BEGIN
  PERFORM public._assert_commessa_budget_mutabile(_commessa_id);
  SELECT organization_id, updated_at, budget_modalita INTO v_org, v_upd, v_mod
    FROM public.commesse WHERE id = _commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  IF v_mod <> 'analitico' THEN RAISE EXCEPTION 'Passa alla modalità analitica per gestire le voci di Budget.' USING ERRCODE='P0001'; END IF;

  IF _quantita IS NOT NULL AND _prezzo_unitario IS NOT NULL THEN
    v_imp := ROUND(_quantita * _prezzo_unitario, 2);
  ELSE
    v_imp := COALESCE(_importo_previsto, 0);
  END IF;
  IF v_imp < 0 THEN RAISE EXCEPTION 'Importo previsto negativo'; END IF;

  SELECT COALESCE(MAX(posizione),0)+1 INTO v_pos FROM public.commessa_budget_voci
    WHERE commessa_id=_commessa_id AND archived_at IS NULL;

  INSERT INTO public.commessa_budget_voci(
    organization_id, commessa_id, cantiere_id, fase_id, fornitore_id,
    tipo, categoria, sottocategoria, codice, descrizione, unita_misura,
    quantita, prezzo_unitario, importo_previsto,
    importo_impegnato, importo_sostenuto, costo_residuo_stimato,
    fonte, note, posizione, created_by
  ) VALUES (
    v_org, _commessa_id, _cantiere_id, _fase_id, _fornitore_id,
    _tipo, _categoria, _sottocategoria, _codice, _descrizione, _unita,
    _quantita, _prezzo_unitario, v_imp,
    COALESCE(_importo_impegnato,0),
    CASE WHEN _tipo='ricavo' THEN 0 ELSE COALESCE(_importo_sostenuto,0) END,
    CASE WHEN _tipo='ricavo' THEN 0 ELSE COALESCE(_costo_residuo,0) END,
    'manuale', _note, v_pos, auth.uid()
  ) RETURNING * INTO v_row;

  PERFORM public.recalculate_commessa_budget(_commessa_id);
  PERFORM public._cbv_audit(v_org, _commessa_id, 'commessa.budget_voce_created',
    jsonb_build_object('voce_id',v_row.id,'tipo',_tipo,'categoria',_categoria));
  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.update_commessa_budget_voce(_voce_id uuid, _expected_updated_at timestamp with time zone, _categoria text, _descrizione text, _sottocategoria text DEFAULT NULL::text, _codice text DEFAULT NULL::text, _unita text DEFAULT NULL::text, _quantita numeric DEFAULT NULL::numeric, _prezzo_unitario numeric DEFAULT NULL::numeric, _importo_previsto numeric DEFAULT NULL::numeric, _importo_impegnato numeric DEFAULT NULL::numeric, _importo_sostenuto numeric DEFAULT NULL::numeric, _costo_residuo numeric DEFAULT NULL::numeric, _cantiere_id uuid DEFAULT NULL::uuid, _fase_id uuid DEFAULT NULL::uuid, _fornitore_id uuid DEFAULT NULL::uuid, _note text DEFAULT NULL::text)
 RETURNS commessa_budget_voci
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.commessa_budget_voci; v_imp NUMERIC;
BEGIN
  SELECT * INTO v_row FROM public.commessa_budget_voci WHERE id=_voce_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elemento non trovato.' USING ERRCODE='P0002'; END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Voce archiviata'; END IF;
  IF v_row.updated_at <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  PERFORM public._assert_commessa_budget_mutabile(v_row.commessa_id);
  IF v_row.is_locked AND NOT public.has_any_role(v_row.organization_id, ARRAY['proprietario','amministratore']::public.app_role[]) THEN
    RAISE EXCEPTION 'Voce bloccata';
  END IF;

  IF _quantita IS NOT NULL AND _prezzo_unitario IS NOT NULL THEN
    v_imp := ROUND(_quantita * _prezzo_unitario, 2);
  ELSE
    v_imp := COALESCE(_importo_previsto, v_row.importo_previsto);
  END IF;

  UPDATE public.commessa_budget_voci SET
    categoria = _categoria,
    descrizione = _descrizione,
    sottocategoria = _sottocategoria,
    codice = _codice,
    unita_misura = _unita,
    quantita = _quantita,
    prezzo_unitario = _prezzo_unitario,
    importo_previsto = v_imp,
    importo_impegnato = COALESCE(_importo_impegnato, v_row.importo_impegnato),
    importo_sostenuto = CASE WHEN v_row.tipo='ricavo' THEN 0 ELSE COALESCE(_importo_sostenuto, v_row.importo_sostenuto) END,
    costo_residuo_stimato = CASE WHEN v_row.tipo='ricavo' THEN 0 ELSE COALESCE(_costo_residuo, v_row.costo_residuo_stimato) END,
    cantiere_id = _cantiere_id,
    fase_id = _fase_id,
    fornitore_id = _fornitore_id,
    note = _note
  WHERE id = _voce_id
  RETURNING * INTO v_row;

  PERFORM public.recalculate_commessa_budget(v_row.commessa_id);
  PERFORM public._cbv_audit(v_row.organization_id, v_row.commessa_id, 'commessa.budget_voce_updated',
    jsonb_build_object('voce_id',_voce_id));
  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.archive_commessa_budget_voce(_voce_id uuid, _expected_updated_at timestamp with time zone, _motivazione text DEFAULT NULL::text)
 RETURNS commessa_budget_voci
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.commessa_budget_voci;
BEGIN
  SELECT * INTO v_row FROM public.commessa_budget_voci WHERE id=_voce_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elemento non trovato.' USING ERRCODE='P0002'; END IF;
  IF v_row.updated_at <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  PERFORM public._assert_commessa_budget_mutabile(v_row.commessa_id);
  IF v_row.is_locked AND (_motivazione IS NULL OR length(btrim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per voce bloccata';
  END IF;
  UPDATE public.commessa_budget_voci
    SET archived_at = now(), archived_by = auth.uid()
    WHERE id=_voce_id RETURNING * INTO v_row;
  PERFORM public.recalculate_commessa_budget(v_row.commessa_id);
  PERFORM public._cbv_audit(v_row.organization_id, v_row.commessa_id, 'commessa.budget_voce_archived',
    jsonb_build_object('voce_id',_voce_id,'motivazione',_motivazione));
  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.restore_commessa_budget_voce(_voce_id uuid, _expected_updated_at timestamp with time zone)
 RETURNS commessa_budget_voci
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.commessa_budget_voci;
BEGIN
  SELECT * INTO v_row FROM public.commessa_budget_voci WHERE id=_voce_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elemento non trovato.' USING ERRCODE='P0002'; END IF;
  IF v_row.updated_at <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  PERFORM public._assert_commessa_budget_mutabile(v_row.commessa_id);
  UPDATE public.commessa_budget_voci
    SET archived_at = NULL, archived_by = NULL
    WHERE id=_voce_id RETURNING * INTO v_row;
  PERFORM public.recalculate_commessa_budget(v_row.commessa_id);
  PERFORM public._cbv_audit(v_row.organization_id, v_row.commessa_id, 'commessa.budget_voce_restored',
    jsonb_build_object('voce_id',_voce_id));
  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.reorder_commessa_budget_voci(_commessa_id uuid, _expected_updated_at timestamp with time zone, _ordered_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_count INT; v_active_count INT;
BEGIN
  PERFORM public._assert_commessa_budget_mutabile(_commessa_id);
  SELECT organization_id, updated_at INTO v_org, v_upd FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  IF (SELECT COUNT(*) FROM unnest(_ordered_ids) x) <> (SELECT COUNT(DISTINCT x) FROM unnest(_ordered_ids) x) THEN
    RAISE EXCEPTION 'ID duplicati';
  END IF;
  SELECT COUNT(*) INTO v_active_count FROM public.commessa_budget_voci
    WHERE commessa_id=_commessa_id AND archived_at IS NULL;
  SELECT COUNT(*) INTO v_count FROM public.commessa_budget_voci
    WHERE id = ANY(_ordered_ids) AND commessa_id=_commessa_id AND archived_at IS NULL;
  IF v_count <> array_length(_ordered_ids,1) OR v_count <> v_active_count THEN
    RAISE EXCEPTION 'Set voci non coerente';
  END IF;
  UPDATE public.commessa_budget_voci v
    SET posizione = t.pos
    FROM (SELECT unnest(_ordered_ids) AS id, generate_subscripts(_ordered_ids,1) AS pos) t
    WHERE v.id = t.id;
  PERFORM public._cbv_audit(v_org, _commessa_id, 'commessa.budget_voci_reordered',
    jsonb_build_object('count',v_active_count));
END $function$;

CREATE OR REPLACE FUNCTION public.set_commessa_budget_mode(_commessa_id uuid, _mode text, _expected_updated_at timestamp with time zone, _motivazione text DEFAULT NULL::text, _confirm_empty boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_old TEXT; v_has_voci BOOLEAN;
BEGIN
  IF _mode NOT IN ('manuale','analitico') THEN RAISE EXCEPTION 'Modalità non valida'; END IF;
  PERFORM public._assert_commessa_budget_mutabile(_commessa_id);
  SELECT organization_id, updated_at, budget_modalita INTO v_org, v_upd, v_old
    FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  IF v_old = _mode THEN RETURN v_upd; END IF;

  SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
    WHERE commessa_id=_commessa_id AND archived_at IS NULL) INTO v_has_voci;

  IF _mode = 'analitico' THEN
    IF NOT v_has_voci AND NOT _confirm_empty THEN
      RAISE EXCEPTION 'Nessuna voce presente: conferma richiesta';
    END IF;
    UPDATE public.commesse SET budget_modalita='analitico', updated_at=now() WHERE id=_commessa_id;
    IF v_has_voci THEN PERFORM public.recalculate_commessa_budget(_commessa_id); END IF;
  ELSE
    IF _motivazione IS NULL OR length(btrim(_motivazione))=0 THEN
      RAISE EXCEPTION 'Motivazione obbligatoria';
    END IF;
    UPDATE public.commesse SET budget_modalita='manuale', updated_at=now() WHERE id=_commessa_id;
  END IF;

  PERFORM public._cbv_audit(v_org, _commessa_id, 'commessa.budget_mode_changed',
    jsonb_build_object('from',v_old,'to',_mode,'motivazione',_motivazione));
  RETURN (SELECT updated_at FROM public.commesse WHERE id=_commessa_id);
END $function$;

CREATE OR REPLACE FUNCTION public.update_manual_commessa_budget(_commessa_id uuid, _expected_updated_at timestamp with time zone, _ricavi_previsti numeric, _ricavi_acquisiti numeric, _extra_approvati numeric, _extra_non_approvati numeric, _costi_previsti numeric, _costi_impegnati numeric, _costi_sostenuti numeric, _costi_residui_stimati numeric, _motivazione text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_mod TEXT;
  v_old_costi NUMERIC; v_old_ric_acq NUMERIC; v_old_marg NUMERIC;
  v_costo_agg NUMERIC; v_ricavi_agg NUMERIC; v_marg_prev NUMERIC; v_marg_agg NUMERIC;
  v_marg_pct NUMERIC; v_marg_pct_agg NUMERIC;
  v_needs_motiv BOOLEAN := false;
BEGIN
  PERFORM public._assert_commessa_budget_mutabile(_commessa_id);
  SELECT organization_id, updated_at, budget_modalita,
         costi_previsti, ricavi_acquisiti, margine_aggiornato
    INTO v_org, v_upd, v_mod, v_old_costi, v_old_ric_acq, v_old_marg
    FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  IF v_mod <> 'manuale' THEN RAISE EXCEPTION 'Budget non in modalità manuale'; END IF;

  IF LEAST(_ricavi_previsti, COALESCE(_ricavi_acquisiti,0), _extra_approvati, _extra_non_approvati,
           _costi_previsti, _costi_impegnati, _costi_sostenuti, _costi_residui_stimati) < 0 THEN
    RAISE EXCEPTION 'Importi negativi non ammessi';
  END IF;

  v_ricavi_agg := COALESCE(_ricavi_acquisiti,0) + COALESCE(_extra_approvati,0);
  v_costo_agg  := _costi_sostenuti + GREATEST(_costi_impegnati - _costi_sostenuti, 0) + _costi_residui_stimati;
  v_marg_prev  := _ricavi_previsti - _costi_previsti;
  v_marg_agg   := v_ricavi_agg - v_costo_agg;
  v_marg_pct   := CASE WHEN _ricavi_previsti > 0 THEN v_marg_prev / _ricavi_previsti * 100 ELSE 0 END;
  v_marg_pct_agg := CASE WHEN v_ricavi_agg > 0 THEN v_marg_agg / v_ricavi_agg * 100 ELSE 0 END;

  IF _costi_previsti > COALESCE(v_old_costi,0) THEN v_needs_motiv := true; END IF;
  IF v_old_ric_acq IS NOT NULL AND COALESCE(_ricavi_acquisiti,0) < v_old_ric_acq THEN v_needs_motiv := true; END IF;
  IF v_old_marg IS NOT NULL AND v_marg_agg < v_old_marg THEN v_needs_motiv := true; END IF;
  IF v_needs_motiv AND (_motivazione IS NULL OR length(btrim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per peggioramento economico';
  END IF;

  UPDATE public.commesse SET
    ricavi_previsti = _ricavi_previsti,
    ricavi_acquisiti = _ricavi_acquisiti,
    extra_approvati = _extra_approvati,
    extra_non_approvati = _extra_non_approvati,
    ricavi_aggiornati = v_ricavi_agg,
    costi_previsti = _costi_previsti,
    costi_impegnati = _costi_impegnati,
    costi_sostenuti = _costi_sostenuti,
    costi_residui_stimati = _costi_residui_stimati,
    costo_aggiornato = v_costo_agg,
    margine_previsto = v_marg_prev,
    margine_aggiornato = v_marg_agg,
    margine_percentuale = v_marg_pct,
    margine_percentuale_aggiornato = v_marg_pct_agg,
    scostamento_costi = v_costo_agg - _costi_previsti,
    scostamento_ricavi = v_ricavi_agg - _ricavi_previsti,
    scostamento_margine = v_marg_agg - v_marg_prev,
    budget_calcolato_at = now(),
    updated_at = now()
  WHERE id=_commessa_id;

  PERFORM public._cbv_audit(v_org, _commessa_id, 'commessa.manual_budget_updated',
    jsonb_build_object('motivazione',_motivazione));
  RETURN (SELECT updated_at FROM public.commesse WHERE id=_commessa_id);
END $function$;

CREATE OR REPLACE FUNCTION public.import_budget_from_preventivo(_commessa_id uuid, _expected_updated_at timestamp with time zone, _strategy text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org UUID; v_upd TIMESTAMPTZ; v_mod TEXT; v_prev UUID;
  v_ricavi_creati   INT := 0;
  v_costi_creati    INT := 0;
  v_ricavi_ignorati INT := 0;
  v_costi_ignorati  INT := 0;
  v_no_costo        INT := 0;
  v_pos INT; v_exists BOOLEAN; v_has_voci BOOLEAN;
  r RECORD; v_categoria_costo TEXT;
BEGIN
  IF _strategy NOT IN ('init_if_empty','add_missing') THEN
    RAISE EXCEPTION 'Strategia non valida';
  END IF;
  PERFORM public._assert_commessa_budget_mutabile(_commessa_id);

  SELECT organization_id, updated_at, budget_modalita, preventivo_id
    INTO v_org, v_upd, v_mod, v_prev
    FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  IF v_prev IS NULL THEN RAISE EXCEPTION 'Nessun preventivo collegato'; END IF;
  IF v_mod <> 'analitico' THEN RAISE EXCEPTION 'Passa alla modalità analitica per gestire le voci di Budget.'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
    WHERE commessa_id=_commessa_id AND archived_at IS NULL) INTO v_has_voci;
  IF _strategy='init_if_empty' AND v_has_voci THEN
    RAISE EXCEPTION 'Budget non vuoto: usare strategia add_missing';
  END IF;

  SELECT COALESCE(MAX(posizione),0) INTO v_pos FROM public.commessa_budget_voci
    WHERE commessa_id=_commessa_id AND archived_at IS NULL;

  FOR r IN
    SELECT id, codice, descrizione, unita_misura, quantita, costo_unitario, costo_totale,
           prezzo_unitario, importo_netto, categoria
    FROM public.preventivo_voci
    WHERE preventivo_id = v_prev AND organization_id = v_org
    ORDER BY ordine
  LOOP
    SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
      WHERE commessa_id=_commessa_id AND preventivo_voce_id=r.id
        AND archived_at IS NULL AND fonte='preventivo' AND tipo='ricavo') INTO v_exists;
    IF v_exists THEN
      v_ricavi_ignorati := v_ricavi_ignorati + 1;
    ELSE
      v_pos := v_pos + 1;
      INSERT INTO public.commessa_budget_voci(
        organization_id, commessa_id, tipo, categoria, descrizione, codice,
        unita_misura, quantita, prezzo_unitario, importo_previsto,
        importo_impegnato, importo_sostenuto, costo_residuo_stimato,
        fonte, preventivo_voce_id, posizione, is_locked, created_by
      ) VALUES (
        v_org, _commessa_id, 'ricavo', 'contratto',
        COALESCE(NULLIF(r.descrizione,''), '(voce senza descrizione)'), r.codice,
        r.unita_misura, r.quantita, r.prezzo_unitario, COALESCE(r.importo_netto,0),
        0, 0, 0, 'preventivo', r.id, v_pos, true, auth.uid()
      );
      v_ricavi_creati := v_ricavi_creati + 1;
    END IF;

    IF COALESCE(r.costo_totale, r.costo_unitario * r.quantita, 0) > 0 THEN
      v_categoria_costo := CASE
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%manodop%' THEN 'manodopera'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%materia%' THEN 'materiali'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%subapp%' THEN 'subappalti'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%noleg%' THEN 'noleggi'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%mezz%' THEN 'mezzi'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%trasp%' THEN 'trasporti'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%sicur%' THEN 'sicurezza'
        ELSE 'altro'
      END;
      SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
        WHERE commessa_id=_commessa_id AND preventivo_voce_id=r.id
          AND archived_at IS NULL AND fonte='preventivo' AND tipo='costo') INTO v_exists;
      IF v_exists THEN
        v_costi_ignorati := v_costi_ignorati + 1;
      ELSE
        v_pos := v_pos + 1;
        INSERT INTO public.commessa_budget_voci(
          organization_id, commessa_id, tipo, categoria, descrizione, codice,
          unita_misura, quantita, prezzo_unitario, importo_previsto,
          importo_impegnato, importo_sostenuto, costo_residuo_stimato,
          fonte, preventivo_voce_id, posizione, is_locked, created_by
        ) VALUES (
          v_org, _commessa_id, 'costo', v_categoria_costo,
          COALESCE(NULLIF(r.descrizione,''), '(voce senza descrizione)'), r.codice,
          r.unita_misura, r.quantita, r.costo_unitario,
          COALESCE(r.costo_totale, r.costo_unitario * r.quantita, 0),
          0, 0, 0, 'preventivo', r.id, v_pos, true, auth.uid()
        );
        v_costi_creati := v_costi_creati + 1;
      END IF;
    ELSE
      v_no_costo := v_no_costo + 1;
    END IF;
  END LOOP;

  PERFORM public.recalculate_commessa_budget(_commessa_id);
  PERFORM public._cbv_audit(v_org, _commessa_id, 'commessa.budget_imported_from_preventivo',
    jsonb_build_object(
      'strategy', _strategy,
      'ricavi_creati', v_ricavi_creati,
      'costi_creati', v_costi_creati,
      'ricavi_ignorati', v_ricavi_ignorati,
      'costi_ignorati', v_costi_ignorati,
      'senza_costo', v_no_costo
    ));

  RETURN jsonb_build_object(
    'ricavi_creati',   v_ricavi_creati,
    'costi_creati',    v_costi_creati,
    'ricavi_ignorati', v_ricavi_ignorati,
    'costi_ignorati',  v_costi_ignorati,
    'ignorati',        v_ricavi_ignorati + v_costi_ignorati,
    'senza_costo',     v_no_costo,
    'commessa_updated_at', (SELECT updated_at FROM public.commesse WHERE id=_commessa_id)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.set_commessa_baseline(_commessa_id uuid, _expected_updated_at timestamp with time zone, _motivazione text DEFAULT NULL::text, _replace boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_has BOOLEAN;
  v_prev UUID; v_ric NUMERIC; v_cost NUMERIC; v_marg NUMERIC;
BEGIN
  SELECT organization_id, updated_at INTO v_org, v_upd FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Elemento non trovato.' USING ERRCODE='P0002'; END IF;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Il Budget è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001'; END IF;
  IF public.is_commessa_budget_locked(_commessa_id) THEN
    RAISE EXCEPTION 'La commessa non è modificabile nello stato attuale.' USING ERRCODE='42501';
  END IF;
  IF NOT public.has_any_role(v_org, ARRAY['proprietario','amministratore']::public.app_role[]) THEN
    RAISE EXCEPTION 'Non sei autorizzato a modificare il Budget.' USING ERRCODE='42501';
  END IF;

  SELECT baseline_created_at IS NOT NULL INTO v_has FROM public.commesse WHERE id=_commessa_id;
  IF v_has AND NOT _replace THEN RAISE EXCEPTION 'Baseline già presente: richiesta sostituzione esplicita'; END IF;
  IF v_has AND _replace AND (_motivazione IS NULL OR length(btrim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per sostituzione baseline';
  END IF;

  SELECT preventivo_id,
         COALESCE(ricavi_aggiornati, ricavi_previsti),
         COALESCE(costo_aggiornato, costi_previsti),
         COALESCE(margine_aggiornato, margine_previsto)
    INTO v_prev, v_ric, v_cost, v_marg
    FROM public.commesse WHERE id=_commessa_id;

  UPDATE public.commesse SET
    baseline_preventivo_id = v_prev,
    baseline_ricavi = v_ric,
    baseline_costi = v_cost,
    baseline_margine = v_marg,
    baseline_created_at = now(),
    baseline_created_by = auth.uid(),
    updated_at = now()
  WHERE id=_commessa_id;

  PERFORM public._cbv_audit(v_org, _commessa_id,
    CASE WHEN v_has THEN 'commessa.baseline_replaced' ELSE 'commessa.baseline_created' END,
    jsonb_build_object('motivazione',_motivazione,'ricavi',v_ric,'costi',v_cost,'margine',v_marg));
  RETURN (SELECT updated_at FROM public.commesse WHERE id=_commessa_id);
END $function$;