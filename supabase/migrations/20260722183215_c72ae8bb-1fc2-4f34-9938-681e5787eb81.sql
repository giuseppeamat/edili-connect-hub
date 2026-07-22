
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM (
  'proprietario','amministratore','ufficio_tecnico','amministrazione',
  'responsabile_commessa','capocantiere','operaio','cliente','fornitore'
);

CREATE TYPE public.preventivo_stato AS ENUM ('bozza','inviato','accettato','rifiutato','scaduto');
CREATE TYPE public.commessa_stato AS ENUM ('pianificata','in_corso','sospesa','completata','annullata');
CREATE TYPE public.documento_stato AS ENUM ('valido','in_scadenza','scaduto','archiviato');
CREATE TYPE public.documento_visibilita AS ENUM ('privato','organizzazione','pubblico');

-- =========================================================
-- ORGANIZATIONS
-- =========================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  partita_iva TEXT,
  codice_fiscale TEXT,
  indirizzo TEXT,
  citta TEXT,
  cap TEXT,
  provincia TEXT,
  telefono TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  nome TEXT,
  cognome TEXT,
  email TEXT,
  telefono TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- USER ROLES
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- SECURITY DEFINER HELPERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _org UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND organization_id = _org AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_org UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND organization_id = _org
  );
$$;

-- =========================================================
-- CLIENTI
-- =========================================================
CREATE TABLE public.clienti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ragione_sociale TEXT NOT NULL,
  partita_iva TEXT,
  codice_fiscale TEXT,
  indirizzo TEXT,
  citta TEXT,
  cap TEXT,
  provincia TEXT,
  telefono TEXT,
  email TEXT,
  pec TEXT,
  referente TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clienti TO authenticated;
GRANT ALL ON public.clienti TO service_role;
ALTER TABLE public.clienti ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.clienti(organization_id);

-- =========================================================
-- FORNITORI
-- =========================================================
CREATE TABLE public.fornitori (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ragione_sociale TEXT NOT NULL,
  categoria TEXT,
  partita_iva TEXT,
  codice_fiscale TEXT,
  indirizzo TEXT,
  citta TEXT,
  cap TEXT,
  provincia TEXT,
  telefono TEXT,
  email TEXT,
  pec TEXT,
  referente TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fornitori TO authenticated;
GRANT ALL ON public.fornitori TO service_role;
ALTER TABLE public.fornitori ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.fornitori(organization_id);

-- =========================================================
-- PREVENTIVI
-- =========================================================
CREATE TABLE public.preventivi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE SET NULL,
  numero TEXT NOT NULL,
  versione INT NOT NULL DEFAULT 1,
  oggetto TEXT NOT NULL,
  data_preventivo DATE NOT NULL DEFAULT CURRENT_DATE,
  data_validita DATE,
  stato public.preventivo_stato NOT NULL DEFAULT 'bozza',
  totale_costo NUMERIC(14,2) NOT NULL DEFAULT 0,
  totale_ricavo NUMERIC(14,2) NOT NULL DEFAULT 0,
  totale_iva NUMERIC(14,2) NOT NULL DEFAULT 0,
  totale NUMERIC(14,2) NOT NULL DEFAULT 0,
  margine NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventivi TO authenticated;
GRANT ALL ON public.preventivi TO service_role;
ALTER TABLE public.preventivi ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.preventivi(organization_id);

-- =========================================================
-- PREVENTIVO VOCI
-- =========================================================
CREATE TABLE public.preventivo_voci (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  preventivo_id UUID NOT NULL REFERENCES public.preventivi(id) ON DELETE CASCADE,
  ordine INT NOT NULL DEFAULT 0,
  capitolo TEXT,
  categoria TEXT,
  descrizione TEXT NOT NULL,
  unita_misura TEXT,
  quantita NUMERIC(14,3) NOT NULL DEFAULT 1,
  costo_unitario NUMERIC(14,4) NOT NULL DEFAULT 0,
  ricarico_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  prezzo_unitario NUMERIC(14,4) NOT NULL DEFAULT 0,
  sconto_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  iva_pct NUMERIC(6,2) NOT NULL DEFAULT 22,
  totale NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventivo_voci TO authenticated;
GRANT ALL ON public.preventivo_voci TO service_role;
ALTER TABLE public.preventivo_voci ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.preventivo_voci(preventivo_id);

-- =========================================================
-- COMMESSE / CANTIERI
-- =========================================================
CREATE TABLE public.commesse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE SET NULL,
  preventivo_id UUID REFERENCES public.preventivi(id) ON DELETE SET NULL,
  responsabile_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  codice TEXT NOT NULL,
  denominazione TEXT NOT NULL,
  indirizzo_cantiere TEXT,
  data_inizio DATE,
  data_fine_prevista DATE,
  data_fine_effettiva DATE,
  importo NUMERIC(14,2) NOT NULL DEFAULT 0,
  budget_costi NUMERIC(14,2) NOT NULL DEFAULT 0,
  costi_sostenuti NUMERIC(14,2) NOT NULL DEFAULT 0,
  avanzamento_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  stato public.commessa_stato NOT NULL DEFAULT 'pianificata',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commesse TO authenticated;
GRANT ALL ON public.commesse TO service_role;
ALTER TABLE public.commesse ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.commesse(organization_id);

-- =========================================================
-- RAPPORTINI
-- =========================================================
CREATE TABLE public.rapportini (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commessa_id UUID REFERENCES public.commesse(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  ora_inizio TIME,
  ora_fine TIME,
  ore NUMERIC(5,2) NOT NULL DEFAULT 0,
  lavorazione TEXT,
  note TEXT,
  foto_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rapportini TO authenticated;
GRANT ALL ON public.rapportini TO service_role;
ALTER TABLE public.rapportini ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.rapportini(organization_id);

-- =========================================================
-- DOCUMENTI
-- =========================================================
CREATE TABLE public.documenti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  categoria TEXT,
  descrizione TEXT,
  storage_path TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  cliente_id UUID REFERENCES public.clienti(id) ON DELETE SET NULL,
  fornitore_id UUID REFERENCES public.fornitori(id) ON DELETE SET NULL,
  commessa_id UUID REFERENCES public.commesse(id) ON DELETE SET NULL,
  dipendente_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data_documento DATE,
  data_scadenza DATE,
  stato public.documento_stato NOT NULL DEFAULT 'valido',
  visibilita public.documento_visibilita NOT NULL DEFAULT 'organizzazione',
  tags TEXT[] DEFAULT '{}',
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documenti TO authenticated;
GRANT ALL ON public.documenti TO service_role;
ALTER TABLE public.documenti ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.documenti(organization_id);
CREATE INDEX ON public.documenti(data_scadenza);

-- =========================================================
-- AUDIT LOG
-- =========================================================
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.audit_log(organization_id, created_at DESC);

-- =========================================================
-- RLS POLICIES: organization scoped
-- =========================================================
-- organizations
CREATE POLICY "org_read_own" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY "org_update_own" ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_member(id));

-- profiles
CREATE POLICY "profiles_read_self_or_org" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR (organization_id IS NOT NULL AND public.is_org_member(organization_id)));
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- user_roles
CREATE POLICY "roles_read_org" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

-- Generic policy generator via DO block for the org-scoped tables
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'clienti','fornitori','preventivi','preventivo_voci',
    'commesse','rapportini','documenti'
  ]) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(organization_id));', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id));', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_org_member(organization_id));', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_org_member(organization_id));', t||'_del', t);
  END LOOP;
