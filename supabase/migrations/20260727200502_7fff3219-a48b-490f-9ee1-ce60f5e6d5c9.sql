
-- ============================================================================
-- Sprint 5 · Blocco 3 — Costo orario personale + contabilizzazione manodopera
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ensure rapportini has composite unique (id, organization_id) for anti cross-tenant FK
ALTER TABLE public.rapportini ADD CONSTRAINT rapportini_id_org_uq UNIQUE (id, organization_id);
ALTER TABLE public.commessa_budget_voci ADD CONSTRAINT cbv_id_org_uq UNIQUE (id, organization_id);

-- ============================================================================
-- 1. TABELLA personale_costi_orari
-- ============================================================================
CREATE TABLE public.personale_costi_orari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  costo_orario NUMERIC(12,4) NOT NULL CHECK (costo_orario >= 0),
  valido_dal DATE NOT NULL,
  valido_al DATE NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  archived_by UUID NULL,
  CONSTRAINT pco_periodo_chk CHECK (valido_al IS NULL OR valido_al >= valido_dal)
);

CREATE INDEX idx_pco_org ON public.personale_costi_orari (organization_id);
CREATE INDEX idx_pco_user ON public.personale_costi_orari (user_id);
CREATE INDEX idx_pco_valido_dal ON public.personale_costi_orari (valido_dal);
CREATE INDEX idx_pco_valido_al ON public.personale_costi_orari (valido_al);
CREATE INDEX idx_pco_archived ON public.personale_costi_orari (archived_at);
CREATE INDEX idx_pco_user_valido ON public.personale_costi_orari (user_id, valido_dal DESC);

-- Exclusion constraint anti-sovrapposizione (solo record attivi)
ALTER TABLE public.personale_costi_orari
  ADD CONSTRAINT pco_no_overlap EXCLUDE USING gist (
    user_id WITH =,
    organization_id WITH =,
    daterange(valido_dal, COALESCE(valido_al, DATE '9999-12-31'), '[]') WITH &&
  ) WHERE (archived_at IS NULL);

GRANT SELECT ON public.personale_costi_orari TO authenticated;
GRANT ALL ON public.personale_costi_orari TO service_role;

ALTER TABLE public.personale_costi_orari ENABLE ROW LEVEL SECURITY;

CREATE POLICY pco_select ON public.personale_costi_orari
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_organization_id()
    AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore','amministrazione']::app_role[])
  );

