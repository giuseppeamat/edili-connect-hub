-- ============================================================================
-- PERSONALE MULTIPLO NEI RAPPORTINI
-- ============================================================================

-- 0. rapportini_costi: adeguamenti per righe multiple ------------------------
ALTER TABLE public.rapportini_costi ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.rapportini_costi
  ADD COLUMN IF NOT EXISTS rapportino_personale_id UUID NULL;
DROP INDEX IF EXISTS public.uq_rc_rapportino_active;

-- 1. TABELLA rapportini_personale --------------------------------------------
CREATE TABLE public.rapportini_personale (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rapportino_id UUID NOT NULL,
  membro_id UUID NOT NULL,
  ore NUMERIC(8,2) NOT NULL CHECK (ore > 0 AND ore <= 24),
  nota TEXT NULL,
  tariffa_id UUID NULL REFERENCES public.personale_costi_orari(id) ON DELETE SET NULL,
  tariffa_oraria_congelata NUMERIC(12,4) NULL CHECK (tariffa_oraria_congelata IS NULL OR tariffa_oraria_congelata >= 0),
  costo_congelato NUMERIC(14,2) NULL CHECK (costo_congelato IS NULL OR costo_congelato >= 0),
  stato_contabilizzazione TEXT NOT NULL DEFAULT 'da_contabilizzare'
    CHECK (stato_contabilizzazione IN ('da_contabilizzare','contabilizzato','tariffa_mancante','conflitto_tariffa','annullato')),
  errore_contabilizzazione TEXT NULL,
  contabilizzato_at TIMESTAMPTZ NULL,
  annullato_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL,
  CONSTRAINT rp_rap_fk FOREIGN KEY (rapportino_id, organization_id)
    REFERENCES public.rapportini(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT rp_membro_fk FOREIGN KEY (membro_id, organization_id)
    REFERENCES public.organization_members(id, organization_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_rp_rapportino_membro ON public.rapportini_personale (rapportino_id, membro_id)
  WHERE annullato_at IS NULL;
CREATE INDEX idx_rp_rapportino ON public.rapportini_personale (rapportino_id);
CREATE INDEX idx_rp_membro ON public.rapportini_personale (membro_id);
CREATE INDEX idx_rp_org_stato ON public.rapportini_personale (organization_id, stato_contabilizzazione);

GRANT ALL ON public.rapportini_personale TO service_role;
REVOKE ALL ON public.rapportini_personale FROM anon;

ALTER TABLE public.rapportini_personale ENABLE ROW LEVEL SECURITY;

-- Nessun accesso diretto: letture e scritture passano dalle RPC SECURITY DEFINER.
CREATE POLICY "rapportini_personale_no_direct_access"
  ON public.rapportini_personale FOR SELECT TO authenticated USING (false);

CREATE TRIGGER trg_rp_updated_at
  BEFORE UPDATE ON public.rapportini_personale
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- collegamento riga costo -> riga personale
ALTER TABLE public.rapportini_costi
  ADD CONSTRAINT rc_rp_fk FOREIGN KEY (rapportino_personale_id)
  REFERENCES public.rapportini_personale(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_rc_personale_active ON public.rapportini_costi (rapportino_personale_id)
  WHERE stato = 'contabilizzato' AND stornato_at IS NULL AND rapportino_personale_id IS NOT NULL;

-- tariffa coerente con il membro
CREATE OR REPLACE FUNCTION public._rp_check_tariffa()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m UUID; _o UUID;
BEGIN
  IF NEW.tariffa_id IS NOT NULL THEN
    SELECT membro_id, organization_id INTO _m, _o
      FROM public.personale_costi_orari WHERE id = NEW.tariffa_id;
    IF _o IS DISTINCT FROM NEW.organization_id OR _m IS DISTINCT FROM NEW.membro_id THEN
      RAISE EXCEPTION 'Tariffa non coerente con la persona indicata' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rp_check_tariffa
  BEFORE INSERT OR UPDATE ON public.rapportini_personale
  FOR EACH ROW EXECUTE FUNCTION public._rp_check_tariffa();

-- 2. HELPER: ruoli economici --------------------------------------------------
CREATE OR REPLACE FUNCTION public._rp_can_see_costs(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public._rp_can_see_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._rp_can_see_costs(uuid) TO authenticated;

-- 3. CONTABILIZZAZIONE DI UNA RIGA -------------------------------------------
CREATE OR REPLACE FUNCTION public._contabilizza_riga_personale(_riga_id uuid)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
  _r public.rapportini_personale%ROWTYPE;
  _rap public.rapportini%ROWTYPE;
  _tar public.personale_costi_orari%ROWTYPE;
  _n INT; _costo NUMERIC(14,2); _periodo DATE; _cost_id UUID;
  _uid UUID;
BEGIN
  SELECT * INTO _r FROM public.rapportini_personale WHERE id = _riga_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _r.annullato_at IS NOT NULL THEN RETURN 'annullato'; END IF;
  IF _r.stato_contabilizzazione = 'contabilizzato' THEN RETURN 'contabilizzato'; END IF;

  SELECT * INTO _rap FROM public.rapportini WHERE id = _r.rapportino_id;
  IF _rap.stato <> 'approvato' THEN
    UPDATE public.rapportini_personale
      SET stato_contabilizzazione = 'da_contabilizzare', errore_contabilizzazione = NULL
      WHERE id = _riga_id;
    RETURN 'da_contabilizzare';
  END IF;

  _n := public._tariffe_valide_membro(_r.membro_id, _r.organization_id, _rap.data);
  IF _n > 1 THEN
    UPDATE public.rapportini_personale SET
      stato_contabilizzazione = 'conflitto_tariffa',
      errore_contabilizzazione = 'Esistono più tariffe valide sovrapposte alla data del rapportino'
      WHERE id = _riga_id;
    PERFORM public._log_audit(_r.organization_id, 'conflitto_tariffa_rapportino', 'rapportini_personale', _riga_id,
      jsonb_build_object('rapportino_id', _r.rapportino_id));
    RETURN 'conflitto_tariffa';
  END IF;

  SELECT * INTO _tar FROM public.get_costo_orario_membro_at_date(_r.membro_id, _r.organization_id, _rap.data);
  IF _tar.id IS NULL THEN
    UPDATE public.rapportini_personale SET
      stato_contabilizzazione = 'tariffa_mancante',
      errore_contabilizzazione = 'Nessuna tariffa valida alla data del rapportino'
      WHERE id = _riga_id;
    PERFORM public._log_audit(_r.organization_id, 'tariffa_mancante_rapportino', 'rapportini_personale', _riga_id,
      jsonb_build_object('rapportino_id', _r.rapportino_id, 'membro_id', _r.membro_id));
    RETURN 'tariffa_mancante';
  END IF;

  _costo := ROUND(_r.ore * _tar.costo_orario, 2);
  _periodo := date_trunc('month', _rap.data)::date;
  SELECT user_id INTO _uid FROM public.organization_members WHERE id = _r.membro_id;

  INSERT INTO public.rapportini_costi (
    organization_id, rapportino_id, rapportino_personale_id, commessa_id, cantiere_id, fase_id,
    user_id, membro_id, ore, costo_orario_applicato, costo_totale, costo_orario_id,
    stato, periodo_riferimento, contabilizzato_by
  ) VALUES (
    _r.organization_id, _r.rapportino_id, _r.id, _rap.commessa_id, _rap.cantiere_id, _rap.fase_id,
    _uid, _r.membro_id, _r.ore, _tar.costo_orario, _costo, _tar.id,
    'contabilizzato', _periodo, COALESCE(_me, _r.created_by)
  ) RETURNING id INTO _cost_id;

  UPDATE public.rapportini_personale SET
    tariffa_id = _tar.id,
    tariffa_oraria_congelata = _tar.costo_orario,
    costo_congelato = _costo,
    stato_contabilizzazione = 'contabilizzato',
    errore_contabilizzazione = NULL,
    contabilizzato_at = now(),
    updated_by = _me
    WHERE id = _riga_id;

  PERFORM public._log_audit(_r.organization_id, 'costo_personale_contabilizzato', 'rapportini_personale', _riga_id,
    jsonb_build_object('rapportino_id', _r.rapportino_id, 'membro_id', _r.membro_id,
      'ore', _r.ore, 'tariffa', _tar.costo_orario, 'costo', _costo, 'costo_id', _cost_id));

  PERFORM public._recalculate_labor_budget_voce(_rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _periodo);
  RETURN 'contabilizzato';
END $$;
REVOKE ALL ON FUNCTION public._contabilizza_riga_personale(uuid) FROM PUBLIC, anon, authenticated;

-- 4. STORNO DI UNA RIGA -------------------------------------------------------
CREATE OR REPLACE FUNCTION public._storna_riga_personale(_riga_id uuid, _motivo text, _annulla boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid(); _rc RECORD; _r public.rapportini_personale%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.rapportini_personale WHERE id = _riga_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  FOR _rc IN
    SELECT * FROM public.rapportini_costi
    WHERE rapportino_personale_id = _riga_id AND stato = 'contabilizzato' AND stornato_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.rapportini_costi SET
      stato = 'stornato', stornato_at = now(), stornato_by = _me,
      motivo_storno = COALESCE(_motivo, 'Storno riga personale')
      WHERE id = _rc.id;
    PERFORM public._recalculate_labor_budget_voce(_rc.commessa_id, _rc.cantiere_id, _rc.fase_id, _rc.periodo_riferimento);
    PERFORM public._log_audit(_r.organization_id, 'costo_personale_stornato', 'rapportini_personale', _riga_id,
      jsonb_build_object('rapportino_id', _r.rapportino_id, 'costo_id', _rc.id, 'motivo', _motivo));
  END LOOP;

  IF _annulla AND _r.annullato_at IS NULL THEN
    UPDATE public.rapportini_personale SET
      stato_contabilizzazione = 'annullato', annullato_at = now(), updated_by = _me
      WHERE id = _riga_id;
    PERFORM public._log_audit(_r.organization_id, 'personale_rimosso_rapportino', 'rapportini_personale', _riga_id,
      jsonb_build_object('rapportino_id', _r.rapportino_id, 'membro_id', _r.membro_id, 'motivo', _motivo));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._storna_riga_personale(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- 5. TRIGGER: annullamento/archiviazione rapportino ---------------------------
CREATE OR REPLACE FUNCTION public._rap_cascade_personale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _riga RECORD;
BEGIN
  IF (NEW.stato = 'annullato' AND OLD.stato IS DISTINCT FROM 'annullato')
     OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL) THEN
    FOR _riga IN SELECT id FROM public.rapportini_personale
      WHERE rapportino_id = NEW.id AND annullato_at IS NULL
    LOOP
      PERFORM public._storna_riga_personale(_riga.id, 'Rapportino annullato o archiviato', true);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rap_cascade_personale
  AFTER UPDATE ON public.rapportini
  FOR EACH ROW EXECUTE FUNCTION public._rap_cascade_personale();

-- 6. RPC: lettura righe personale --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rapportino_personale(_rapportino_id uuid)
RETURNS TABLE(
  id uuid, membro_id uuid, membro_nome text, membro_qualifica text,
  ore numeric, nota text, stato_contabilizzazione text, errore_contabilizzazione text,
  tariffa_oraria_congelata numeric, costo_congelato numeric,
  contabilizzato_at timestamptz, annullato_at timestamptz, can_see_costs boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _org UUID; _econ BOOLEAN; _ok INT;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT 1 INTO _ok FROM public.rapportini r WHERE r.id = _rapportino_id AND r.organization_id = _org;
  IF _ok IS NULL THEN RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501'; END IF;
  _econ := public._rp_can_see_costs(_org);

  RETURN QUERY
  SELECT rp.id, rp.membro_id,
         TRIM(COALESCE(m.nome,'') || ' ' || COALESCE(m.cognome,'')) AS membro_nome,
         m.qualifica,
         rp.ore, rp.nota, rp.stato_contabilizzazione, rp.errore_contabilizzazione,
         CASE WHEN _econ THEN rp.tariffa_oraria_congelata ELSE NULL END,
         CASE WHEN _econ THEN rp.costo_congelato ELSE NULL END,
         rp.contabilizzato_at, rp.annullato_at, _econ
  FROM public.rapportini_personale rp
  JOIN public.organization_members m ON m.id = rp.membro_id
  WHERE rp.rapportino_id = _rapportino_id AND rp.organization_id = _org
  ORDER BY rp.annullato_at NULLS FIRST, m.cognome, m.nome;
END $$;
REVOKE ALL ON FUNCTION public.get_rapportino_personale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rapportino_personale(uuid) TO authenticated;

-- 7. RPC: salvataggio transazionale ------------------------------------------
CREATE OR REPLACE FUNCTION public.save_rapportino_personale(
  _rapportino_id uuid,
  _righe jsonb,
  _allow_recalc boolean DEFAULT false
)
RETURNS TABLE(
  righe_totali int, contabilizzate int, tariffa_mancante int, conflitto int, rimosse int, ore_totali numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid(); _org UUID; _rap public.rapportini%ROWTYPE;
  _el JSONB; _membro UUID; _ore NUMERIC; _nota TEXT;
  _m public.organization_members%ROWTYPE;
  _ex public.rapportini_personale%ROWTYPE;
  _ids UUID[] := ARRAY[]::UUID[];
  _riga RECORD; _new_id UUID; _rimosse INT := 0;
  _tot NUMERIC(8,2);
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _rap FROM public.rapportini WHERE id = _rapportino_id;
  IF NOT FOUND OR _rap.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _rap.archived_at IS NOT NULL OR _rap.stato = 'annullato' THEN
    RAISE EXCEPTION 'Rapportino non modificabile' USING ERRCODE='22023';
  END IF;
  IF NOT (public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione','responsabile_commessa','capocantiere']::public.app_role[])
          OR _rap.created_by = _me) THEN
    RAISE EXCEPTION 'Non sei autorizzato a modificare il personale del rapportino' USING ERRCODE='42501';
  END IF;

  IF _righe IS NULL OR jsonb_typeof(_righe) <> 'array' THEN
    RAISE EXCEPTION 'Righe personale non valide' USING ERRCODE='22023';
  END IF;

  FOR _el IN SELECT * FROM jsonb_array_elements(_righe) LOOP
    _membro := NULLIF(_el->>'membro_id','')::uuid;
    _ore := NULLIF(_el->>'ore','')::numeric;
    _nota := NULLIF(_el->>'nota','');
    IF _membro IS NULL THEN RAISE EXCEPTION 'Persona non selezionata' USING ERRCODE='22023'; END IF;
    IF _ore IS NULL OR _ore <= 0 THEN RAISE EXCEPTION 'Ore non valide: devono essere maggiori di zero' USING ERRCODE='22023'; END IF;
    IF _ore > 24 THEN RAISE EXCEPTION 'Ore non valide: massimo 24 per persona' USING ERRCODE='22023'; END IF;
    IF _membro = ANY(_ids) THEN RAISE EXCEPTION 'La stessa persona è stata inserita due volte' USING ERRCODE='22023'; END IF;

    SELECT * INTO _m FROM public.organization_members WHERE id = _membro;
    IF NOT FOUND OR _m.organization_id <> _org THEN
      RAISE EXCEPTION 'Persona non trovata nell''organizzazione' USING ERRCODE='42501';
    END IF;
    IF _m.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Persona archiviata: non selezionabile' USING ERRCODE='22023';
    END IF;

    SELECT * INTO _ex FROM public.rapportini_personale
      WHERE rapportino_id = _rapportino_id AND membro_id = _membro AND annullato_at IS NULL
      FOR UPDATE;

    IF FOUND THEN
      IF _ex.stato_contabilizzazione = 'contabilizzato' AND _ex.ore IS DISTINCT FROM _ore THEN
        IF NOT _allow_recalc THEN
          RAISE EXCEPTION 'Ore già contabilizzate: serve un ricalcolo controllato per modificarle' USING ERRCODE='22023';
        END IF;
        PERFORM public._storna_riga_personale(_ex.id, 'Ricalcolo controllato ore', false);
        UPDATE public.rapportini_personale SET
          ore = _ore, nota = _nota, updated_by = _me,
          stato_contabilizzazione = 'da_contabilizzare',
          tariffa_id = NULL, tariffa_oraria_congelata = NULL, costo_congelato = NULL,
          contabilizzato_at = NULL, errore_contabilizzazione = NULL
          WHERE id = _ex.id;
        PERFORM public._log_audit(_org, 'ore_personale_modificate', 'rapportini_personale', _ex.id,
          jsonb_build_object('rapportino_id', _rapportino_id, 'ore_prima', _ex.ore, 'ore_dopo', _ore));
      ELSE
        UPDATE public.rapportini_personale SET ore = _ore, nota = _nota, updated_by = _me
          WHERE id = _ex.id;
      END IF;
      _new_id := _ex.id;
    ELSE
      INSERT INTO public.rapportini_personale (
        organization_id, rapportino_id, membro_id, ore, nota, created_by, updated_by
      ) VALUES (_org, _rapportino_id, _membro, _ore, _nota, _me, _me)
      RETURNING id INTO _new_id;
      PERFORM public._log_audit(_org, 'personale_aggiunto_rapportino', 'rapportini_personale', _new_id,
        jsonb_build_object('rapportino_id', _rapportino_id, 'membro_id', _membro, 'ore', _ore));
    END IF;

    _ids := array_append(_ids, _membro);
  END LOOP;

  -- righe rimosse
  FOR _riga IN
    SELECT id FROM public.rapportini_personale
    WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL
      AND NOT (membro_id = ANY(_ids))
  LOOP
    PERFORM public._storna_riga_personale(_riga.id, 'Persona rimossa dal rapportino', true);
    _rimosse := _rimosse + 1;
  END LOOP;

  -- contabilizzazione
  FOR _riga IN
    SELECT id FROM public.rapportini_personale
    WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL
      AND stato_contabilizzazione <> 'contabilizzato'
  LOOP
    PERFORM public._contabilizza_riga_personale(_riga.id);
  END LOOP;

  -- allineamento ore di testata
  SELECT COALESCE(SUM(ore),0)::numeric(8,2) INTO _tot FROM public.rapportini_personale
    WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL;
  IF _tot > 0 THEN
    UPDATE public.rapportini SET ore = _tot WHERE id = _rapportino_id;
  END IF;

  RETURN QUERY
  SELECT COUNT(*)::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'contabilizzato')::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'tariffa_mancante')::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'conflitto_tariffa')::int,
         _rimosse,
         COALESCE(SUM(ore),0)::numeric
  FROM public.rapportini_personale
  WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.save_rapportino_personale(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_rapportino_personale(uuid, jsonb, boolean) TO authenticated;

-- 8. RPC: ricalcolo righe senza tariffa --------------------------------------
CREATE OR REPLACE FUNCTION public.ricalcola_righe_personale_mancanti(
  _dry_run boolean DEFAULT true,
  _riga_ids uuid[] DEFAULT NULL,
  _rapportino_id uuid DEFAULT NULL,
  _membro_id uuid DEFAULT NULL,
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _limit int DEFAULT 500
)
RETURNS TABLE(
  riga_id uuid, rapportino_id uuid, membro_id uuid, membro_nome text, data date,
  ore numeric, tariffa numeric, costo numeric, esito text, motivo text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org UUID; _r RECORD; _n INT; _tar public.personale_costi_orari%ROWTYPE;
  _esito TEXT; _motivo TEXT; _stato TEXT;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF NOT public._rp_can_see_costs(_org) THEN
    RAISE EXCEPTION 'Non sei autorizzato a ricalcolare i costi del personale' USING ERRCODE='42501';
  END IF;

  FOR _r IN
    SELECT rp.id, rp.membro_id AS mid, rp.ore AS ore, rap.data AS data, rap.id AS rid,
           TRIM(COALESCE(m.nome,'') || ' ' || COALESCE(m.cognome,'')) AS nome,
           rap.stato AS rap_stato
    FROM public.rapportini_personale rp
    JOIN public.rapportini rap ON rap.id = rp.rapportino_id
    JOIN public.organization_members m ON m.id = rp.membro_id
    WHERE rp.organization_id = _org
      AND rp.annullato_at IS NULL
      AND rp.stato_contabilizzazione IN ('tariffa_mancante','conflitto_tariffa','da_contabilizzare')
      AND (_riga_ids IS NULL OR rp.id = ANY(_riga_ids))
      AND (_rapportino_id IS NULL OR rp.rapportino_id = _rapportino_id)
      AND (_membro_id IS NULL OR rp.membro_id = _membro_id)
      AND (_date_from IS NULL OR rap.data >= _date_from)
      AND (_date_to IS NULL OR rap.data <= _date_to)
    ORDER BY rap.data DESC
    LIMIT GREATEST(COALESCE(_limit,500), 1)
  LOOP
    _tar := NULL; _motivo := NULL;
    IF _r.rap_stato <> 'approvato' THEN
      _esito := 'escluso'; _motivo := 'Rapportino non approvato';
    ELSE
      _n := public._tariffe_valide_membro(_r.mid, _org, _r.data);
      IF _n > 1 THEN
        _esito := 'conflitto_tariffa'; _motivo := 'Più tariffe valide sovrapposte alla data';
      ELSE
        SELECT * INTO _tar FROM public.get_costo_orario_membro_at_date(_r.mid, _org, _r.data);
        IF _tar.id IS NULL THEN
          _esito := 'tariffa_mancante'; _motivo := 'Nessuna tariffa valida alla data';
        ELSE
          _esito := 'contabilizzabile';
        END IF;
      END IF;
    END IF;

    IF NOT COALESCE(_dry_run, true) AND _esito = 'contabilizzabile' THEN
      _stato := public._contabilizza_riga_personale(_r.id);
      _esito := CASE WHEN _stato = 'contabilizzato' THEN 'contabilizzato' ELSE COALESCE(_stato,'errore') END;
      PERFORM public._log_audit(_org, 'costo_personale_ricalcolato', 'rapportini_personale', _r.id,
        jsonb_build_object('rapportino_id', _r.rid, 'esito', _esito));
    END IF;

    riga_id := _r.id; rapportino_id := _r.rid; membro_id := _r.mid; membro_nome := _r.nome;
    data := _r.data; ore := _r.ore;
    tariffa := _tar.costo_orario;
    costo := CASE WHEN _tar.id IS NOT NULL THEN ROUND(_r.ore * _tar.costo_orario, 2) ELSE NULL END;
    esito := _esito; motivo := _motivo;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ricalcola_righe_personale_mancanti(boolean, uuid[], uuid, uuid, date, date, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ricalcola_righe_personale_mancanti(boolean, uuid[], uuid, uuid, date, date, int) TO authenticated;

-- 9. Contabilizzazione a livello rapportino: usa le righe personale se esistono
CREATE OR REPLACE FUNCTION public.contabilizza_rapportino_personale(_rapportino_id uuid)
RETURNS TABLE(contabilizzate int, tariffa_mancante int, conflitto int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org UUID; _riga RECORD; _ok INT;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT 1 INTO _ok FROM public.rapportini r WHERE r.id = _rapportino_id AND r.organization_id = _org;
  IF _ok IS NULL THEN RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501'; END IF;

  FOR _riga IN
    SELECT id FROM public.rapportini_personale
    WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL
      AND stato_contabilizzazione <> 'contabilizzato'
  LOOP
    PERFORM public._contabilizza_riga_personale(_riga.id);
  END LOOP;

  RETURN QUERY
  SELECT COUNT(*) FILTER (WHERE stato_contabilizzazione = 'contabilizzato')::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'tariffa_mancante')::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'conflitto_tariffa')::int
  FROM public.rapportini_personale
  WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.contabilizza_rapportino_personale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contabilizza_rapportino_personale(uuid) TO authenticated;

-- 10. BACKFILL ----------------------------------------------------------------
DO $backfill$
DECLARE
  _r RECORD; _membro UUID; _rc public.rapportini_costi%ROWTYPE; _new_id UUID; _stato TEXT;
BEGIN
  FOR _r IN SELECT * FROM public.rapportini ORDER BY created_at LOOP
    _membro := public._rap_membro_effettivo(_r.organization_id, _r.membro_id, _r.user_id);
    IF _membro IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.rapportini_personale WHERE rapportino_id = _r.id) THEN CONTINUE; END IF;
    IF _r.ore IS NULL OR _r.ore <= 0 THEN CONTINUE; END IF;

    SELECT * INTO _rc FROM public.rapportini_costi
      WHERE rapportino_id = _r.id AND rapportino_personale_id IS NULL
      ORDER BY (stato = 'contabilizzato' AND stornato_at IS NULL) DESC, created_at DESC
      LIMIT 1;

    IF _r.stato = 'annullato' OR _r.archived_at IS NOT NULL THEN
      _stato := 'annullato';
    ELSIF _rc.id IS NOT NULL AND _rc.stato = 'contabilizzato' AND _rc.stornato_at IS NULL THEN
      _stato := 'contabilizzato';
    ELSIF _rc.id IS NOT NULL AND _rc.stato = 'non_contabilizzato' THEN
      _stato := 'tariffa_mancante';
    ELSE
      _stato := 'da_contabilizzare';
    END IF;

    INSERT INTO public.rapportini_personale (
      organization_id, rapportino_id, membro_id, ore,
      tariffa_id, tariffa_oraria_congelata, costo_congelato,
      stato_contabilizzazione, contabilizzato_at, annullato_at, created_by, updated_by
    ) VALUES (
      _r.organization_id, _r.id, _membro, _r.ore,
      CASE WHEN _stato = 'contabilizzato' THEN _rc.costo_orario_id ELSE NULL END,
      CASE WHEN _stato = 'contabilizzato' THEN _rc.costo_orario_applicato ELSE NULL END,
      CASE WHEN _stato = 'contabilizzato' THEN _rc.costo_totale ELSE NULL END,
      _stato,
      CASE WHEN _stato = 'contabilizzato' THEN _rc.contabilizzato_at ELSE NULL END,
      CASE WHEN _stato = 'annullato' THEN now() ELSE NULL END,
      _r.created_by, _r.created_by
    ) RETURNING id INTO _new_id;

    UPDATE public.rapportini_costi SET rapportino_personale_id = _new_id
      WHERE rapportino_id = _r.id AND rapportino_personale_id IS NULL;
  END LOOP;
END $backfill$;