END$$;

-- audit_log
CREATE POLICY "audit_read_org" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "audit_insert_org" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

-- =========================================================
-- Trigger: updated_at
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'organizations','profiles','clienti','fornitori',
    'preventivi','commesse','documenti'
  ]) LOOP
    EXECUTE format('CREATE TRIGGER tg_%I_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();', t, t);
  END LOOP;
END$$;

-- =========================================================
-- Trigger: handle_new_user - creates org + profile + role
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_org_id UUID;
  org_name TEXT;
BEGIN
  org_name := COALESCE(NEW.raw_user_meta_data->>'organization_name', 'La mia impresa');

  INSERT INTO public.organizations (nome, email)
  VALUES (org_name, NEW.email)
  RETURNING id INTO new_org_id;

  INSERT INTO public.profiles (id, organization_id, email, nome, cognome)
  VALUES (
    NEW.id,
    new_org_id,
    NEW.email,
    NEW.raw_user_meta_data->>'nome',
    NEW.raw_user_meta_data->>'cognome'
  );

  INSERT INTO public.user_roles (user_id, organization_id, role)
  VALUES (NEW.id, new_org_id, 'proprietario');

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- Trigger: recalc preventivo voce totale + preventivo totali
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_calc_voce()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  imponibile NUMERIC(14,2);
BEGIN
  IF NEW.prezzo_unitario = 0 AND NEW.costo_unitario > 0 THEN
    NEW.prezzo_unitario := ROUND(NEW.costo_unitario * (1 + COALESCE(NEW.ricarico_pct,0)/100), 4);
  END IF;
  imponibile := ROUND(NEW.prezzo_unitario * NEW.quantita * (1 - COALESCE(NEW.sconto_pct,0)/100), 2);
  NEW.totale := imponibile;
  RETURN NEW;
END; $$;

CREATE TRIGGER tg_voce_calc
  BEFORE INSERT OR UPDATE ON public.preventivo_voci
  FOR EACH ROW EXECUTE FUNCTION public.tg_calc_voce();

CREATE OR REPLACE FUNCTION public.tg_recalc_preventivo()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  pid UUID;
BEGIN
  pid := COALESCE(NEW.preventivo_id, OLD.preventivo_id);
  UPDATE public.preventivi p SET
    totale_costo = COALESCE((SELECT SUM(v.costo_unitario * v.quantita) FROM public.preventivo_voci v WHERE v.preventivo_id = pid),0),
    totale_ricavo = COALESCE((SELECT SUM(v.totale) FROM public.preventivo_voci v WHERE v.preventivo_id = pid),0),
    totale_iva = COALESCE((SELECT SUM(v.totale * v.iva_pct/100) FROM public.preventivo_voci v WHERE v.preventivo_id = pid),0),
    totale = COALESCE((SELECT SUM(v.totale * (1 + v.iva_pct/100)) FROM public.preventivo_voci v WHERE v.preventivo_id = pid),0),
    margine = COALESCE((SELECT SUM(v.totale) - SUM(v.costo_unitario*v.quantita) FROM public.preventivo_voci v WHERE v.preventivo_id = pid),0),
    updated_at = now()
  WHERE p.id = pid;
  RETURN NULL;
END; $$;

CREATE TRIGGER tg_voce_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.preventivo_voci
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_preventivo();

-- =========================================================
-- Documento stato auto based on scadenza
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_doc_stato()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.data_scadenza IS NOT NULL THEN
    IF NEW.data_scadenza < CURRENT_DATE THEN NEW.stato := 'scaduto';
    ELSIF NEW.data_scadenza <= CURRENT_DATE + INTERVAL '30 days' THEN NEW.stato := 'in_scadenza';
    ELSE NEW.stato := 'valido';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER tg_doc_stato_calc
  BEFORE INSERT OR UPDATE ON public.documenti
  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_stato();
