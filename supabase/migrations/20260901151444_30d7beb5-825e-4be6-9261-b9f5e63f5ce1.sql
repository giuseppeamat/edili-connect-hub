-- 1) Le ore di testata sono la somma delle righe personale: limite realistico
ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_ore_valid;
ALTER TABLE public.rapportini ADD CONSTRAINT rapportini_ore_valid
  CHECK (ore > 0 AND ore <= 240);

-- 2) create_rapportino: niente più soglia 16h sul totale (il limite è per persona)
CREATE OR REPLACE FUNCTION public.create_rapportino(_commessa_id uuid, _user_id uuid, _data date, _ore numeric, _descrizione_lavori text, _cantiere_id uuid DEFAULT NULL::uuid, _fase_id uuid DEFAULT NULL::uuid, _ora_inizio time without time zone DEFAULT NULL::time without time zone, _ora_fine time without time zone DEFAULT NULL::time without time zone, _pausa_minuti integer DEFAULT 0, _note text DEFAULT NULL::text, _foto_urls text[] DEFAULT NULL::text[], _override_ore boolean DEFAULT false, _override_motivo text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _me         UUID := auth.uid();
  _org        UUID;
  _c_org      UUID;
  _c_closed   TIMESTAMPTZ;
  _c_arch     TIMESTAMPTZ;
  _t_active   BOOLEAN;
  _t_org      UUID;
  _is_admin   BOOLEAN;
  _new_id     UUID;
  _new_upd    TIMESTAMPTZ;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;

  IF _user_id IS NULL THEN RAISE EXCEPTION 'Utente obbligatorio' USING ERRCODE='22023'; END IF;
  SELECT organization_id, COALESCE(is_active,false)
    INTO _t_org, _t_active FROM public.profiles WHERE profiles.id = _user_id;
  IF _t_org IS DISTINCT FROM _org THEN
    RAISE EXCEPTION 'Utente non appartiene all''organizzazione' USING ERRCODE='42501';
  END IF;
  IF _t_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Utente riferito non è attivo' USING ERRCODE='42501';
  END IF;

  _is_admin := public.has_any_role(_org,
      ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]);
  IF _user_id <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non autorizzato a creare rapportini per altri utenti' USING ERRCODE='42501';
  END IF;

  SELECT organization_id, closed_at, archived_at INTO _c_org, _c_closed, _c_arch
    FROM public.commesse WHERE commesse.id = _commessa_id;
  IF _c_org IS DISTINCT FROM _org THEN
    RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='42501';
  END IF;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_commessa(_commessa_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere alla commessa' USING ERRCODE='42501';
  END IF;
  IF _cantiere_id IS NOT NULL AND NOT public.can_access_cantiere(_cantiere_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere al cantiere' USING ERRCODE='42501';
  END IF;

  IF _data IS NULL THEN RAISE EXCEPTION 'Data obbligatoria' USING ERRCODE='22023'; END IF;
  IF _data > (CURRENT_DATE + INTERVAL '1 day')::date THEN
    RAISE EXCEPTION 'Data futura oltre la soglia consentita (max domani)' USING ERRCODE='22023';
  END IF;

  IF _descrizione_lavori IS NULL OR btrim(_descrizione_lavori) = '' THEN
    RAISE EXCEPTION 'Descrizione lavori obbligatoria' USING ERRCODE='22023';
  END IF;

  IF _ore IS NULL OR _ore <= 0 OR _ore > 240 THEN
    RAISE EXCEPTION 'Ore non valide (0 < ore totali <= 240)' USING ERRCODE='22023';
  END IF;

  IF _ora_inizio IS NOT NULL AND _ora_fine IS NOT NULL AND _ora_fine < _ora_inizio THEN
    RAISE EXCEPTION 'Ora fine antecedente all''ora inizio' USING ERRCODE='22023';
  END IF;
  IF _pausa_minuti IS NULL OR _pausa_minuti < 0 THEN
    RAISE EXCEPTION 'Pausa non valida' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.rapportini(
    organization_id, commessa_id, cantiere_id, fase_id, user_id,
    data, ora_inizio, ora_fine, pausa_minuti, ore,
    descrizione_lavori, lavorazione, note, foto_urls,
    stato, created_by, updated_at
  ) VALUES (
    _org, _commessa_id, _cantiere_id, _fase_id, _user_id,
    _data, _ora_inizio, _ora_fine, COALESCE(_pausa_minuti,0), _ore,
    btrim(_descrizione_lavori), btrim(_descrizione_lavori), _note, COALESCE(_foto_urls, '{}'::text[]),
    'bozza', _me, now()
  ) RETURNING rapportini.id, rapportini.updated_at INTO _new_id, _new_upd;

  PERFORM public._log_audit(_org, 'rapportino.created', 'rapportini', _new_id,
    jsonb_build_object('commessa_id', _commessa_id, 'user_id', _user_id, 'ore', _ore));

  id := _new_id; updated_at := _new_upd; RETURN NEXT;
END; $function$;

-- 3) Contabilizzazione: se ci sono righe personale, si contabilizza persona per persona
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
  _n_pers INT := 0;
  _riga RECORD;
  _ko INT := 0;
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

  SELECT COUNT(*) INTO _n_pers FROM public.rapportini_personale
   WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL;

  -- Modello corrente: una riga costo per ogni persona impiegata
  IF _n_pers > 0 THEN
    FOR _riga IN
      SELECT id FROM public.rapportini_personale
      WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL
        AND stato_contabilizzazione <> 'contabilizzato'
    LOOP
      PERFORM public._contabilizza_riga_personale(_riga.id);
    END LOOP;

    SELECT COUNT(*) INTO _ko FROM public.rapportini_personale
     WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL
       AND stato_contabilizzazione <> 'contabilizzato';

    IF _ko > 0 THEN
      _warn := _ko || ' persone senza costo calcolato (tariffa mancante o conflitto di tariffe)';
    END IF;

    RETURN QUERY SELECT NULL::uuid, 'contabilizzato'::TEXT, _warn;
    RETURN;
  END IF;

  -- Fallback legacy: rapportino senza righe personale
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
  ELSE
    _warn := 'Commessa in modalità Budget manuale: costo calcolato non incluso automaticamente';
  END IF;

  RETURN QUERY SELECT _new_id, 'contabilizzato'::TEXT, _warn;
END $function$;

-- 4) Backfill: storna i costi legacy di testata dove esistono righe personale
DO $backfill$
DECLARE _rc RECORD; _riga RECORD;
BEGIN
  FOR _rc IN
    SELECT c.id, c.commessa_id, c.cantiere_id, c.fase_id, c.periodo_riferimento
    FROM public.rapportini_costi c
    WHERE c.rapportino_personale_id IS NULL
      AND c.stato = 'contabilizzato' AND c.stornato_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.rapportini_personale p
        WHERE p.rapportino_id = c.rapportino_id AND p.annullato_at IS NULL
      )
  LOOP
    UPDATE public.rapportini_costi SET
      stato = 'stornato', stornato_at = now(),
      motivo_storno = 'Sostituito dai costi per singola persona'
      WHERE id = _rc.id;
    PERFORM public._recalculate_labor_budget_voce(_rc.commessa_id, _rc.cantiere_id, _rc.fase_id, _rc.periodo_riferimento);
  END LOOP;

  FOR _riga IN
    SELECT p.id FROM public.rapportini_personale p
    JOIN public.rapportini r ON r.id = p.rapportino_id
    WHERE p.annullato_at IS NULL
      AND p.stato_contabilizzazione <> 'contabilizzato'
      AND r.stato = 'approvato'
  LOOP
    PERFORM public._contabilizza_riga_personale(_riga.id);
  END LOOP;
END $backfill$;
