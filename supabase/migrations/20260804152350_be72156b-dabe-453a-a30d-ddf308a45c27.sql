-- ─────────────────────────────────────────────────────────────────────────────
-- Ricalcolo costi rapportini con tariffe inserite successivamente
-- ─────────────────────────────────────────────────────────────────────────────

-- Membro "effettivo" del rapportino: membro_id se presente, altrimenti il
-- membro non archiviato collegato all'account dell'operatore.
CREATE OR REPLACE FUNCTION public._rap_membro_effettivo(_org uuid, _membro_id uuid, _user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    _membro_id,
    (SELECT m.id FROM public.organization_members m
      WHERE m.organization_id = _org
        AND m.user_id = _user_id
        AND m.archived_at IS NULL
      ORDER BY m.is_active DESC, m.created_at ASC
      LIMIT 1)
  )
$$;

REVOKE ALL ON FUNCTION public._rap_membro_effettivo(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Numero di tariffe valide alla data per un membro (per rilevare conflitti).
CREATE OR REPLACE FUNCTION public._tariffe_valide_membro(_membro_id uuid, _org uuid, _data date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::int FROM public.personale_costi_orari
  WHERE membro_id = _membro_id AND organization_id = _org AND archived_at IS NULL
    AND valido_dal <= _data AND (valido_al IS NULL OR valido_al >= _data)
$$;

REVOKE ALL ON FUNCTION public._tariffe_valide_membro(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- Contabilizzazione singola: ora risolve il membro anche quando il rapportino
-- è stato creato senza collegamento diretto al membro.
CREATE OR REPLACE FUNCTION public.contabilizza_rapportino_manodopera(_rapportino_id uuid)
RETURNS TABLE(rapportino_costo_id uuid, stato text, warning text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _rap public.rapportini%ROWTYPE;
  _membro UUID;
  _tariffa public.personale_costi_orari%ROWTYPE;
  _existing public.rapportini_costi%ROWTYPE;
  _costo_tot NUMERIC(14,2);
  _periodo DATE;
  _modalita TEXT;
  _new_id UUID;
  _warn TEXT := NULL;
  _n_tar INT := 0;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata' USING ERRCODE='42501'; END IF;

  SELECT * INTO _rap FROM public.rapportini WHERE rapportini.id = _rapportino_id;
  IF NOT FOUND OR _rap.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _rap.stato <> 'approvato' THEN
    RAISE EXCEPTION 'Solo rapportini approvati possono essere contabilizzati' USING ERRCODE='22023';
  END IF;

  SELECT * INTO _existing FROM public.rapportini_costi
  WHERE rapportino_id = _rapportino_id AND stato = 'contabilizzato' AND stornato_at IS NULL
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT _existing.id, _existing.stato, 'Già contabilizzato'::TEXT;
    RETURN;
  END IF;

  DELETE FROM public.rapportini_costi
  WHERE rapportino_id = _rapportino_id AND stato = 'non_contabilizzato';

  _periodo := date_trunc('month', _rap.data)::date;
  _membro := public._rap_membro_effettivo(_org, _rap.membro_id, _rap.user_id);

  IF _membro IS NOT NULL THEN
    _n_tar := public._tariffe_valide_membro(_membro, _org, _rap.data);
    IF _n_tar > 1 THEN
      RAISE EXCEPTION 'Esistono più tariffe valide sovrapposte per questa persona alla data del rapportino' USING ERRCODE='22023';
    END IF;
    SELECT * INTO _tariffa FROM public.get_costo_orario_membro_at_date(_membro, _org, _rap.data);
  END IF;
  IF _tariffa.id IS NULL AND _rap.user_id IS NOT NULL THEN
    SELECT * INTO _tariffa FROM public.get_personale_costo_orario_at_date(_rap.user_id, _org, _rap.data);
  END IF;

  SELECT budget_modalita INTO _modalita FROM public.commesse WHERE id = _rap.commessa_id;

  IF _tariffa.id IS NULL THEN
    INSERT INTO public.rapportini_costi (
      organization_id, rapportino_id, commessa_id, cantiere_id, fase_id, user_id, membro_id,
      ore, costo_orario_applicato, costo_totale, costo_orario_id,
      stato, periodo_riferimento, contabilizzato_by
    ) VALUES (
      _org, _rapportino_id, _rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _rap.user_id, _membro,
      _rap.ore, 0, 0, NULL, 'non_contabilizzato', _periodo, _me
    ) RETURNING id INTO _new_id;

    PERFORM public._log_audit(_org, 'rapportino.labor_cost_pending', 'rapportini_costi', _new_id,
      jsonb_build_object('rapportino_id', _rapportino_id, 'motivo', 'tariffa_mancante'));
    RETURN QUERY SELECT _new_id, 'non_contabilizzato'::TEXT,
      'Costo orario non configurato per la persona alla data del rapportino'::TEXT;
    RETURN;
  END IF;

  _costo_tot := ROUND(_rap.ore * _tariffa.costo_orario, 2);

  INSERT INTO public.rapportini_costi (
    organization_id, rapportino_id, commessa_id, cantiere_id, fase_id, user_id, membro_id,
    ore, costo_orario_applicato, costo_totale, costo_orario_id,
    stato, periodo_riferimento, contabilizzato_by
  ) VALUES (
    _org, _rapportino_id, _rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _rap.user_id, _membro,
    _rap.ore, _tariffa.costo_orario, _costo_tot, _tariffa.id,
    'contabilizzato', _periodo, _me
  ) RETURNING id INTO _new_id;

  PERFORM public._log_audit(_org, 'rapportino.labor_cost_calculated', 'rapportini_costi', _new_id,
    jsonb_build_object('rapportino_id', _rapportino_id, 'ore', _rap.ore,
      'costo_orario', _tariffa.costo_orario, 'costo_totale', _costo_tot, 'tariffa_id', _tariffa.id));

  IF _modalita = 'analitico' THEN
    PERFORM public._recalculate_labor_budget_voce(_rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _periodo);
    PERFORM public._log_audit(_org, 'rapportino.labor_cost_posted', 'rapportini_costi', _new_id,
      jsonb_build_object('rapportino_id', _rapportino_id));
  ELSE
    _warn := 'Commessa in modalità Budget manuale: costo calcolato non incluso automaticamente';
  END IF;

  RETURN QUERY SELECT _new_id, 'contabilizzato'::TEXT, _warn;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Anteprima + ricalcolo dei rapportini approvati senza costo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ricalcola_costi_rapportini_mancanti(
  _dry_run boolean DEFAULT true,
  _membro_id uuid DEFAULT NULL,
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _rapportino_ids uuid[] DEFAULT NULL,
  _limit integer DEFAULT 500
)
RETURNS TABLE(
  rapportino_id uuid,
  membro_id uuid,
  membro_nome text,
  data date,
  ore numeric,
  tariffa numeric,
  costo numeric,
  esito text,
  motivo text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _r RECORD;
  _membro UUID;
  _nome TEXT;
  _n_tar INT;
  _tar public.personale_costi_orari%ROWTYPE;
  _esito TEXT;
  _motivo TEXT;
  _costo NUMERIC(14,2);
  _tariffa NUMERIC;
  _res RECORD;
  _c_tot INT := 0; _c_ok INT := 0; _c_notar INT := 0;
  _c_conf INT := 0; _c_escl INT := 0; _c_ann INT := 0; _c_gia INT := 0; _c_err INT := 0;
  _tot_costo NUMERIC(14,2) := 0;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata' USING ERRCODE='42501'; END IF;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::public.app_role[]) THEN
    RAISE EXCEPTION 'Non sei autorizzato a ricalcolare i costi dei rapportini' USING ERRCODE='42501';
  END IF;

  IF NOT COALESCE(_dry_run, true) THEN
    PERFORM public._log_audit(_org, 'ricalcolo_costi_rapportini_avviato', 'rapportini', NULL,
      jsonb_build_object('date_from', _date_from, 'date_to', _date_to, 'membro_id', _membro_id,
        'rapportini_richiesti', COALESCE(array_length(_rapportino_ids, 1), 0)));
  END IF;

  FOR _r IN
    SELECT r.id, r.data, r.ore, r.stato, r.archived_at, r.cancelled_at,
           r.membro_id AS m_id, r.user_id, r.commessa_id
    FROM public.rapportini r
    WHERE r.organization_id = _org
      AND (_date_from IS NULL OR r.data >= _date_from)
      AND (_date_to IS NULL OR r.data <= _date_to)
      AND (_rapportino_ids IS NULL OR r.id = ANY(_rapportino_ids))
      AND (_membro_id IS NULL
           OR public._rap_membro_effettivo(_org, r.membro_id, r.user_id) = _membro_id)
    ORDER BY r.data ASC, r.id ASC
    LIMIT COALESCE(_limit, 500)
  LOOP
    _c_tot := _c_tot + 1;
    _membro := public._rap_membro_effettivo(_org, _r.m_id, _r.user_id);
    SELECT NULLIF(btrim(COALESCE(m.nome,'') || ' ' || COALESCE(m.cognome,'')), '')
      INTO _nome FROM public.organization_members m WHERE m.id = _membro;
    _tariffa := NULL; _costo := NULL; _motivo := NULL;
    _tar := NULL;

    IF _r.cancelled_at IS NOT NULL OR _r.stato = 'annullato' THEN
      _esito := 'annullato'; _motivo := 'Rapportino annullato'; _c_ann := _c_ann + 1;
    ELSIF _r.archived_at IS NOT NULL THEN
      _esito := 'escluso'; _motivo := 'Rapportino archiviato'; _c_escl := _c_escl + 1;
    ELSIF EXISTS (
      SELECT 1 FROM public.rapportini_costi rc
      WHERE rc.rapportino_id = _r.id AND rc.stato = 'contabilizzato' AND rc.stornato_at IS NULL
    ) THEN
      _esito := 'gia_contabilizzato'; _motivo := 'Costo già congelato: invariato';
      _c_gia := _c_gia + 1;
      SELECT rc.costo_orario_applicato, rc.costo_totale INTO _tariffa, _costo
      FROM public.rapportini_costi rc
      WHERE rc.rapportino_id = _r.id AND rc.stato = 'contabilizzato' AND rc.stornato_at IS NULL
      LIMIT 1;
    ELSIF _r.stato <> 'approvato' THEN
      _esito := 'escluso'; _motivo := 'Rapportino non approvato'; _c_escl := _c_escl + 1;
    ELSIF _membro IS NULL THEN
      _esito := 'tariffa_mancante'; _motivo := 'Persona non collegata a un membro dell''organizzazione';
      _c_notar := _c_notar + 1;
    ELSE
      _n_tar := public._tariffe_valide_membro(_membro, _org, _r.data);
      IF _n_tar > 1 THEN
        _esito := 'conflitto_tariffa';
        _motivo := 'Più tariffe valide sovrapposte alla data: risolvere il conflitto';
        _c_conf := _c_conf + 1;
      ELSE
        SELECT * INTO _tar FROM public.get_costo_orario_membro_at_date(_membro, _org, _r.data);
        IF _tar.id IS NULL AND _r.user_id IS NOT NULL THEN
          SELECT * INTO _tar FROM public.get_personale_costo_orario_at_date(_r.user_id, _org, _r.data);
        END IF;
        IF _tar.id IS NULL THEN
          _esito := 'tariffa_mancante';
          _motivo := 'Nessuna tariffa valida alla data del rapportino';
          _c_notar := _c_notar + 1;
        ELSE
          _tariffa := _tar.costo_orario;
          _costo := ROUND(_r.ore * _tar.costo_orario, 2);
          IF COALESCE(_dry_run, true) THEN
            _esito := 'contabilizzabile'; _motivo := NULL;
          ELSE
            BEGIN
              SELECT * INTO _res FROM public.contabilizza_rapportino_manodopera(_r.id) LIMIT 1;
              IF _res.stato = 'contabilizzato' THEN
                _esito := 'contabilizzato'; _motivo := _res.warning;
              ELSE
                _esito := 'tariffa_mancante'; _motivo := _res.warning;
              END IF;
            EXCEPTION WHEN OTHERS THEN
              _esito := 'errore'; _motivo := SQLERRM; _c_err := _c_err + 1;
            END;
          END IF;
          IF _esito IN ('contabilizzabile','contabilizzato') THEN
            _c_ok := _c_ok + 1;
            _tot_costo := _tot_costo + COALESCE(_costo, 0);
          END IF;
        END IF;
      END IF;
    END IF;

    rapportino_id := _r.id;
    membro_id := _membro;
    membro_nome := _nome;
    data := _r.data;
    ore := _r.ore;
    tariffa := _tariffa;
    costo := _costo;
    esito := _esito;
    motivo := _motivo;
    RETURN NEXT;
  END LOOP;

  IF NOT COALESCE(_dry_run, true) THEN
    PERFORM public._log_audit(_org,
      CASE WHEN _c_err > 0 OR _c_conf > 0 OR _c_notar > 0
           THEN 'ricalcolo_costi_rapportini_parziale'
           ELSE 'ricalcolo_costi_rapportini_completato' END,
      'rapportini', NULL,
      jsonb_build_object('date_from', _date_from, 'date_to', _date_to, 'membro_id', _membro_id,
        'analizzati', _c_tot, 'contabilizzati', _c_ok, 'senza_tariffa', _c_notar,
        'conflitti', _c_conf, 'esclusi', _c_escl + _c_gia + _c_ann, 'errori', _c_err,
        'totale_costo', _tot_costo));

    IF _me IS NOT NULL THEN
      PERFORM public.create_notifica_event(
        _org, ARRAY[_me]::uuid[], 'ricalcolo_costi_rapportini',
        CASE WHEN _c_err > 0 THEN 'warning' ELSE 'info' END,
        'Ricalcolo costi rapportini completato',
        format('Contabilizzati %s · senza tariffa %s · conflitti %s · errori %s',
               _c_ok, _c_notar, _c_conf, _c_err),
        'rapportini', NULL, '/costi-personale',
        to_char(now(), 'YYYYMMDDHH24MISS'),
        jsonb_build_object('contabilizzati', _c_ok, 'senza_tariffa', _c_notar,
          'conflitti', _c_conf, 'errori', _c_err, 'totale_costo', _tot_costo),
        NULL);
    END IF;
  END IF;

  RETURN;
END $function$;

GRANT EXECUTE ON FUNCTION public.ricalcola_costi_rapportini_mancanti(boolean, uuid, date, date, uuid[], integer) TO authenticated;
REVOKE ALL ON FUNCTION public.ricalcola_costi_rapportini_mancanti(boolean, uuid, date, date, uuid[], integer) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ricalcolo costo storico di un rapportino già contabilizzato
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ricalcola_costo_storico_rapportino(
  _rapportino_id uuid,
  _motivo text
)
RETURNS TABLE(
  costo_precedente numeric,
  tariffa_precedente numeric,
  costo_nuovo numeric,
  tariffa_nuova numeric,
  stato text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _rap public.rapportini%ROWTYPE;
  _old public.rapportini_costi%ROWTYPE;
  _res RECORD;
  _new public.rapportini_costi%ROWTYPE;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata' USING ERRCODE='42501'; END IF;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore']::public.app_role[]) THEN
    RAISE EXCEPTION 'Non sei autorizzato a ricalcolare un costo storico' USING ERRCODE='42501';
  END IF;
  IF _motivo IS NULL OR length(btrim(_motivo)) < 5 THEN
    RAISE EXCEPTION 'Motivazione obbligatoria (minimo 5 caratteri)' USING ERRCODE='22023';
  END IF;

  SELECT * INTO _rap FROM public.rapportini WHERE rapportini.id = _rapportino_id;
  IF NOT FOUND OR _rap.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;

  SELECT * INTO _old FROM public.rapportini_costi
  WHERE rapportini_costi.rapportino_id = _rapportino_id
    AND rapportini_costi.stato = 'contabilizzato'
    AND rapportini_costi.stornato_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nessun costo contabilizzato da ricalcolare' USING ERRCODE='22023';
  END IF;

  UPDATE public.rapportini_costi SET
    stato = 'stornato', stornato_at = now(), stornato_by = _me,
    motivo_storno = btrim(_motivo), updated_at = now()
  WHERE id = _old.id;

  IF _old.budget_voce_id IS NOT NULL OR true THEN
    PERFORM public._recalculate_labor_budget_voce(_old.commessa_id, _old.cantiere_id, _old.fase_id, _old.periodo_riferimento);
  END IF;

  SELECT * INTO _res FROM public.contabilizza_rapportino_manodopera(_rapportino_id) LIMIT 1;

  SELECT * INTO _new FROM public.rapportini_costi
  WHERE rapportini_costi.rapportino_id = _rapportino_id
    AND rapportini_costi.stornato_at IS NULL
  ORDER BY rapportini_costi.created_at DESC
  LIMIT 1;

  PERFORM public._log_audit(_org, 'ricalcolo_costo_storico_manualizzato', 'rapportini_costi', _new.id,
    jsonb_build_object('rapportino_id', _rapportino_id, 'motivo', btrim(_motivo),
      'costo_precedente', _old.costo_totale, 'tariffa_precedente', _old.costo_orario_applicato,
      'costo_nuovo', _new.costo_totale, 'tariffa_nuova', _new.costo_orario_applicato));

  costo_precedente := _old.costo_totale;
  tariffa_precedente := _old.costo_orario_applicato;
  costo_nuovo := _new.costo_totale;
  tariffa_nuova := _new.costo_orario_applicato;
  stato := _new.stato;
  RETURN NEXT;
END $function$;

GRANT EXECUTE ON FUNCTION public.ricalcola_costo_storico_rapportino(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ricalcola_costo_storico_rapportino(uuid, text) FROM anon;