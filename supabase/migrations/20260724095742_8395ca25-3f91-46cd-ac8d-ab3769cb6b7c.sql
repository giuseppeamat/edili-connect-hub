-- s4_01_commesse_hardening
ALTER TABLE public.commesse
  ADD COLUMN IF NOT EXISTS titolo TEXT,
  ADD COLUMN IF NOT EXISTS descrizione TEXT,
  ADD COLUMN IF NOT EXISTS tipologia TEXT,
  ADD COLUMN IF NOT EXISTS priorita TEXT,
  ADD COLUMN IF NOT EXISTS note_interne TEXT,
  ADD COLUMN IF NOT EXISTS data_apertura DATE,
  ADD COLUMN IF NOT EXISTS data_inizio_prevista DATE,
  ADD COLUMN IF NOT EXISTS data_inizio_effettiva DATE,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS importo_contratto NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS ricavi_previsti NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS costi_previsti NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS costi_impegnati NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margine_previsto NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS margine_aggiornato NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS margine_percentuale NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS created_by UUID;

-- Backfill non distruttivo (le colonne legacy restano)
UPDATE public.commesse SET
  titolo = COALESCE(titolo, denominazione),
  importo_contratto = COALESCE(importo_contratto, importo),
  ricavi_previsti = COALESCE(ricavi_previsti, importo),
  costi_previsti = COALESCE(costi_previsti, budget_costi),
  data_apertura = COALESCE(data_apertura, created_at::date),
  data_inizio_prevista = COALESCE(data_inizio_prevista, data_inizio);

UPDATE public.commesse SET
  margine_previsto = COALESCE(ricavi_previsti,0) - COALESCE(costi_previsti,0),
  margine_aggiornato = COALESCE(ricavi_previsti,0) - COALESCE(costi_sostenuti,0) - COALESCE(costi_impegnati,0);

UPDATE public.commesse SET
  margine_percentuale = CASE
    WHEN COALESCE(ricavi_previsti,0) > 0
      THEN ROUND(margine_previsto / ricavi_previsti * 100, 2)
    ELSE 0
  END;

-- FK verso auth.users (SET NULL su delete)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_created_by_fkey') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_closed_by_fkey') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_closed_by_fkey
      FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_archived_by_fkey') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_archived_by_fkey
      FOREIGN KEY (archived_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- CHECK di validità
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_importo_contratto_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_importo_contratto_nn
      CHECK (importo_contratto IS NULL OR importo_contratto >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_ricavi_previsti_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_ricavi_previsti_nn
      CHECK (ricavi_previsti IS NULL OR ricavi_previsti >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_costi_previsti_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_costi_previsti_nn
      CHECK (costi_previsti IS NULL OR costi_previsti >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_costi_impegnati_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_costi_impegnati_nn
      CHECK (costi_impegnati >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_costi_sostenuti_nn') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_costi_sostenuti_nn
      CHECK (costi_sostenuti >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_avanzamento_range') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_avanzamento_range
      CHECK (avanzamento_pct >= 0 AND avanzamento_pct <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_date_prev_ord') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_date_prev_ord
      CHECK (data_inizio_prevista IS NULL OR data_fine_prevista IS NULL OR data_fine_prevista >= data_inizio_prevista);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_date_eff_ord') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_date_eff_ord
      CHECK (data_inizio_effettiva IS NULL OR data_fine_effettiva IS NULL OR data_fine_effettiva >= data_inizio_effettiva);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_tipologia_chk') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_tipologia_chk
      CHECK (tipologia IS NULL OR tipologia IN
        ('ristrutturazione','nuova_costruzione','manutenzione','impiantistica',
         'riqualificazione','demolizione','fornitura_posa','altro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_priorita_chk') THEN
    ALTER TABLE public.commesse ADD CONSTRAINT commesse_priorita_chk
      CHECK (priorita IS NULL OR priorita IN ('bassa','normale','alta','urgente'));
  END IF;
END $$;

-- Indici
CREATE INDEX IF NOT EXISTS commesse_org_archived_idx ON public.commesse(organization_id, archived_at);
CREATE INDEX IF NOT EXISTS commesse_data_inizio_prev_idx ON public.commesse(data_inizio_prevista);
CREATE INDEX IF NOT EXISTS commesse_data_fine_prev_idx ON public.commesse(data_fine_prevista);
CREATE INDEX IF NOT EXISTS commesse_updated_at_idx ON public.commesse(updated_at);
CREATE INDEX IF NOT EXISTS commesse_created_by_idx ON public.commesse(created_by);

COMMENT ON COLUMN public.commesse.titolo IS 'Campo canonico. denominazione resta legacy per retrocompatibilità.';
COMMENT ON COLUMN public.commesse.importo_contratto IS 'Campo canonico. importo resta legacy per retrocompatibilità.';
COMMENT ON COLUMN public.commesse.costi_previsti IS 'Campo canonico. budget_costi resta legacy per retrocompatibilità.';
COMMENT ON COLUMN public.commesse.data_inizio_prevista IS 'Campo canonico. data_inizio resta legacy per retrocompatibilità.';