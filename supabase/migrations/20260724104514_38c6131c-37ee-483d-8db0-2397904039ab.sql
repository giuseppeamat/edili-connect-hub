-- =====================================================================
-- Sprint 4 · Blocco 4 — Cantieri, Membri, Scoping accessi
-- =====================================================================

-- ============ TABLE: commessa_membri ============
CREATE TABLE public.commessa_membri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commessa_id UUID NOT NULL,
  cantiere_id UUID NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ruolo_operativo TEXT NOT NULL,
  data_inizio DATE NOT NULL DEFAULT CURRENT_DATE,
  data_fine DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT commessa_membri_ruolo_ck CHECK (
    ruolo_operativo IN ('responsabile_commessa','capocantiere','tecnico','amministrazione','operaio','collaboratore','altro')
  ),
  CONSTRAINT commessa_membri_date_ck CHECK (data_fine IS NULL OR data_fine >= data_inizio),
  CONSTRAINT commessa_membri_commessa_fk FOREIGN KEY (commessa_id, organization_id)
    REFERENCES public.commesse(id, organization_id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE ON public.commessa_membri TO authenticated;
GRANT ALL ON public.commessa_membri TO service_role;

CREATE UNIQUE INDEX commessa_membri_active_uniq
  ON public.commessa_membri (commessa_id, user_id, ruolo_operativo)
  WHERE is_active = true AND archived_at IS NULL;

CREATE INDEX idx_commessa_membri_org ON public.commessa_membri(organization_id);
CREATE INDEX idx_commessa_membri_commessa ON public.commessa_membri(commessa_id);
CREATE INDEX idx_commessa_membri_user ON public.commessa_membri(user_id);
CREATE INDEX idx_commessa_membri_ruolo ON public.commessa_membri(ruolo_operativo);
CREATE INDEX idx_commessa_membri_active ON public.commessa_membri(is_active);
CREATE INDEX idx_commessa_membri_commessa_user ON public.commessa_membri(commessa_id, user_id);
CREATE INDEX idx_commessa_membri_org_active ON public.commessa_membri(organization_id, is_active);

ALTER TABLE public.commessa_membri ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER commessa_membri_touch_updated_at
  BEFORE UPDATE ON public.commessa_membri
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ TABLE: cantieri ============
CREATE TABLE public.cantieri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commessa_id UUID NOT NULL,
  codice TEXT NOT NULL,
  nome TEXT NOT NULL,
  descrizione TEXT,
  indirizzo TEXT,
  numero_civico TEXT,
  cap TEXT,
  citta TEXT,
  provincia TEXT,
  paese TEXT DEFAULT 'Italia',
  referente_nome TEXT,
  referente_telefono TEXT,
  referente_email TEXT,
  responsabile_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  capocantiere_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  stato TEXT NOT NULL DEFAULT 'pianificato',
  data_inizio_prevista DATE,
  data_fine_prevista DATE,
  data_inizio_effettiva DATE,
  data_fine_effettiva DATE,
  latitudine NUMERIC NULL,
  longitudine NUMERIC NULL,
  note_operative TEXT,
  is_principale BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT cantieri_stato_ck CHECK (
    stato IN ('pianificato','attivo','sospeso','completato','chiuso','archiviato')
  ),
  CONSTRAINT cantieri_date_prev_ck CHECK (
    data_fine_prevista IS NULL OR data_inizio_prevista IS NULL OR data_fine_prevista >= data_inizio_prevista
  ),
  CONSTRAINT cantieri_date_eff_ck CHECK (
    data_fine_effettiva IS NULL OR data_inizio_effettiva IS NULL OR data_fine_effettiva >= data_inizio_effettiva
  ),
  CONSTRAINT cantieri_commessa_fk FOREIGN KEY (commessa_id, organization_id)
    REFERENCES public.commesse(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cantieri_id_org_uniq UNIQUE (id, organization_id)
);

GRANT SELECT, INSERT, UPDATE ON public.cantieri TO authenticated;
GRANT ALL ON public.cantieri TO service_role;

CREATE UNIQUE INDEX cantieri_commessa_codice_uniq ON public.cantieri(commessa_id, codice);
CREATE UNIQUE INDEX cantieri_principale_uniq
  ON public.cantieri(commessa_id)
  WHERE is_principale = true AND archived_at IS NULL;

CREATE INDEX idx_cantieri_org ON public.cantieri(organization_id);
CREATE INDEX idx_cantieri_commessa ON public.cantieri(commessa_id);
CREATE INDEX idx_cantieri_stato ON public.cantieri(stato);
CREATE INDEX idx_cantieri_responsabile ON public.cantieri(responsabile_id);
CREATE INDEX idx_cantieri_capocantiere ON public.cantieri(capocantiere_id);
CREATE INDEX idx_cantieri_principale ON public.cantieri(is_principale);
CREATE INDEX idx_cantieri_data_inizio_prev ON public.cantieri(data_inizio_prevista);
CREATE INDEX idx_cantieri_data_fine_prev ON public.cantieri(data_fine_prevista);
CREATE INDEX idx_cantieri_org_stato ON public.cantieri(organization_id, stato);

ALTER TABLE public.cantieri ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER cantieri_touch_updated_at
  BEFORE UPDATE ON public.cantieri
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ Add cantiere_id FK to commessa_membri ============
ALTER TABLE public.commessa_membri
  ADD CONSTRAINT commessa_membri_cantiere_fk FOREIGN KEY (cantiere_id, organization_id)
    REFERENCES public.cantieri(id, organization_id) ON DELETE SET NULL;

-- Trigger: cantiere must belong to the same commessa when set
CREATE OR REPLACE FUNCTION public.tg_commessa_membri_validate_cantiere()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _cant_commessa UUID;
BEGIN
  IF NEW.cantiere_id IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE id = NEW.cantiere_id;
    IF _cant_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'Il cantiere non appartiene alla commessa indicata' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER commessa_membri_validate_cantiere
  BEFORE INSERT OR UPDATE ON public.commessa_membri
  FOR EACH ROW EXECUTE FUNCTION public.tg_commessa_membri_validate_cantiere();

-- ============ Add cantiere_id to rapportini ============
ALTER TABLE public.rapportini ADD COLUMN cantiere_id UUID NULL;
ALTER TABLE public.rapportini ADD CONSTRAINT rapportini_cantiere_fk
  FOREIGN KEY (cantiere_id, organization_id)
  REFERENCES public.cantieri(id, organization_id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_rapportini_validate_cantiere()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _cant_commessa UUID;
BEGIN
  IF NEW.cantiere_id IS NOT NULL AND NEW.commessa_id IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE id = NEW.cantiere_id;
    IF _cant_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'Il cantiere non appartiene alla commessa del rapportino' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER rapportini_validate_cantiere
  BEFORE INSERT OR UPDATE ON public.rapportini
  FOR EACH ROW EXECUTE FUNCTION public.tg_rapportini_validate_cantiere();

CREATE INDEX idx_rapportini_cantiere ON public.rapportini(cantiere_id);

-- ============ Add cantiere_id to documenti ============
ALTER TABLE public.documenti ADD COLUMN cantiere_id UUID NULL;
ALTER TABLE public.documenti ADD CONSTRAINT documenti_cantiere_fk
  FOREIGN KEY (cantiere_id, organization_id)
  REFERENCES public.cantieri(id, organization_id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tg_documenti_validate_cantiere()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _cant_commessa UUID;
BEGIN
  IF NEW.cantiere_id IS NOT NULL AND NEW.commessa_id IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE id = NEW.cantiere_id;
    IF _cant_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'Il cantiere non appartiene alla commessa del documento' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER documenti_validate_cantiere
  BEFORE INSERT OR UPDATE ON public.documenti
  FOR EACH ROW EXECUTE FUNCTION public.tg_documenti_validate_cantiere();

CREATE INDEX idx_documenti_cantiere ON public.documenti(cantiere_id);

-- ============ BACKFILL: cantiere principale per ogni commessa ============
DO $$
DECLARE
  _cnt_before INT;
  _cnt_after INT;
  _rapp_before INT;
BEGIN
  SELECT COUNT(*) INTO _cnt_before FROM public.commesse;
  SELECT COUNT(*) INTO _rapp_before FROM public.rapportini;

  INSERT INTO public.cantieri (
    organization_id, commessa_id, codice, nome, indirizzo,
    stato, data_inizio_prevista, data_fine_prevista,
    data_inizio_effettiva, data_fine_effettiva,
    is_principale, created_by
  )
  SELECT
    c.organization_id, c.id, 'PRIN',
    COALESCE(NULLIF(c.titolo,''), NULLIF(c.denominazione,''), 'Cantiere principale'),
    c.indirizzo_cantiere,
    CASE c.stato::text
      WHEN 'bozza' THEN 'pianificato'
      WHEN 'pianificata' THEN 'pianificato'
      WHEN 'in_corso' THEN 'attivo'
      WHEN 'sospesa' THEN 'sospeso'
      WHEN 'completata' THEN 'completato'
      WHEN 'annullata' THEN 'chiuso'
      ELSE 'pianificato'
    END,
    COALESCE(c.data_inizio_prevista, c.data_inizio),
    c.data_fine_prevista,
    c.data_inizio_effettiva,
    c.data_fine_effettiva,
    true,
    c.created_by
  FROM public.commesse c;

  SELECT COUNT(*) INTO _cnt_after FROM public.cantieri WHERE is_principale = true;
  IF _cnt_after <> _cnt_before THEN
    RAISE EXCEPTION 'Backfill cantieri fallito: attesi % principali, trovati %', _cnt_before, _cnt_after;
  END IF;

  -- Backfill rapportini
  UPDATE public.rapportini r
     SET cantiere_id = k.id
    FROM public.cantieri k
   WHERE r.commessa_id = k.commessa_id
     AND r.organization_id = k.organization_id
     AND k.is_principale = true
     AND r.cantiere_id IS NULL;

  IF (SELECT COUNT(*) FROM public.rapportini) <> _rapp_before THEN
    RAISE EXCEPTION 'Rapportini persi durante il backfill';
  END IF;

  -- Backfill documenti (solo se commessa_id valorizzato)
  UPDATE public.documenti d
     SET cantiere_id = k.id
    FROM public.cantieri k
   WHERE d.commessa_id = k.commessa_id
     AND d.organization_id = k.organization_id
     AND k.is_principale = true
     AND d.cantiere_id IS NULL;

  -- Verifica no cross-tenant nei cantieri creati
  IF EXISTS (
    SELECT 1 FROM public.cantieri k
    JOIN public.commesse c ON c.id = k.commessa_id
    WHERE c.organization_id <> k.organization_id
  ) THEN
    RAISE EXCEPTION 'Cross-tenant rilevato nei cantieri!';
  END IF;
END $$;

-- ============ HELPER FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.is_membro_commessa(_commessa_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.commessa_membri m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.commessa_id = _commessa_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND m.archived_at IS NULL
      AND COALESCE(p.is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_membro_cantiere(_cantiere_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.commessa_membri m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE (m.cantiere_id = _cantiere_id
           OR m.commessa_id = (SELECT commessa_id FROM public.cantieri WHERE id = _cantiere_id))
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND m.archived_at IS NULL
      AND COALESCE(p.is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_capocantiere_di(_cantiere_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cantieri k
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE k.id = _cantiere_id
      AND k.capocantiere_id = auth.uid()
      AND COALESCE(p.is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_commessa(_commessa_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.commesse c
    WHERE c.id = _commessa_id
      AND (
        public.has_any_role(c.organization_id,
          ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
        OR (c.responsabile_id = auth.uid()
            AND public.has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]))
        OR public.is_membro_commessa(_commessa_id)
        OR EXISTS (SELECT 1 FROM public.cantieri k
                   WHERE k.commessa_id = _commessa_id
                     AND (k.capocantiere_id = auth.uid() OR public.is_membro_cantiere(k.id)))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_cantiere(_cantiere_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cantieri k
    WHERE k.id = _cantiere_id
      AND (
        public.has_any_role(k.organization_id,
          ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
        OR public.can_access_commessa(k.commessa_id)
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_membro_commessa(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_membro_cantiere(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_capocantiere_di(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_commessa(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_cantiere(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_membro_commessa(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_membro_cantiere(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_capocantiere_di(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_commessa(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_cantiere(UUID) TO authenticated, service_role;

-- ============ RLS: commessa_membri ============
CREATE POLICY commessa_membri_sel ON public.commessa_membri FOR SELECT TO authenticated
  USING (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
    OR user_id = auth.uid()
    OR public.can_access_commessa(commessa_id)
  );

CREATE POLICY commessa_membri_ins ON public.commessa_membri FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (SELECT 1 FROM public.commesse c
                  WHERE c.id = commessa_id AND c.responsabile_id = auth.uid())
      AND ruolo_operativo NOT IN ('responsabile_commessa')
    )
  );

CREATE POLICY commessa_membri_upd ON public.commessa_membri FOR UPDATE TO authenticated
  USING (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (SELECT 1 FROM public.commesse c
                  WHERE c.id = commessa_id AND c.responsabile_id = auth.uid())
    )
  );

-- ============ RLS: cantieri ============
CREATE POLICY cantieri_sel ON public.cantieri FOR SELECT TO authenticated
  USING (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
    OR public.can_access_commessa(commessa_id)
  );

CREATE POLICY cantieri_ins ON public.cantieri FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (SELECT 1 FROM public.commesse c
                  WHERE c.id = commessa_id AND c.responsabile_id = auth.uid())
    )
  );

CREATE POLICY cantieri_upd ON public.cantieri FOR UPDATE TO authenticated
  USING (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (SELECT 1 FROM public.commesse c
                  WHERE c.id = commessa_id AND c.responsabile_id = auth.uid())
    )
    OR (
      public.has_any_role(organization_id, ARRAY['capocantiere']::app_role[])
      AND capocantiere_id = auth.uid()
    )
  );

-- ============ RESTRIZIONE RLS commesse (SELECT) ============
DROP POLICY IF EXISTS commesse_sel ON public.commesse;
CREATE POLICY commesse_sel ON public.commesse FOR SELECT TO authenticated
  USING (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND (responsabile_id = auth.uid() OR public.is_membro_commessa(id))
    )
    OR (
      public.has_any_role(organization_id, ARRAY['capocantiere']::app_role[])
      AND (
        public.is_membro_commessa(id)
        OR EXISTS (SELECT 1 FROM public.cantieri k WHERE k.commessa_id = id AND k.capocantiere_id = auth.uid())
      )
    )
    OR (
      public.has_any_role(organization_id, ARRAY['operaio']::app_role[])
      AND public.is_membro_commessa(id)
    )
  );

-- ============ Verifiche finali ============
DO $$
DECLARE
  _c INT; _k INT; _p INT;
BEGIN
  SELECT COUNT(*) INTO _c FROM public.commesse;
  SELECT COUNT(*) INTO _k FROM public.cantieri WHERE is_principale = true AND archived_at IS NULL;
  SELECT COUNT(*) INTO _p FROM (
    SELECT commessa_id FROM public.cantieri WHERE is_principale = true AND archived_at IS NULL
    GROUP BY commessa_id HAVING COUNT(*) > 1
  ) x;
  IF _c <> _k THEN
    RAISE EXCEPTION 'Numero cantieri principali (%) diverso da commesse (%)', _k, _c;
  END IF;
  IF _p > 0 THEN
    RAISE EXCEPTION 'Trovate % commesse con più di un cantiere principale', _p;
  END IF;
END $$;