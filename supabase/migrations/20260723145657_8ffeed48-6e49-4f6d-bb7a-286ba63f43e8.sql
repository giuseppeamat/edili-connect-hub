
-- =========================================================
-- Sprint 2 — CRM Clienti, Contatti, Attività
-- =========================================================

-- 1) ENUM
DO $$ BEGIN CREATE TYPE public.cliente_tipo AS ENUM ('persona_fisica','azienda','condominio','ente','altro'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.cliente_stato AS ENUM ('potenziale','attivo','inattivo','archiviato'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.attivita_tipo AS ENUM ('telefonata','email','incontro','sopralluogo','nota','promemoria','altro'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.attivita_stato AS ENUM ('pianificata','completata','annullata'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.attivita_priorita AS ENUM ('bassa','normale','alta','urgente'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) ALTER clienti — aggiungi campi CRM
ALTER TABLE public.clienti
  ADD COLUMN IF NOT EXISTS tipo public.cliente_tipo NOT NULL DEFAULT 'azienda',
  ADD COLUMN IF NOT EXISTS denominazione TEXT,
  ADD COLUMN IF NOT EXISTS nome TEXT,
  ADD COLUMN IF NOT EXISTS cognome TEXT,
  ADD COLUMN IF NOT EXISTS codice_destinatario TEXT,
  ADD COLUMN IF NOT EXISTS cellulare TEXT,
  ADD COLUMN IF NOT EXISTS sito_web TEXT,
  ADD COLUMN IF NOT EXISTS numero_civico TEXT,
  ADD COLUMN IF NOT EXISTS paese TEXT DEFAULT 'IT',
  ADD COLUMN IF NOT EXISTS note_interne TEXT,
  ADD COLUMN IF NOT EXISTS fonte_acquisizione TEXT,
  ADD COLUMN IF NOT EXISTS stato_cliente public.cliente_stato NOT NULL DEFAULT 'attivo',
  ADD COLUMN IF NOT EXISTS responsabile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill denominazione da ragione_sociale, rendi ragione_sociale nullable
UPDATE public.clienti SET denominazione = ragione_sociale WHERE denominazione IS NULL;
ALTER TABLE public.clienti ALTER COLUMN ragione_sociale DROP NOT NULL;
ALTER TABLE public.clienti ALTER COLUMN denominazione SET NOT NULL;

-- Indici clienti (aggiungi solo mancanti)
CREATE INDEX IF NOT EXISTS clienti_org_archived_idx ON public.clienti(organization_id, archived_at);
CREATE INDEX IF NOT EXISTS clienti_org_stato_idx ON public.clienti(organization_id, stato_cliente);
CREATE INDEX IF NOT EXISTS clienti_org_tipo_idx ON public.clienti(organization_id, tipo);
CREATE INDEX IF NOT EXISTS clienti_org_responsabile_idx ON public.clienti(organization_id, responsabile_id);
CREATE INDEX IF NOT EXISTS clienti_piva_norm_idx ON public.clienti(organization_id, (lower(regexp_replace(coalesce(partita_iva,''),'\s','','g'))));
CREATE INDEX IF NOT EXISTS clienti_cf_norm_idx ON public.clienti(organization_id, (upper(regexp_replace(coalesce(codice_fiscale,''),'\s','','g'))));
CREATE INDEX IF NOT EXISTS clienti_email_norm_idx ON public.clienti(organization_id, (lower(coalesce(email,''))));
CREATE INDEX IF NOT EXISTS clienti_denom_idx ON public.clienti(organization_id, lower(denominazione));
CREATE INDEX IF NOT EXISTS clienti_created_idx ON public.clienti(organization_id, created_at DESC);

-- 3) TABELLA cliente_contatti
CREATE TABLE IF NOT EXISTS public.cliente_contatti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL,
  nome TEXT NOT NULL,
  cognome TEXT,
  ruolo TEXT,
  email TEXT,
  telefono TEXT,
  cellulare TEXT,
  pec TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT cliente_contatti_cliente_org_fkey FOREIGN KEY (cliente_id, organization_id)
    REFERENCES public.clienti(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cliente_contatti_id_org_uniq UNIQUE (id, organization_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_contatti TO authenticated;
GRANT ALL ON public.cliente_contatti TO service_role;
ALTER TABLE public.cliente_contatti ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS cliente_contatti_org_idx ON public.cliente_contatti(organization_id);
CREATE INDEX IF NOT EXISTS cliente_contatti_cliente_idx ON public.cliente_contatti(cliente_id);
CREATE INDEX IF NOT EXISTS cliente_contatti_email_idx ON public.cliente_contatti(organization_id, lower(coalesce(email,'')));
CREATE INDEX IF NOT EXISTS cliente_contatti_telefono_idx ON public.cliente_contatti(organization_id, telefono);
CREATE UNIQUE INDEX IF NOT EXISTS cliente_contatti_primary_uniq
  ON public.cliente_contatti(cliente_id) WHERE is_primary = true AND archived_at IS NULL;

CREATE POLICY cliente_contatti_sel ON public.cliente_contatti FOR SELECT TO authenticated
  USING (has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]));
CREATE POLICY cliente_contatti_ins ON public.cliente_contatti FOR INSERT TO authenticated
  WITH CHECK (has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[]));
CREATE POLICY cliente_contatti_upd ON public.cliente_contatti FOR UPDATE TO authenticated
  USING (has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[]))
  WITH CHECK (has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[]));