-- Trigger updated_at
CREATE TRIGGER tg_pco_updated_at
  BEFORE UPDATE ON public.personale_costi_orari
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================================
-- 2. TABELLA rapportini_costi
-- ============================================================================
CREATE TABLE public.rapportini_costi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rapportino_id UUID NOT NULL,
  commessa_id UUID NOT NULL,
  cantiere_id UUID NULL,
  fase_id UUID NULL,
  user_id UUID NOT NULL,
  ore NUMERIC(8,2) NOT NULL CHECK (ore > 0),
  costo_orario_applicato NUMERIC(12,4) NOT NULL CHECK (costo_orario_applicato >= 0),
  costo_totale NUMERIC(14,2) NOT NULL CHECK (costo_totale >= 0),
  costo_orario_id UUID NULL REFERENCES public.personale_costi_orari(id) ON DELETE SET NULL,
  budget_voce_id UUID NULL,
  stato TEXT NOT NULL CHECK (stato IN ('contabilizzato','stornato','non_contabilizzato')),
  periodo_riferimento DATE NOT NULL, -- primo giorno del mese di riferimento
  contabilizzato_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  contabilizzato_by UUID NOT NULL,
  stornato_at TIMESTAMPTZ NULL,
  stornato_by UUID NULL,
  motivo_storno TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rc_rap_fk FOREIGN KEY (rapportino_id, organization_id) REFERENCES public.rapportini(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT rc_commessa_fk FOREIGN KEY (commessa_id, organization_id) REFERENCES public.commesse(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT rc_cantiere_fk FOREIGN KEY (cantiere_id, organization_id) REFERENCES public.cantieri(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT rc_fase_fk FOREIGN KEY (fase_id, organization_id) REFERENCES public.commessa_fasi(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT rc_bv_fk FOREIGN KEY (budget_voce_id, organization_id) REFERENCES public.commessa_budget_voci(id, organization_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_rc_rapportino_active ON public.rapportini_costi (rapportino_id)
  WHERE stato = 'contabilizzato' AND stornato_at IS NULL;

CREATE INDEX idx_rc_org ON public.rapportini_costi (organization_id);
CREATE INDEX idx_rc_commessa ON public.rapportini_costi (commessa_id);
CREATE INDEX idx_rc_cantiere ON public.rapportini_costi (cantiere_id);
CREATE INDEX idx_rc_fase ON public.rapportini_costi (fase_id);
CREATE INDEX idx_rc_user ON public.rapportini_costi (user_id);
CREATE INDEX idx_rc_stato ON public.rapportini_costi (stato);
CREATE INDEX idx_rc_periodo ON public.rapportini_costi (periodo_riferimento);
CREATE INDEX idx_rc_bv ON public.rapportini_costi (budget_voce_id);
CREATE INDEX idx_rc_aggregate ON public.rapportini_costi (commessa_id, periodo_riferimento, cantiere_id, fase_id) WHERE stato = 'contabilizzato';

GRANT SELECT ON public.rapportini_costi TO authenticated;
GRANT ALL ON public.rapportini_costi TO service_role;

ALTER TABLE public.rapportini_costi ENABLE ROW LEVEL SECURITY;

-- Visibile solo a chi può gestire budget commessa
CREATE POLICY rc_select ON public.rapportini_costi
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_organization_id()
    AND public.can_manage_commessa_budget(commessa_id, 'read')
  );

CREATE TRIGGER tg_rc_updated_at
  BEFORE UPDATE ON public.rapportini_costi
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================================
-- 3. INDICE UNIVOCO per voce Budget aggregata "rapportino"
-- ============================================================================
-- Campo periodo per aggregazione mensile deterministica delle voci fonte='rapportino'
ALTER TABLE public.commessa_budget_voci
  ADD COLUMN IF NOT EXISTS periodo_riferimento DATE NULL;

CREATE UNIQUE INDEX uq_cbv_labor_aggregate ON public.commessa_budget_voci (
  commessa_id,
  COALESCE(cantiere_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(fase_id, '00000000-0000-0000-0000-000000000000'::uuid),
  periodo_riferimento
) WHERE fonte = 'rapportino' AND archived_at IS NULL AND periodo_riferimento IS NOT NULL;

-- ============================================================================
-- 4. HELPER: get_personale_costo_orario_at_date
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_personale_costo_orario_at_date(
  _user_id UUID,
  _org UUID,
  _data DATE
) RETURNS public.personale_costi_orari
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.personale_costi_orari
  WHERE user_id = _user_id
    AND organization_id = _org
    AND archived_at IS NULL
    AND valido_dal <= _data
    AND (valido_al IS NULL OR valido_al >= _data)
  ORDER BY valido_dal DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_personale_costo_orario_at_date(UUID, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_personale_costo_orario_at_date(UUID, UUID, DATE) TO authenticated;

-- ============================================================================
-- 5. RPC create_personale_costo_orario
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_personale_costo_orario(
  _user_id UUID,
  _costo_orario NUMERIC,
  _valido_dal DATE,
  _valido_al DATE DEFAULT NULL,
  _note TEXT DEFAULT NULL
) RETURNS TABLE(id UUID, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _new_id UUID;
  _new_upd TIMESTAMPTZ;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata' USING ERRCODE='42501'; END IF;

  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::app_role[]) THEN
    RAISE EXCEPTION 'Non sei autorizzato a gestire i costi orari' USING ERRCODE='42501';
  END IF;

  IF _costo_orario < 0 THEN RAISE EXCEPTION 'Costo orario negativo non ammesso' USING ERRCODE='22023'; END IF;
  IF _valido_al IS NOT NULL AND _valido_al < _valido_dal THEN
    RAISE EXCEPTION 'Data fine antecedente alla data inizio' USING ERRCODE='22023';
  END IF;

  -- utente stessa organizzazione
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND organization_id = _org) THEN
    RAISE EXCEPTION 'Utente non appartenente a questa organizzazione' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.personale_costi_orari (
    organization_id, user_id, costo_orario, valido_dal, valido_al, note, created_by
  ) VALUES (_org, _user_id, _costo_orario, _valido_dal, _valido_al, NULLIF(btrim(_note),''), _me)
  RETURNING personale_costi_orari.id, personale_costi_orari.updated_at INTO _new_id, _new_upd;

  PERFORM public._log_audit(_org, 'personale.costo_orario.created', 'personale_costi_orari', _new_id,
    jsonb_build_object('user_id', _user_id, 'costo_orario', _costo_orario, 'valido_dal', _valido_dal, 'valido_al', _valido_al));

  RETURN QUERY SELECT _new_id, _new_upd;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'Esiste già un periodo di validità sovrapposto per questo utente' USING ERRCODE='23P01';
END; $$;

REVOKE ALL ON FUNCTION public.create_personale_costo_orario(UUID,NUMERIC,DATE,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_personale_costo_orario(UUID,NUMERIC,DATE,DATE,TEXT) TO authenticated;

-- ============================================================================
-- 6. RPC update_personale_costo_orario
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_personale_costo_orario(
  _id UUID,
  _expected_updated_at TIMESTAMPTZ,
  _costo_orario NUMERIC,
  _valido_dal DATE,
  _valido_al DATE,
  _note TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.personale_costi_orari%ROWTYPE;
  _used BOOLEAN;
  _new_upd TIMESTAMPTZ;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  SELECT * INTO _row FROM public.personale_costi_orari WHERE personale_costi_orari.id = _id FOR UPDATE;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Tariffa non trovata' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tariffa archiviata' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Tariffa modificata da un altro utente. Ricarica i dati.' USING ERRCODE='40001';
  END IF;

  -- Verifica se tariffa già usata da contabilizzazioni attive
  SELECT EXISTS(
    SELECT 1 FROM public.rapportini_costi
    WHERE costo_orario_id = _id AND stato = 'contabilizzato'
  ) INTO _used;

  IF _used AND (_costo_orario <> _row.costo_orario OR _valido_dal <> _row.valido_dal OR _valido_al IS DISTINCT FROM _row.valido_al) THEN
    RAISE EXCEPTION 'Tariffa già utilizzata: chiudi il periodo e crea una nuova tariffa' USING ERRCODE='22023';
  END IF;

  IF _valido_al IS NOT NULL AND _valido_al < _valido_dal THEN
    RAISE EXCEPTION 'Data fine antecedente alla data inizio' USING ERRCODE='22023';
  END IF;

  UPDATE public.personale_costi_orari SET
    costo_orario = _costo_orario,
    valido_dal = _valido_dal,
    valido_al = _valido_al,
    note = NULLIF(btrim(_note),'')
  WHERE personale_costi_orari.id = _id
  RETURNING personale_costi_orari.updated_at INTO _new_upd;

  PERFORM public._log_audit(_org, 'personale.costo_orario.updated', 'personale_costi_orari', _id,
    jsonb_build_object('user_id', _row.user_id, 'costo_orario', _costo_orario));

  RETURN _new_upd;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'Periodo sovrapposto con altra tariffa attiva' USING ERRCODE='23P01';
END; $$;

REVOKE ALL ON FUNCTION public.update_personale_costo_orario(UUID,TIMESTAMPTZ,NUMERIC,DATE,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_personale_costo_orario(UUID,TIMESTAMPTZ,NUMERIC,DATE,DATE,TEXT) TO authenticated;

-- ============================================================================
-- 7. RPC archive/restore_personale_costo_orario
-- ============================================================================
CREATE OR REPLACE FUNCTION public.archive_personale_costo_orario(
  _id UUID,
  _expected_updated_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.personale_costi_orari%ROWTYPE;
  _new_upd TIMESTAMPTZ;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _row FROM public.personale_costi_orari WHERE personale_costi_orari.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN RAISE EXCEPTION 'Tariffa non trovata' USING ERRCODE='42501'; END IF;
  IF _row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Tariffa già archiviata' USING ERRCODE='22023'; END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Tariffa modificata da un altro utente' USING ERRCODE='40001';
  END IF;

  UPDATE public.personale_costi_orari SET archived_at = now(), archived_by = _me
  WHERE personale_costi_orari.id = _id
  RETURNING personale_costi_orari.updated_at INTO _new_upd;

  PERFORM public._log_audit(_org, 'personale.costo_orario.archived', 'personale_costi_orari', _id,
    jsonb_build_object('user_id', _row.user_id));
  RETURN _new_upd;
END; $$;

REVOKE ALL ON FUNCTION public.archive_personale_costo_orario(UUID,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_personale_costo_orario(UUID,TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_personale_costo_orario(
  _id UUID,
  _expected_updated_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.personale_costi_orari%ROWTYPE;
  _new_upd TIMESTAMPTZ;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _row FROM public.personale_costi_orari WHERE personale_costi_orari.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN RAISE EXCEPTION 'Tariffa non trovata' USING ERRCODE='42501'; END IF;
  IF _row.archived_at IS NULL THEN RAISE EXCEPTION 'Tariffa già attiva' USING ERRCODE='22023'; END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Tariffa modificata da un altro utente' USING ERRCODE='40001';
  END IF;

  UPDATE public.personale_costi_orari SET archived_at = NULL, archived_by = NULL
  WHERE personale_costi_orari.id = _id
  RETURNING personale_costi_orari.updated_at INTO _new_upd;

  PERFORM public._log_audit(_org, 'personale.costo_orario.restored', 'personale_costi_orari', _id, '{}'::jsonb);
  RETURN _new_upd;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'Ripristino non possibile: sovrapposizione con altre tariffe attive' USING ERRCODE='23P01';
END; $$;

REVOKE ALL ON FUNCTION public.restore_personale_costo_orario(UUID,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_personale_costo_orario(UUID,TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- 8. HELPER interno: recalculate_labor_budget_voce
-- ============================================================================
CREATE OR REPLACE FUNCTION public._recalculate_labor_budget_voce(
  _commessa_id UUID,
  _cantiere_id UUID,
  _fase_id UUID,
  _periodo DATE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org UUID;
  _voce_id UUID;
  _somma NUMERIC(14,2);
  _n INT;
  _mese_label TEXT;
  _modalita TEXT;
BEGIN
  SELECT organization_id, budget_modalita INTO _org, _modalita
  FROM public.commesse WHERE id = _commessa_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='42501'; END IF;

  -- Solo modalità analitico crea/aggiorna voci automatiche
  IF _modalita <> 'analitico' THEN
    RETURN NULL;
  END IF;

  -- Lock su commessa per prevenire concorrenza
  PERFORM 1 FROM public.commesse WHERE id = _commessa_id FOR UPDATE;

  -- Somma contabilizzazioni attive per il gruppo
  SELECT COALESCE(SUM(costo_totale),0)::NUMERIC(14,2), COUNT(*)
  INTO _somma, _n
  FROM public.rapportini_costi
  WHERE commessa_id = _commessa_id
    AND COALESCE(cantiere_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_cantiere_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(fase_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_fase_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND periodo_riferimento = _periodo
    AND stato = 'contabilizzato';

  _mese_label := to_char(_periodo, 'FMMonth YYYY');

  -- Cerca voce esistente
  SELECT id INTO _voce_id FROM public.commessa_budget_voci
  WHERE commessa_id = _commessa_id
    AND COALESCE(cantiere_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_cantiere_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(fase_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_fase_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND fonte = 'rapportino'
    AND periodo_riferimento = _periodo
    AND archived_at IS NULL
  FOR UPDATE;

  IF _voce_id IS NULL AND _n > 0 THEN
    INSERT INTO public.commessa_budget_voci (
      organization_id, commessa_id, cantiere_id, fase_id,
      tipo, categoria, descrizione, importo_previsto, importo_impegnato,
      importo_sostenuto, costo_residuo_stimato, fonte, is_locked,
      periodo_riferimento, posizione, created_by
    ) VALUES (
      _org, _commessa_id, _cantiere_id, _fase_id,
      'costo', 'manodopera',
      'Manodopera interna — ' || _mese_label,
      0, 0, _somma, 0, 'rapportino', true,
      _periodo, 0, auth.uid()
    ) RETURNING id INTO _voce_id;

    PERFORM public._log_audit(_org, 'budget.labor_voce_created', 'commessa_budget_voci', _voce_id,
      jsonb_build_object('commessa_id', _commessa_id, 'periodo', _periodo, 'somma', _somma));

  ELSIF _voce_id IS NOT NULL THEN
    IF _n = 0 THEN
      -- Nessuna contabilizzazione attiva: archivia
      UPDATE public.commessa_budget_voci SET
        archived_at = now(), archived_by = auth.uid(), importo_sostenuto = 0
      WHERE id = _voce_id;
      PERFORM public._log_audit(_org, 'budget.labor_voce_archived', 'commessa_budget_voci', _voce_id, '{}'::jsonb);
    ELSE
      UPDATE public.commessa_budget_voci SET
        importo_sostenuto = _somma,
        descrizione = 'Manodopera interna — ' || _mese_label
      WHERE id = _voce_id;
      PERFORM public._log_audit(_org, 'budget.labor_voce_updated', 'commessa_budget_voci', _voce_id,
        jsonb_build_object('somma', _somma, 'n_rapportini', _n));
    END IF;
  END IF;

  -- Aggiorna riferimento budget_voce_id su tutte le contabilizzazioni del gruppo
  IF _voce_id IS NOT NULL THEN
    UPDATE public.rapportini_costi SET budget_voce_id = _voce_id
    WHERE commessa_id = _commessa_id
      AND COALESCE(cantiere_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_cantiere_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(fase_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_fase_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND periodo_riferimento = _periodo
      AND (budget_voce_id IS DISTINCT FROM _voce_id);
  END IF;

  -- Ricalcolo commessa una sola volta
  PERFORM public.recalculate_commessa_budget(_commessa_id);

  RETURN _voce_id;
END; $$;

REVOKE ALL ON FUNCTION public._recalculate_labor_budget_voce(UUID,UUID,UUID,DATE) FROM PUBLIC;
-- solo callable internamente (via SECURITY DEFINER da altre RPC)

-- ============================================================================
-- 9. RPC contabilizza_rapportino_manodopera (idempotente)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.contabilizza_rapportino_manodopera(
  _rapportino_id UUID
) RETURNS TABLE(rapportino_costo_id UUID, stato TEXT, warning TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _rap public.rapportini%ROWTYPE;
  _tariffa public.personale_costi_orari%ROWTYPE;
  _existing public.rapportini_costi%ROWTYPE;
  _costo_tot NUMERIC(14,2);
  _periodo DATE;
  _modalita TEXT;
  _new_id UUID;
  _warn TEXT := NULL;
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

  -- Idempotenza: se esiste già una contabilizzazione attiva, restituisci quella
  SELECT * INTO _existing FROM public.rapportini_costi
  WHERE rapportino_id = _rapportino_id AND stato = 'contabilizzato' AND stornato_at IS NULL
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT _existing.id, _existing.stato, 'Già contabilizzato'::TEXT;
    RETURN;
  END IF;

  -- Se esiste un record 'non_contabilizzato' precedente, lo sovrascriviamo con nuovo tentativo
  DELETE FROM public.rapportini_costi
  WHERE rapportino_id = _rapportino_id AND stato = 'non_contabilizzato';

  _periodo := date_trunc('month', _rap.data)::date;

  -- Cerca tariffa
  SELECT * INTO _tariffa FROM public.get_personale_costo_orario_at_date(_rap.user_id, _org, _rap.data);

  SELECT budget_modalita INTO _modalita FROM public.commesse WHERE id = _rap.commessa_id;

  IF _tariffa.id IS NULL THEN
    -- Tariffa mancante → non_contabilizzato
    INSERT INTO public.rapportini_costi (
      organization_id, rapportino_id, commessa_id, cantiere_id, fase_id, user_id,
      ore, costo_orario_applicato, costo_totale, costo_orario_id,
      stato, periodo_riferimento, contabilizzato_by
    ) VALUES (
      _org, _rapportino_id, _rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _rap.user_id,
      _rap.ore, 0, 0, NULL,
      'non_contabilizzato', _periodo, _me
    ) RETURNING id INTO _new_id;

    PERFORM public._log_audit(_org, 'rapportino.labor_cost_pending', 'rapportini_costi', _new_id,
      jsonb_build_object('rapportino_id', _rapportino_id, 'motivo', 'tariffa_mancante'));
    RETURN QUERY SELECT _new_id, 'non_contabilizzato'::TEXT, 'Costo orario non configurato per l''utente alla data del rapportino'::TEXT;
    RETURN;
  END IF;

  _costo_tot := ROUND(_rap.ore * _tariffa.costo_orario, 2);

  INSERT INTO public.rapportini_costi (
    organization_id, rapportino_id, commessa_id, cantiere_id, fase_id, user_id,
    ore, costo_orario_applicato, costo_totale, costo_orario_id,
    stato, periodo_riferimento, contabilizzato_by
  ) VALUES (
    _org, _rapportino_id, _rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _rap.user_id,
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
END; $$;

REVOKE ALL ON FUNCTION public.contabilizza_rapportino_manodopera(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contabilizza_rapportino_manodopera(UUID) TO authenticated;

-- ============================================================================
-- 10. MODIFICA approve_rapportino → contabilizza automaticamente
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_rapportino(_id uuid, _expected_updated_at timestamp with time zone, _note text DEFAULT NULL::text)
RETURNS TABLE(id uuid, stato text, updated_at timestamp with time zone, transition_at timestamp with time zone, transition_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _now TIMESTAMPTZ := now();
  _is_prop_admin BOOLEAN;
  _can_approve BOOLEAN := false;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.stato = 'approvato' THEN
    RAISE EXCEPTION 'Il rapportino è già stato approvato' USING ERRCODE='22023';
  END IF;
  IF _row.stato <> 'inviato' THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _is_prop_admin := public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]);

  IF _is_prop_admin OR public.has_any_role(_org, ARRAY['ufficio_tecnico']::app_role[]) THEN
    _can_approve := true;
  ELSIF public.has_any_role(_org, ARRAY['responsabile_commessa']::app_role[]) AND public.can_access_commessa(_row.commessa_id) THEN
    _can_approve := true;
  ELSIF public.has_any_role(_org, ARRAY['capocantiere']::app_role[]) AND _row.cantiere_id IS NOT NULL AND public.is_capocantiere_di(_row.cantiere_id) THEN
    _can_approve := true;
  END IF;

  IF NOT _can_approve THEN
    RAISE EXCEPTION 'Non sei autorizzato ad approvare questo rapportino' USING ERRCODE='42501';
  END IF;

  IF NOT _is_prop_admin AND (_row.user_id = _me OR _row.created_by = _me) THEN
    RAISE EXCEPTION 'Non puoi approvare un rapportino creato da te o intestato a te stesso' USING ERRCODE='42501';
  END IF;

  UPDATE public.rapportini SET
    stato = 'approvato',
    approved_at = _now,
    approved_by = _me
  WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.approved', 'rapportini', _id,
    jsonb_build_object('by', _me, 'note', _note));

  -- Contabilizzazione manodopera (non blocca in caso di tariffa mancante o budget manuale)
  BEGIN
    PERFORM public.contabilizza_rapportino_manodopera(_id);
  EXCEPTION WHEN OTHERS THEN
    -- errori di sicurezza/coerenza: rollback
    RAISE;
  END;

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, r.approved_at, r.approved_by
    FROM public.rapportini r WHERE r.id = _id;
END; $function$;

-- ============================================================================
-- 11. MODIFICA cancel_rapportino → storna contabilizzazione
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_rapportino(_id uuid, _expected_updated_at timestamp with time zone, _reason text)
RETURNS TABLE(id uuid, stato text, updated_at timestamp with time zone, transition_at timestamp with time zone, transition_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _now TIMESTAMPTZ := now();
  _is_prop_admin BOOLEAN;
  _reason_norm TEXT;
  _can BOOLEAN := false;
  _rc public.rapportini_costi%ROWTYPE;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.stato = 'annullato' THEN
    RAISE EXCEPTION 'Il rapportino è già annullato' USING ERRCODE='22023';
  END IF;
  IF _row.stato NOT IN ('bozza','inviato','approvato') THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _reason_norm := btrim(COALESCE(_reason, ''));
  IF length(_reason_norm) < 5 THEN
    RAISE EXCEPTION 'Inserisci una motivazione (minimo 5 caratteri)' USING ERRCODE='22023';
  END IF;
  IF length(_reason_norm) > 1000 THEN
    RAISE EXCEPTION 'Motivazione troppo lunga (massimo 1000 caratteri)' USING ERRCODE='22023';
  END IF;

  _is_prop_admin := public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]);

  IF _row.stato = 'bozza' THEN
    IF _row.user_id = _me OR _row.created_by = _me OR _is_prop_admin THEN _can := true; END IF;
  ELSE
    _can := _is_prop_admin;
  END IF;

  IF NOT _can THEN
    RAISE EXCEPTION 'Non sei autorizzato ad annullare questo rapportino' USING ERRCODE='42501';
  END IF;

  UPDATE public.rapportini SET
    stato = 'annullato',
    cancelled_at = _now,
    cancelled_by = _me,
    cancellation_reason = _reason_norm
  WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.cancelled', 'rapportini', _id,
    jsonb_build_object('by', _me, 'reason', _reason_norm, 'stato_precedente', _row.stato));

  -- Storna eventuali contabilizzazioni attive
  FOR _rc IN
    SELECT * FROM public.rapportini_costi
    WHERE rapportino_id = _id AND stato = 'contabilizzato' AND stornato_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.rapportini_costi SET
      stato = 'stornato',
      stornato_at = _now,
      stornato_by = _me,
      motivo_storno = 'Rapportino annullato: ' || _reason_norm
    WHERE rapportini_costi.id = _rc.id;

    PERFORM public._log_audit(_org, 'rapportino.labor_cost_reversed', 'rapportini_costi', _rc.id,
      jsonb_build_object('rapportino_id', _id, 'motivo', _reason_norm));

    -- Ricalcolo voce aggregata
    PERFORM public._recalculate_labor_budget_voce(_rc.commessa_id, _rc.cantiere_id, _rc.fase_id, _rc.periodo_riferimento);
  END LOOP;

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, r.cancelled_at, r.cancelled_by
    FROM public.rapportini r WHERE r.id = _id;
END; $function$;

-- ============================================================================
-- 12. RPC contabilizza_rapportini_pendenti (massiva)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.contabilizza_rapportini_pendenti(
  _user_id UUID DEFAULT NULL,
  _commessa_id UUID DEFAULT NULL,
  _date_from DATE DEFAULT NULL,
  _date_to DATE DEFAULT NULL,
  _limit INT DEFAULT 100
) RETURNS TABLE(processati INT, contabilizzati INT, gia_contabilizzati INT, senza_tariffa INT, budget_manuale INT, errori INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _rap RECORD;
  _res RECORD;
  _c_proc INT := 0; _c_ok INT := 0; _c_prev INT := 0;
  _c_notar INT := 0; _c_man INT := 0; _c_err INT := 0;
  _modalita TEXT;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  FOR _rap IN
    SELECT r.id, r.commessa_id FROM public.rapportini r
    WHERE r.organization_id = _org
      AND r.stato = 'approvato'
      AND r.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.rapportini_costi rc
        WHERE rc.rapportino_id = r.id AND rc.stato = 'contabilizzato' AND rc.stornato_at IS NULL
      )
      AND (_user_id IS NULL OR r.user_id = _user_id)
      AND (_commessa_id IS NULL OR r.commessa_id = _commessa_id)
      AND (_date_from IS NULL OR r.data >= _date_from)
      AND (_date_to IS NULL OR r.data <= _date_to)
    ORDER BY r.data ASC
    LIMIT COALESCE(_limit, 100)
  LOOP
    _c_proc := _c_proc + 1;
    BEGIN
      SELECT * INTO _res FROM public.contabilizza_rapportino_manodopera(_rap.id) LIMIT 1;
      IF _res.stato = 'contabilizzato' THEN
        SELECT budget_modalita INTO _modalita FROM public.commesse WHERE id = _rap.commessa_id;
        IF _modalita = 'manuale' THEN _c_man := _c_man + 1; ELSE _c_ok := _c_ok + 1; END IF;
      ELSIF _res.stato = 'non_contabilizzato' THEN
        _c_notar := _c_notar + 1;
      ELSE
        _c_prev := _c_prev + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _c_err := _c_err + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT _c_proc, _c_ok, _c_prev, _c_notar, _c_man, _c_err;
END; $$;

REVOKE ALL ON FUNCTION public.contabilizza_rapportini_pendenti(UUID,UUID,DATE,DATE,INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contabilizza_rapportini_pendenti(UUID,UUID,DATE,DATE,INT) TO authenticated;
