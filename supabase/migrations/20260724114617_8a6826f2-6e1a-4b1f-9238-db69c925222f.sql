-- ============================================================
-- Sprint 4 · Blocco 5 — commessa_fasi
-- ============================================================

-- 1) Estensione tabella commesse: modalità avanzamento
ALTER TABLE public.commesse
  ADD COLUMN IF NOT EXISTS avanzamento_modalita TEXT NOT NULL DEFAULT 'manuale',
  ADD COLUMN IF NOT EXISTS avanzamento_calcolato_at TIMESTAMPTZ NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_avanzamento_modalita_chk') THEN
    ALTER TABLE public.commesse
      ADD CONSTRAINT commesse_avanzamento_modalita_chk
      CHECK (avanzamento_modalita IN ('manuale','fasi'));
  END IF;
END $$;

-- 2) Tabella commessa_fasi
CREATE TABLE IF NOT EXISTS public.commessa_fasi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commessa_id UUID NOT NULL,
  cantiere_id UUID NULL,
  titolo TEXT NOT NULL,
  descrizione TEXT NULL,
  posizione INTEGER NOT NULL DEFAULT 0,
  stato TEXT NOT NULL DEFAULT 'non_iniziata',
  peso_percentuale NUMERIC(6,2) NOT NULL DEFAULT 0,
  avanzamento_percentuale NUMERIC(6,2) NOT NULL DEFAULT 0,
  data_inizio_prevista DATE NULL,
  data_fine_prevista DATE NULL,
  data_inizio_effettiva DATE NULL,
  data_fine_effettiva DATE NULL,
  responsabile_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  archived_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT commessa_fasi_commessa_fk
    FOREIGN KEY (commessa_id, organization_id)
    REFERENCES public.commesse(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT commessa_fasi_cantiere_fk
    FOREIGN KEY (cantiere_id, organization_id)
    REFERENCES public.cantieri(id, organization_id) ON DELETE SET NULL,

  CONSTRAINT commessa_fasi_posizione_chk CHECK (posizione >= 0),
  CONSTRAINT commessa_fasi_peso_chk CHECK (peso_percentuale BETWEEN 0 AND 100),
  CONSTRAINT commessa_fasi_avanzamento_chk CHECK (avanzamento_percentuale BETWEEN 0 AND 100),
  CONSTRAINT commessa_fasi_stato_chk CHECK (stato IN ('non_iniziata','in_corso','sospesa','completata','annullata')),
  CONSTRAINT commessa_fasi_date_prev_chk CHECK (
    data_inizio_prevista IS NULL OR data_fine_prevista IS NULL OR data_fine_prevista >= data_inizio_prevista
  ),
  CONSTRAINT commessa_fasi_date_eff_chk CHECK (
    data_inizio_effettiva IS NULL OR data_fine_effettiva IS NULL OR data_fine_effettiva >= data_inizio_effettiva
  ),
  CONSTRAINT commessa_fasi_completata_chk CHECK (
    stato <> 'completata' OR avanzamento_percentuale = 100
  )
);

-- 3) GRANT (subito dopo CREATE TABLE)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commessa_fasi TO authenticated;
GRANT ALL ON public.commessa_fasi TO service_role;

-- 4) Indici
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_org ON public.commessa_fasi(organization_id);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_commessa ON public.commessa_fasi(commessa_id);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_cantiere ON public.commessa_fasi(cantiere_id);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_responsabile ON public.commessa_fasi(responsabile_id);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_stato ON public.commessa_fasi(stato);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_commessa_pos ON public.commessa_fasi(commessa_id, posizione);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_commessa_arch ON public.commessa_fasi(commessa_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_dip ON public.commessa_fasi(data_inizio_prevista);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_dfp ON public.commessa_fasi(data_fine_prevista);
CREATE INDEX IF NOT EXISTS idx_commessa_fasi_updated ON public.commessa_fasi(updated_at);

-- 5) Trigger updated_at (riuso funzione esistente)
DROP TRIGGER IF EXISTS tg_commessa_fasi_updated ON public.commessa_fasi;
CREATE TRIGGER tg_commessa_fasi_updated
  BEFORE UPDATE ON public.commessa_fasi
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 6) Trigger validazione cantiere ↔ commessa
CREATE OR REPLACE FUNCTION public.tg_commessa_fasi_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _cant_commessa UUID;
BEGIN
  IF NEW.cantiere_id IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE id = NEW.cantiere_id;
    IF _cant_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'Il cantiere non appartiene alla commessa della fase' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_commessa_fasi_validate ON public.commessa_fasi;