CREATE POLICY cliente_contatti_del ON public.cliente_contatti FOR DELETE TO authenticated
  USING (has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

CREATE TRIGGER tg_cliente_contatti_upd BEFORE UPDATE ON public.cliente_contatti
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4) TABELLA crm_attivita
CREATE TABLE IF NOT EXISTS public.crm_attivita (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL,
  contatto_id UUID,
  tipo public.attivita_tipo NOT NULL DEFAULT 'nota',
  titolo TEXT NOT NULL,
  descrizione TEXT,
  stato public.attivita_stato NOT NULL DEFAULT 'pianificata',
  priorita public.attivita_priorita NOT NULL DEFAULT 'normale',
  data_attivita TIMESTAMPTZ NOT NULL DEFAULT now(),
  scadenza TIMESTAMPTZ,
  completata_at TIMESTAMPTZ,
  assegnata_a UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT crm_attivita_cliente_org_fkey FOREIGN KEY (cliente_id, organization_id)
    REFERENCES public.clienti(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT crm_attivita_contatto_org_fkey FOREIGN KEY (contatto_id, organization_id)
    REFERENCES public.cliente_contatti(id, organization_id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_attivita TO authenticated;
GRANT ALL ON public.crm_attivita TO service_role;
ALTER TABLE public.crm_attivita ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS crm_attivita_org_idx ON public.crm_attivita(organization_id);
CREATE INDEX IF NOT EXISTS crm_attivita_cliente_idx ON public.crm_attivita(cliente_id);
CREATE INDEX IF NOT EXISTS crm_attivita_contatto_idx ON public.crm_attivita(contatto_id);
CREATE INDEX IF NOT EXISTS crm_attivita_assegnata_idx ON public.crm_attivita(assegnata_a);
CREATE INDEX IF NOT EXISTS crm_attivita_created_by_idx ON public.crm_attivita(created_by);
CREATE INDEX IF NOT EXISTS crm_attivita_data_idx ON public.crm_attivita(organization_id, data_attivita DESC);
CREATE INDEX IF NOT EXISTS crm_attivita_scad_idx ON public.crm_attivita(organization_id, stato, scadenza);

-- SELECT: interni escluso operaio
CREATE POLICY crm_attivita_sel ON public.crm_attivita FOR SELECT TO authenticated
  USING (has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]));

-- INSERT: interni (capocantiere/responsabile compresi) — created_by = auth.uid()
CREATE POLICY crm_attivita_ins ON public.crm_attivita FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[])
    AND created_by = auth.uid()
  );

-- UPDATE: admin/uff.tec./ammin. sempre; altri solo se autore o assegnatario
CREATE POLICY crm_attivita_upd ON public.crm_attivita FOR UPDATE TO authenticated
  USING (
    has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
    OR ((created_by = auth.uid() OR assegnata_a = auth.uid())
        AND has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[]))
  )
  WITH CHECK (
    has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
    OR ((created_by = auth.uid() OR assegnata_a = auth.uid())
        AND has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[]))
  );

CREATE POLICY crm_attivita_del ON public.crm_attivita FOR DELETE TO authenticated
  USING (has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

CREATE TRIGGER tg_crm_attivita_upd BEFORE UPDATE ON public.crm_attivita
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Trigger: completata_at coerente con stato
CREATE OR REPLACE FUNCTION public.tg_attivita_completata() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.stato = 'completata' AND NEW.completata_at IS NULL THEN
    NEW.completata_at := now();
  ELSIF NEW.stato <> 'completata' THEN
    NEW.completata_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_crm_attivita_completata BEFORE INSERT OR UPDATE ON public.crm_attivita
  FOR EACH ROW EXECUTE FUNCTION public.tg_attivita_completata();

-- 5) Aggiorna policy clienti: escludi operaio da SELECT, DELETE solo proprietario
DROP POLICY IF EXISTS clienti_sel ON public.clienti;
CREATE POLICY clienti_sel ON public.clienti FOR SELECT TO authenticated
  USING (has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]));

DROP POLICY IF EXISTS clienti_del ON public.clienti;
CREATE POLICY clienti_del ON public.clienti FOR DELETE TO authenticated
  USING (has_any_role(organization_id, ARRAY['proprietario']::app_role[]));

-- 6) Helper: verifica che il responsabile appartenga alla stessa org e sia interno attivo
CREATE OR REPLACE FUNCTION public.is_valid_responsabile(_user uuid, _org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = _user
      AND p.organization_id = _org
      AND coalesce(p.is_active, true) = true
      AND ur.organization_id = _org
      AND ur.role IN ('proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere')
  );
$$;
