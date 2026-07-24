-- =====================================================================
-- s4_08_commessa_budget_voci
-- Blocco 6b: Budget analitico di commessa
-- =====================================================================

-- --------------------------------------------------------------
-- 0. Snapshot storico per guardia integrità
-- --------------------------------------------------------------
CREATE TEMP TABLE _commesse_snapshot AS
SELECT id, importo, importo_contratto, ricavi_previsti, costi_previsti,
       costi_impegnati, costi_sostenuti, margine_previsto, margine_aggiornato,
       margine_percentuale, budget_costi
FROM public.commesse;

-- --------------------------------------------------------------
-- 1. Unique composite mancanti (per FK composite)
-- --------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='preventivo_voci_id_org_uniq') THEN
    ALTER TABLE public.preventivo_voci
      ADD CONSTRAINT preventivo_voci_id_org_uniq UNIQUE (id, organization_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commessa_fasi_id_org_uniq') THEN
    ALTER TABLE public.commessa_fasi
      ADD CONSTRAINT commessa_fasi_id_org_uniq UNIQUE (id, organization_id);
  END IF;
END $$;

-- --------------------------------------------------------------
-- 2. Nuove colonne su commesse
-- --------------------------------------------------------------
ALTER TABLE public.commesse
  ADD COLUMN IF NOT EXISTS ricavi_acquisiti NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS extra_approvati NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_non_approvati NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ricavi_aggiornati NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS costi_residui_stimati NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_aggiornato NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS margine_percentuale_aggiornato NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS scostamento_costi NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS scostamento_ricavi NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS scostamento_margine NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS budget_modalita TEXT NOT NULL DEFAULT 'manuale',
  ADD COLUMN IF NOT EXISTS budget_calcolato_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS baseline_preventivo_id UUID NULL,
  ADD COLUMN IF NOT EXISTS baseline_ricavi NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS baseline_costi NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS baseline_margine NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS baseline_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS baseline_created_by UUID NULL;

-- CHECK constraints (idempotenti)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_extra_approvati_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_extra_approvati_nn CHECK (extra_approvati >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_extra_non_approvati_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_extra_non_approvati_nn CHECK (extra_non_approvati >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_ricavi_acquisiti_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_ricavi_acquisiti_nn CHECK (ricavi_acquisiti IS NULL OR ricavi_acquisiti >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_ricavi_aggiornati_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_ricavi_aggiornati_nn CHECK (ricavi_aggiornati IS NULL OR ricavi_aggiornati >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_costi_residui_stimati_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_costi_residui_stimati_nn CHECK (costi_residui_stimati >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_costo_aggiornato_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_costo_aggiornato_nn CHECK (costo_aggiornato IS NULL OR costo_aggiornato >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_budget_modalita_chk') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_budget_modalita_chk CHECK (budget_modalita IN ('manuale','analitico'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_baseline_preventivo_fk') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_baseline_preventivo_fk
      FOREIGN KEY (baseline_preventivo_id, organization_id)
      REFERENCES public.preventivi (id, organization_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_baseline_created_by_fk') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_baseline_created_by_fk
      FOREIGN KEY (baseline_created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill conservativo
UPDATE public.commesse
SET budget_modalita = COALESCE(NULLIF(budget_modalita,''), 'manuale'),
    extra_approvati = COALESCE(extra_approvati, 0),
    extra_non_approvati = COALESCE(extra_non_approvati, 0),
    costi_residui_stimati = COALESCE(costi_residui_stimati, 0);

-- Guardia: nessun valore economico storico deve essere cambiato
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT s.id
    FROM _commesse_snapshot s
    JOIN public.commesse c ON c.id = s.id
    WHERE s.importo IS DISTINCT FROM c.importo
       OR s.importo_contratto IS DISTINCT FROM c.importo_contratto
       OR s.ricavi_previsti IS DISTINCT FROM c.ricavi_previsti
       OR s.costi_previsti IS DISTINCT FROM c.costi_previsti
       OR s.costi_impegnati IS DISTINCT FROM c.costi_impegnati
       OR s.costi_sostenuti IS DISTINCT FROM c.costi_sostenuti
       OR s.margine_previsto IS DISTINCT FROM c.margine_previsto
       OR s.margine_aggiornato IS DISTINCT FROM c.margine_aggiornato
       OR s.margine_percentuale IS DISTINCT FROM c.margine_percentuale
       OR s.budget_costi IS DISTINCT FROM c.budget_costi
  LOOP
    RAISE EXCEPTION 'Backfill ha alterato valori storici commessa %', r.id;
  END LOOP;
END $$;

-- --------------------------------------------------------------
-- 3. Tabella commessa_budget_voci
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commessa_budget_voci (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commessa_id UUID NOT NULL,
  cantiere_id UUID NULL,
  fase_id UUID NULL,
  tipo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  sottocategoria TEXT NULL,
  codice TEXT NULL,
  descrizione TEXT NOT NULL,
  unita_misura TEXT NULL,
  quantita NUMERIC NULL,
  prezzo_unitario NUMERIC NULL,
  importo_previsto NUMERIC NOT NULL DEFAULT 0,
  importo_impegnato NUMERIC NOT NULL DEFAULT 0,
  importo_sostenuto NUMERIC NOT NULL DEFAULT 0,
  costo_residuo_stimato NUMERIC NOT NULL DEFAULT 0,
  fonte TEXT NOT NULL DEFAULT 'manuale',
  preventivo_voce_id UUID NULL,
  fornitore_id UUID NULL,
  note TEXT NULL,
  posizione INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  archived_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT cbv_commessa_fk FOREIGN KEY (commessa_id, organization_id)
    REFERENCES public.commesse(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cbv_cantiere_fk FOREIGN KEY (cantiere_id, organization_id)
    REFERENCES public.cantieri(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT cbv_fase_fk FOREIGN KEY (fase_id, organization_id)
    REFERENCES public.commessa_fasi(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT cbv_fornitore_fk FOREIGN KEY (fornitore_id, organization_id)
    REFERENCES public.fornitori(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT cbv_preventivo_voce_fk FOREIGN KEY (preventivo_voce_id, organization_id)
    REFERENCES public.preventivo_voci(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT cbv_tipo_chk CHECK (tipo IN ('ricavo','costo')),
  CONSTRAINT cbv_fonte_chk CHECK (fonte IN ('preventivo','manuale','rapportino','acquisto','fattura','variante','altro')),
  CONSTRAINT cbv_categoria_chk CHECK (
    (tipo='costo'  AND categoria IN ('manodopera','materiali','subappalti','noleggi','mezzi','trasporti','consulenze','sicurezza','smaltimenti','utenze','spese_generali','imprevisti','altro'))
    OR
    (tipo='ricavo' AND categoria IN ('contratto','extra_approvato','extra_non_approvato','variante','rimborso','altro'))
  ),
  CONSTRAINT cbv_desc_nonempty CHECK (length(btrim(descrizione)) > 0),
  CONSTRAINT cbv_posizione_nn CHECK (posizione >= 0),
  CONSTRAINT cbv_quantita_nn CHECK (quantita IS NULL OR quantita >= 0),
  CONSTRAINT cbv_prezzo_nn CHECK (prezzo_unitario IS NULL OR prezzo_unitario >= 0),
  CONSTRAINT cbv_importo_previsto_nn CHECK (importo_previsto >= 0),
  CONSTRAINT cbv_importo_impegnato_nn CHECK (importo_impegnato >= 0),
  CONSTRAINT cbv_importo_sostenuto_nn CHECK (importo_sostenuto >= 0),
  CONSTRAINT cbv_residuo_nn CHECK (costo_residuo_stimato >= 0),
  CONSTRAINT cbv_ricavo_no_sostenuto CHECK (tipo <> 'ricavo' OR (importo_sostenuto = 0 AND costo_residuo_stimato = 0))
);

-- Indici
CREATE INDEX IF NOT EXISTS idx_cbv_org ON public.commessa_budget_voci(organization_id);
CREATE INDEX IF NOT EXISTS idx_cbv_commessa ON public.commessa_budget_voci(commessa_id);
CREATE INDEX IF NOT EXISTS idx_cbv_cantiere ON public.commessa_budget_voci(cantiere_id);
CREATE INDEX IF NOT EXISTS idx_cbv_fase ON public.commessa_budget_voci(fase_id);
CREATE INDEX IF NOT EXISTS idx_cbv_fornitore ON public.commessa_budget_voci(fornitore_id);
CREATE INDEX IF NOT EXISTS idx_cbv_tipo ON public.commessa_budget_voci(tipo);
CREATE INDEX IF NOT EXISTS idx_cbv_categoria ON public.commessa_budget_voci(categoria);
CREATE INDEX IF NOT EXISTS idx_cbv_fonte ON public.commessa_budget_voci(fonte);
CREATE INDEX IF NOT EXISTS idx_cbv_commessa_archived ON public.commessa_budget_voci(commessa_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_cbv_commessa_tipo ON public.commessa_budget_voci(commessa_id, tipo);
CREATE INDEX IF NOT EXISTS idx_cbv_commessa_categoria ON public.commessa_budget_voci(commessa_id, categoria);
CREATE INDEX IF NOT EXISTS idx_cbv_preventivo_voce ON public.commessa_budget_voci(preventivo_voce_id);
CREATE INDEX IF NOT EXISTS idx_cbv_updated ON public.commessa_budget_voci(updated_at);

-- Unique parziale: evita doppio import della stessa preventivo_voce nella stessa commessa (attive, fonte=preventivo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cbv_prev_voce_active
  ON public.commessa_budget_voci(commessa_id, preventivo_voce_id)
  WHERE preventivo_voce_id IS NOT NULL AND archived_at IS NULL AND fonte='preventivo';

-- Trigger updated_at (riusa handler generico se esiste, altrimenti crea)
CREATE OR REPLACE FUNCTION public.tg_cbv_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_cbv_updated_at ON public.commessa_budget_voci;
CREATE TRIGGER trg_cbv_updated_at BEFORE UPDATE ON public.commessa_budget_voci
FOR EACH ROW EXECUTE FUNCTION public.tg_cbv_set_updated_at();

-- Trigger di coerenza cross-tenant e appartenenza
CREATE OR REPLACE FUNCTION public.tg_cbv_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_org UUID; v_prev UUID; v_cant_commessa UUID; v_fase_commessa UUID; v_fase_cantiere UUID;
BEGIN
  -- commessa in stessa org
  SELECT organization_id INTO v_org FROM public.commesse WHERE id = NEW.commessa_id;
  IF v_org IS NULL OR v_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'Commessa non appartiene all''organizzazione';
  END IF;
  -- cantiere ⊂ commessa
  IF NEW.cantiere_id IS NOT NULL THEN
    SELECT commessa_id INTO v_cant_commessa FROM public.cantieri WHERE id = NEW.cantiere_id;
    IF v_cant_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'Cantiere non appartiene alla commessa';
    END IF;
  END IF;
  -- fase ⊂ commessa e cantiere coerente
  IF NEW.fase_id IS NOT NULL THEN
    SELECT commessa_id, cantiere_id INTO v_fase_commessa, v_fase_cantiere FROM public.commessa_fasi WHERE id = NEW.fase_id;
    IF v_fase_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'Fase non appartiene alla commessa';
    END IF;
    IF NEW.cantiere_id IS NOT NULL AND v_fase_cantiere IS NOT NULL AND v_fase_cantiere <> NEW.cantiere_id THEN
      RAISE EXCEPTION 'Cantiere della voce non coerente con quello della fase';
    END IF;
  END IF;
  -- preventivo_voce ⊂ preventivo collegato alla commessa
  IF NEW.preventivo_voce_id IS NOT NULL THEN
    SELECT pv.preventivo_id INTO v_prev FROM public.preventivo_voci pv WHERE pv.id = NEW.preventivo_voce_id;
    IF v_prev IS NULL OR v_prev <> (SELECT preventivo_id FROM public.commesse WHERE id = NEW.commessa_id) THEN
      RAISE EXCEPTION 'Voce di preventivo non appartiene al preventivo della commessa';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cbv_validate ON public.commessa_budget_voci;
CREATE TRIGGER trg_cbv_validate BEFORE INSERT OR UPDATE ON public.commessa_budget_voci
FOR EACH ROW EXECUTE FUNCTION public.tg_cbv_validate();

-- --------------------------------------------------------------
-- 4. GRANT / RLS
-- --------------------------------------------------------------
GRANT SELECT ON public.commessa_budget_voci TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.commessa_budget_voci FROM authenticated;
GRANT ALL ON public.commessa_budget_voci TO service_role;

ALTER TABLE public.commessa_budget_voci ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cbv_select_econ ON public.commessa_budget_voci;
CREATE POLICY cbv_select_econ ON public.commessa_budget_voci
FOR SELECT TO authenticated
USING (
  public.can_access_commessa(commessa_id)
  AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa']::public.app_role[])
);

-- --------------------------------------------------------------
-- 5. Helper autorizzazione budget
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_commessa_budget(_commessa_id UUID, _operation TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid UUID; v_org UUID; v_stato TEXT; v_active BOOLEAN; v_resp UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT organization_id, stato::text, responsabile_id INTO v_org, v_stato, v_resp
    FROM public.commesse WHERE id = _commessa_id;
  IF v_org IS NULL THEN RETURN false; END IF;
  SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;
  IF COALESCE(v_active,false) = false THEN RETURN false; END IF;
  IF v_stato IN ('chiusa','archiviata','completata') THEN RETURN false; END IF;
  -- Ruoli abilitati sempre
  IF public.has_any_role(v_org, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::public.app_role[]) THEN
    RETURN true;
  END IF;
  -- Responsabile commessa solo sulle proprie
  IF public.has_any_role(v_org, ARRAY['responsabile_commessa']::public.app_role[])
     AND v_resp = v_uid THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;

REVOKE EXECUTE ON FUNCTION public.can_manage_commessa_budget(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_commessa_budget(UUID,TEXT) TO authenticated;

-- --------------------------------------------------------------
-- 6. Audit helper
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cbv_audit(_org UUID, _entity_id UUID, _action TEXT, _meta JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.audit_log(organization_id, user_id, action, entity, entity_id, metadata)
  VALUES (_org, auth.uid(), _action, 'commessa', _entity_id, COALESCE(_meta,'{}'::jsonb));
END $$;
REVOKE EXECUTE ON FUNCTION public._cbv_audit(UUID,UUID,TEXT,JSONB) FROM PUBLIC;

-- --------------------------------------------------------------
-- 7. Ricalcolo analitico
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_commessa_budget(_commessa_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_org UUID; v_mod TEXT;
  v_ric_prev NUMERIC := 0; v_ric_acq NUMERIC := 0; v_extra_appr NUMERIC := 0; v_extra_nappr NUMERIC := 0;
  v_costi_prev NUMERIC := 0; v_costi_imp NUMERIC := 0; v_costi_sost NUMERIC := 0; v_costi_res NUMERIC := 0;
  v_costo_agg NUMERIC := 0; v_ricavi_agg NUMERIC := 0;
  v_marg_prev NUMERIC; v_marg_agg NUMERIC; v_marg_pct NUMERIC; v_marg_pct_agg NUMERIC;
  v_sc_costi NUMERIC; v_sc_ricavi NUMERIC; v_sc_margine NUMERIC;
BEGIN
  SELECT organization_id, budget_modalita INTO v_org, v_mod FROM public.commesse WHERE id = _commessa_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Commessa inesistente'; END IF;
  IF v_mod <> 'analitico' THEN RETURN; END IF;

  -- Ricavi
  SELECT
    COALESCE(SUM(importo_previsto) FILTER (WHERE tipo='ricavo'), 0),
    COALESCE(SUM(importo_impegnato) FILTER (WHERE tipo='ricavo' AND categoria='contratto'), 0),
    COALESCE(SUM(importo_impegnato) FILTER (WHERE tipo='ricavo' AND categoria IN ('extra_approvato','variante')), 0),
    COALESCE(SUM(importo_previsto) FILTER (WHERE tipo='ricavo' AND categoria='extra_non_approvato'), 0)
  INTO v_ric_prev, v_ric_acq, v_extra_appr, v_extra_nappr
  FROM public.commessa_budget_voci
  WHERE commessa_id = _commessa_id AND archived_at IS NULL;

  -- Costi
  SELECT
    COALESCE(SUM(importo_previsto) FILTER (WHERE tipo='costo'), 0),
    COALESCE(SUM(importo_impegnato) FILTER (WHERE tipo='costo'), 0),
    COALESCE(SUM(importo_sostenuto) FILTER (WHERE tipo='costo'), 0),
    COALESCE(SUM(costo_residuo_stimato) FILTER (WHERE tipo='costo'), 0),
    COALESCE(SUM(
      importo_sostenuto + GREATEST(importo_impegnato - importo_sostenuto, 0) + costo_residuo_stimato
    ) FILTER (WHERE tipo='costo'), 0)
  INTO v_costi_prev, v_costi_imp, v_costi_sost, v_costi_res, v_costo_agg
  FROM public.commessa_budget_voci
  WHERE commessa_id = _commessa_id AND archived_at IS NULL;

  v_ricavi_agg   := v_ric_acq + v_extra_appr;
  v_marg_prev    := v_ric_prev - v_costi_prev;
  v_marg_agg     := v_ricavi_agg - v_costo_agg;
  v_marg_pct     := CASE WHEN v_ric_prev > 0 THEN (v_marg_prev / v_ric_prev) * 100 ELSE 0 END;
  v_marg_pct_agg := CASE WHEN v_ricavi_agg > 0 THEN (v_marg_agg / v_ricavi_agg) * 100 ELSE 0 END;
  v_sc_costi     := v_costo_agg - v_costi_prev;
  v_sc_ricavi    := v_ricavi_agg - v_ric_prev;
  v_sc_margine   := v_marg_agg - v_marg_prev;

  UPDATE public.commesse SET
    ricavi_previsti = v_ric_prev,
    ricavi_acquisiti = v_ric_acq,
    extra_approvati = v_extra_appr,
    extra_non_approvati = v_extra_nappr,
    ricavi_aggiornati = v_ricavi_agg,
    costi_previsti = v_costi_prev,
    costi_impegnati = v_costi_imp,
    costi_sostenuti = v_costi_sost,
    costi_residui_stimati = v_costi_res,
    costo_aggiornato = v_costo_agg,
    margine_previsto = v_marg_prev,
    margine_aggiornato = v_marg_agg,
    margine_percentuale = v_marg_pct,
    margine_percentuale_aggiornato = v_marg_pct_agg,
    scostamento_costi = v_sc_costi,
    scostamento_ricavi = v_sc_ricavi,
    scostamento_margine = v_sc_margine,
    budget_calcolato_at = now(),
    updated_at = now()
  WHERE id = _commessa_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.recalculate_commessa_budget(UUID) FROM PUBLIC;

-- --------------------------------------------------------------
-- 8. RPC: create voce
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_commessa_budget_voce(
  _commessa_id UUID, _expected_updated_at TIMESTAMPTZ,
  _tipo TEXT, _categoria TEXT, _descrizione TEXT,
  _sottocategoria TEXT DEFAULT NULL, _codice TEXT DEFAULT NULL, _unita TEXT DEFAULT NULL,
  _quantita NUMERIC DEFAULT NULL, _prezzo_unitario NUMERIC DEFAULT NULL,
  _importo_previsto NUMERIC DEFAULT NULL,
  _importo_impegnato NUMERIC DEFAULT 0, _importo_sostenuto NUMERIC DEFAULT 0, _costo_residuo NUMERIC DEFAULT 0,
  _cantiere_id UUID DEFAULT NULL, _fase_id UUID DEFAULT NULL, _fornitore_id UUID DEFAULT NULL,
  _note TEXT DEFAULT NULL
) RETURNS public.commessa_budget_voci
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_mod TEXT; v_pos INT; v_imp NUMERIC; v_row public.commessa_budget_voci;
BEGIN
  IF NOT public.can_manage_commessa_budget(_commessa_id, 'create') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  SELECT organization_id, updated_at, budget_modalita INTO v_org, v_upd, v_mod
    FROM public.commesse WHERE id = _commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF v_mod <> 'analitico' THEN RAISE EXCEPTION 'Budget non in modalità analitico' USING ERRCODE='P0001'; END IF;

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
END $$;
REVOKE EXECUTE ON FUNCTION public.create_commessa_budget_voce(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_commessa_budget_voce(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,UUID,UUID,UUID,TEXT) TO authenticated;

-- --------------------------------------------------------------
-- 9. RPC: update voce
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_commessa_budget_voce(
  _voce_id UUID, _expected_updated_at TIMESTAMPTZ,
  _categoria TEXT, _descrizione TEXT,
  _sottocategoria TEXT DEFAULT NULL, _codice TEXT DEFAULT NULL, _unita TEXT DEFAULT NULL,
  _quantita NUMERIC DEFAULT NULL, _prezzo_unitario NUMERIC DEFAULT NULL,
  _importo_previsto NUMERIC DEFAULT NULL,
  _importo_impegnato NUMERIC DEFAULT NULL, _importo_sostenuto NUMERIC DEFAULT NULL, _costo_residuo NUMERIC DEFAULT NULL,
  _cantiere_id UUID DEFAULT NULL, _fase_id UUID DEFAULT NULL, _fornitore_id UUID DEFAULT NULL,
  _note TEXT DEFAULT NULL
) RETURNS public.commessa_budget_voci
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.commessa_budget_voci; v_imp NUMERIC;
BEGIN
  SELECT * INTO v_row FROM public.commessa_budget_voci WHERE id=_voce_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voce inesistente'; END IF;
  IF v_row.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Voce archiviata'; END IF;
  IF v_row.updated_at <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF NOT public.can_manage_commessa_budget(v_row.commessa_id, 'update') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
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
END $$;
REVOKE EXECUTE ON FUNCTION public.update_commessa_budget_voce(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_commessa_budget_voce(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,UUID,UUID,UUID,TEXT) TO authenticated;

-- --------------------------------------------------------------
-- 10. RPC: archive / restore
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_commessa_budget_voce(
  _voce_id UUID, _expected_updated_at TIMESTAMPTZ, _motivazione TEXT DEFAULT NULL
) RETURNS public.commessa_budget_voci
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.commessa_budget_voci;
BEGIN
  SELECT * INTO v_row FROM public.commessa_budget_voci WHERE id=_voce_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voce inesistente'; END IF;
  IF v_row.updated_at <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF NOT public.can_manage_commessa_budget(v_row.commessa_id, 'archive') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
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
END $$;
REVOKE EXECUTE ON FUNCTION public.archive_commessa_budget_voce(UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_commessa_budget_voce(UUID,TIMESTAMPTZ,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_commessa_budget_voce(
  _voce_id UUID, _expected_updated_at TIMESTAMPTZ
) RETURNS public.commessa_budget_voci
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.commessa_budget_voci;
BEGIN
  SELECT * INTO v_row FROM public.commessa_budget_voci WHERE id=_voce_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voce inesistente'; END IF;
  IF v_row.updated_at <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF NOT public.can_manage_commessa_budget(v_row.commessa_id, 'restore') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  UPDATE public.commessa_budget_voci
    SET archived_at = NULL, archived_by = NULL
    WHERE id=_voce_id RETURNING * INTO v_row;
  PERFORM public.recalculate_commessa_budget(v_row.commessa_id);
  PERFORM public._cbv_audit(v_row.organization_id, v_row.commessa_id, 'commessa.budget_voce_restored',
    jsonb_build_object('voce_id',_voce_id));
  RETURN v_row;
END $$;
REVOKE EXECUTE ON FUNCTION public.restore_commessa_budget_voce(UUID,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_commessa_budget_voce(UUID,TIMESTAMPTZ) TO authenticated;

-- --------------------------------------------------------------
-- 11. RPC: reorder
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_commessa_budget_voci(
  _commessa_id UUID, _expected_updated_at TIMESTAMPTZ, _ordered_ids UUID[]
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_count INT; v_active_count INT;
BEGIN
  IF NOT public.can_manage_commessa_budget(_commessa_id, 'reorder') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  SELECT organization_id, updated_at INTO v_org, v_upd FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  -- Validazione duplicati
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
END $$;
REVOKE EXECUTE ON FUNCTION public.reorder_commessa_budget_voci(UUID,TIMESTAMPTZ,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_commessa_budget_voci(UUID,TIMESTAMPTZ,UUID[]) TO authenticated;

-- --------------------------------------------------------------
-- 12. RPC: set_commessa_budget_mode
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_commessa_budget_mode(
  _commessa_id UUID, _mode TEXT, _expected_updated_at TIMESTAMPTZ,
  _motivazione TEXT DEFAULT NULL, _confirm_empty BOOLEAN DEFAULT false
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_old TEXT; v_has_voci BOOLEAN;
BEGIN
  IF _mode NOT IN ('manuale','analitico') THEN RAISE EXCEPTION 'Modalità non valida'; END IF;
  IF NOT public.can_manage_commessa_budget(_commessa_id, 'set_mode') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  SELECT organization_id, updated_at, budget_modalita INTO v_org, v_upd, v_old
    FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
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
END $$;
REVOKE EXECUTE ON FUNCTION public.set_commessa_budget_mode(UUID,TEXT,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_commessa_budget_mode(UUID,TEXT,TIMESTAMPTZ,TEXT,BOOLEAN) TO authenticated;

-- --------------------------------------------------------------
-- 13. RPC: update_manual_commessa_budget
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_manual_commessa_budget(
  _commessa_id UUID, _expected_updated_at TIMESTAMPTZ,
  _ricavi_previsti NUMERIC, _ricavi_acquisiti NUMERIC,
  _extra_approvati NUMERIC, _extra_non_approvati NUMERIC,
  _costi_previsti NUMERIC, _costi_impegnati NUMERIC,
  _costi_sostenuti NUMERIC, _costi_residui_stimati NUMERIC,
  _motivazione TEXT DEFAULT NULL
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_mod TEXT;
  v_old_costi NUMERIC; v_old_ric_acq NUMERIC; v_old_marg NUMERIC;
  v_costo_agg NUMERIC; v_ricavi_agg NUMERIC; v_marg_prev NUMERIC; v_marg_agg NUMERIC;
  v_marg_pct NUMERIC; v_marg_pct_agg NUMERIC;
  v_needs_motiv BOOLEAN := false;
BEGIN
  IF NOT public.can_manage_commessa_budget(_commessa_id, 'update_manual') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  SELECT organization_id, updated_at, budget_modalita,
         costi_previsti, ricavi_acquisiti, margine_aggiornato
    INTO v_org, v_upd, v_mod, v_old_costi, v_old_ric_acq, v_old_marg
    FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
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
END $$;
REVOKE EXECUTE ON FUNCTION public.update_manual_commessa_budget(UUID,TIMESTAMPTZ,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_manual_commessa_budget(UUID,TIMESTAMPTZ,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT) TO authenticated;

-- --------------------------------------------------------------
-- 14. RPC: import_budget_from_preventivo
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_budget_from_preventivo(
  _commessa_id UUID, _expected_updated_at TIMESTAMPTZ, _strategy TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_mod TEXT; v_prev UUID;
  v_ricavi_creati INT := 0; v_costi_creati INT := 0; v_ignorati INT := 0; v_no_costo INT := 0;
  v_pos INT; v_exists BOOLEAN; v_has_voci BOOLEAN;
  r RECORD; v_categoria_costo TEXT;
BEGIN
  IF _strategy NOT IN ('init_if_empty','add_missing') THEN RAISE EXCEPTION 'Strategia non valida'; END IF;
  IF NOT public.can_manage_commessa_budget(_commessa_id, 'import_preventivo') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  SELECT organization_id, updated_at, budget_modalita, preventivo_id
    INTO v_org, v_upd, v_mod, v_prev
    FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF v_prev IS NULL THEN RAISE EXCEPTION 'Nessun preventivo collegato'; END IF;
  IF v_mod <> 'analitico' THEN RAISE EXCEPTION 'Attivare prima la modalità analitico'; END IF;

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
    -- RICAVO
    SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
      WHERE commessa_id=_commessa_id AND preventivo_voce_id=r.id
        AND archived_at IS NULL AND fonte='preventivo' AND tipo='ricavo') INTO v_exists;
    IF v_exists THEN
      v_ignorati := v_ignorati + 1;
    ELSE
      v_pos := v_pos + 1;
      INSERT INTO public.commessa_budget_voci(
        organization_id, commessa_id, tipo, categoria, descrizione, codice,
        unita_misura, quantita, prezzo_unitario, importo_previsto,
        importo_impegnato, importo_sostenuto, costo_residuo_stimato,
        fonte, preventivo_voce_id, posizione, created_by
      ) VALUES (
        v_org, _commessa_id, 'ricavo', 'contratto',
        COALESCE(NULLIF(r.descrizione,''), '(voce senza descrizione)'), r.codice,
        r.unita_misura, r.quantita, r.prezzo_unitario, COALESCE(r.importo_netto,0),
        0, 0, 0, 'preventivo', r.id, v_pos, auth.uid()
      );
      v_ricavi_creati := v_ricavi_creati + 1;
    END IF;

    -- COSTO (solo se costo > 0)
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
        v_ignorati := v_ignorati + 1;
      ELSE
        v_pos := v_pos + 1;
        INSERT INTO public.commessa_budget_voci(
          organization_id, commessa_id, tipo, categoria, descrizione, codice,
          unita_misura, quantita, prezzo_unitario, importo_previsto,
          importo_impegnato, importo_sostenuto, costo_residuo_stimato,
          fonte, preventivo_voce_id, posizione, created_by
        ) VALUES (
          v_org, _commessa_id, 'costo', v_categoria_costo,
          COALESCE(NULLIF(r.descrizione,''), '(voce senza descrizione)'), r.codice,
          r.unita_misura, r.quantita, r.costo_unitario,
          COALESCE(r.costo_totale, r.costo_unitario * r.quantita, 0),
          0, 0, 0, 'preventivo', r.id, v_pos, auth.uid()
        );
        v_costi_creati := v_costi_creati + 1;
      END IF;
    ELSE
      v_no_costo := v_no_costo + 1;
    END IF;
  END LOOP;

  PERFORM public.recalculate_commessa_budget(_commessa_id);
  PERFORM public._cbv_audit(v_org, _commessa_id, 'commessa.budget_imported_from_preventivo',
    jsonb_build_object('strategy',_strategy,'ricavi',v_ricavi_creati,'costi',v_costi_creati,
                       'ignorati',v_ignorati,'senza_costo',v_no_costo));

  RETURN jsonb_build_object(
    'ricavi_creati', v_ricavi_creati,
    'costi_creati', v_costi_creati,
    'ignorati', v_ignorati,
    'senza_costo', v_no_costo,
    'commessa_updated_at', (SELECT updated_at FROM public.commesse WHERE id=_commessa_id)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.import_budget_from_preventivo(UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_budget_from_preventivo(UUID,TIMESTAMPTZ,TEXT) TO authenticated;

-- --------------------------------------------------------------
-- 15. RPC: set_commessa_baseline
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_commessa_baseline(
  _commessa_id UUID, _expected_updated_at TIMESTAMPTZ,
  _motivazione TEXT DEFAULT NULL, _replace BOOLEAN DEFAULT false
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_has BOOLEAN;
  v_prev UUID; v_ric NUMERIC; v_cost NUMERIC; v_marg NUMERIC;
BEGIN
  SELECT organization_id, updated_at INTO v_org, v_upd FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Commessa inesistente'; END IF;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF NOT public.has_any_role(v_org, ARRAY['proprietario','amministratore']::public.app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
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
END $$;
REVOKE EXECUTE ON FUNCTION public.set_commessa_baseline(UUID,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_commessa_baseline(UUID,TIMESTAMPTZ,TEXT,BOOLEAN) TO authenticated;

-- --------------------------------------------------------------
-- FINE
-- --------------------------------------------------------------