CREATE TRIGGER tg_commessa_fasi_validate
  BEFORE INSERT OR UPDATE ON public.commessa_fasi
  FOR EACH ROW EXECUTE FUNCTION public.tg_commessa_fasi_validate();

-- 7) Funzione ricalcolo avanzamento commessa
CREATE OR REPLACE FUNCTION public.recalculate_commessa_avanzamento(_commessa_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _modalita TEXT;
  _peso_tot NUMERIC(14,4);
  _ponderato NUMERIC(14,4);
  _nuovo NUMERIC(6,2);
BEGIN
  SELECT avanzamento_modalita INTO _modalita FROM public.commesse WHERE id = _commessa_id;
  IF _modalita IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(peso_percentuale),0),
         COALESCE(SUM(peso_percentuale * avanzamento_percentuale),0)
  INTO _peso_tot, _ponderato
  FROM public.commessa_fasi
  WHERE commessa_id = _commessa_id
    AND archived_at IS NULL
    AND stato <> 'annullata';

  IF _peso_tot > 0 THEN
    _nuovo := ROUND(_ponderato / _peso_tot, 2);
    IF _modalita = 'fasi' THEN
      UPDATE public.commesse
        SET avanzamento_pct = _nuovo,
            avanzamento_calcolato_at = now(),
            updated_at = now()
        WHERE id = _commessa_id;
    ELSE
      UPDATE public.commesse
        SET avanzamento_calcolato_at = now()
        WHERE id = _commessa_id;
    END IF;
    RETURN _nuovo;
  END IF;

  -- Peso totale = 0: non sovrascrivere mai
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.recalculate_commessa_avanzamento(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_commessa_avanzamento(UUID) TO authenticated;

-- 8) Trigger di ricalcolo AFTER
CREATE OR REPLACE FUNCTION public.tg_commessa_fasi_recalc()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cid UUID;
BEGIN
  _cid := COALESCE(NEW.commessa_id, OLD.commessa_id);
  PERFORM public.recalculate_commessa_avanzamento(_cid);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_commessa_fasi_recalc ON public.commessa_fasi;
CREATE TRIGGER tg_commessa_fasi_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.commessa_fasi
  FOR EACH ROW EXECUTE FUNCTION public.tg_commessa_fasi_recalc();

-- 9) RLS
ALTER TABLE public.commessa_fasi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commessa_fasi_sel ON public.commessa_fasi;
CREATE POLICY commessa_fasi_sel ON public.commessa_fasi
  FOR SELECT TO authenticated
  USING (
    public.can_access_commessa(commessa_id)
    OR (cantiere_id IS NOT NULL AND public.can_access_cantiere(cantiere_id))
  );

DROP POLICY IF EXISTS commessa_fasi_ins ON public.commessa_fasi;
CREATE POLICY commessa_fasi_ins ON public.commessa_fasi
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (
        SELECT 1 FROM public.commesse c
        WHERE c.id = commessa_id AND c.responsabile_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS commessa_fasi_upd ON public.commessa_fasi;
CREATE POLICY commessa_fasi_upd ON public.commessa_fasi
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (
        SELECT 1 FROM public.commesse c
        WHERE c.id = commessa_id AND c.responsabile_id = auth.uid()
      )
    )
    OR (
      cantiere_id IS NOT NULL
      AND public.has_any_role(organization_id, ARRAY['capocantiere']::app_role[])
      AND public.is_capocantiere_di(cantiere_id)
    )
  )
  WITH CHECK (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (
        SELECT 1 FROM public.commesse c
        WHERE c.id = commessa_id AND c.responsabile_id = auth.uid()
      )
    )
    OR (
      cantiere_id IS NOT NULL
      AND public.has_any_role(organization_id, ARRAY['capocantiere']::app_role[])
      AND public.is_capocantiere_di(cantiere_id)
    )
  );

-- Nessuna policy DELETE: soltanto service_role potrà eliminare fisicamente.

-- 10) Verifica non distruttiva
DO $$
DECLARE _n INT;
BEGIN
  SELECT COUNT(*) INTO _n FROM public.commesse;
  IF _n <> 7 THEN
    RAISE WARNING 'Numero commesse attese = 7, trovato = %', _n;
  END IF;
  SELECT COUNT(*) INTO _n FROM public.commesse WHERE avanzamento_modalita <> 'manuale';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'Alcune commesse non risultano in modalità manuale dopo la migration (%)', _n;
  END IF;
END $$;