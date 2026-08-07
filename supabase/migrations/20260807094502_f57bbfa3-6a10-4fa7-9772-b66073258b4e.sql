-- ═══════════════ ENUMS ═══════════════
CREATE TYPE public.costo_periodicita AS ENUM ('mensile','trimestrale','semestrale','annuale','una_tantum','ammortizzato');
CREATE TYPE public.costo_orario_stato AS ENUM ('bozza','calcolato','approvato','archiviato');
CREATE TYPE public.cs_modalita AS ENUM ('nessuno','orario','percentuale','manuale');
CREATE TYPE public.cs_tipo_personale AS ENUM ('non_applicabile','diretto','indiretto','amministrazione','titolari','tecnico');

-- ═══════════════ CATEGORIE ═══════════════
CREATE TABLE public.costi_struttura_categorie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  gruppo text NOT NULL,
  nome text NOT NULL,
  descrizione text,
  ordine integer NOT NULL DEFAULT 0,
  is_sistema boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, gruppo, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.costi_struttura_categorie TO authenticated;
GRANT ALL ON public.costi_struttura_categorie TO service_role;
ALTER TABLE public.costi_struttura_categorie ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cs_cat_select" ON public.costi_struttura_categorie FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
CREATE POLICY "cs_cat_write" ON public.costi_struttura_categorie FOR ALL TO authenticated
  USING (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]))
  WITH CHECK (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

-- ═══════════════ COSTI ═══════════════
CREATE TABLE public.costi_struttura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  categoria_id uuid NOT NULL,
  descrizione text NOT NULL,
  importo numeric(14,2) NOT NULL DEFAULT 0 CHECK (importo >= 0),
  periodicita public.costo_periodicita NOT NULL DEFAULT 'mensile',
  data_inizio date NOT NULL DEFAULT current_date,
  data_fine date,
  anno_riferimento integer NOT NULL CHECK (anno_riferimento BETWEEN 1990 AND 2200),
  mese_riferimento integer CHECK (mese_riferimento BETWEEN 1 AND 12),
  fornitore_id uuid,
  documento_id uuid,
  tipo_personale public.cs_tipo_personale NOT NULL DEFAULT 'non_applicabile',
  anni_ammortamento integer CHECK (anni_ammortamento IS NULL OR anni_ammortamento > 0),
  data_inizio_ammortamento date,
  valore_residuo numeric(14,2) CHECK (valore_residuo IS NULL OR valore_residuo >= 0),
  quota_annua numeric(14,2) GENERATED ALWAYS AS (
    CASE periodicita
      WHEN 'mensile' THEN importo * 12
      WHEN 'trimestrale' THEN importo * 4
      WHEN 'semestrale' THEN importo * 2
      WHEN 'annuale' THEN importo
      WHEN 'una_tantum' THEN importo
      WHEN 'ammortizzato' THEN CASE WHEN COALESCE(anni_ammortamento,0) > 0
        THEN (importo - COALESCE(valore_residuo,0)) / anni_ammortamento ELSE 0 END
    END
  ) STORED,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  CONSTRAINT costi_struttura_categoria_fk FOREIGN KEY (categoria_id, organization_id)
    REFERENCES public.costi_struttura_categorie(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT costi_struttura_fornitore_fk FOREIGN KEY (fornitore_id, organization_id)
    REFERENCES public.fornitori(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT costi_struttura_ammortamento_ck CHECK (
    periodicita <> 'ammortizzato' OR (anni_ammortamento IS NOT NULL AND data_inizio_ammortamento IS NOT NULL)
  ),
  CONSTRAINT costi_struttura_periodo_ck CHECK (data_fine IS NULL OR data_fine >= data_inizio)
);
CREATE INDEX costi_struttura_org_anno_idx ON public.costi_struttura(organization_id, anno_riferimento);
CREATE INDEX costi_struttura_cat_idx ON public.costi_struttura(categoria_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.costi_struttura TO authenticated;
GRANT ALL ON public.costi_struttura TO service_role;
ALTER TABLE public.costi_struttura ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cs_select" ON public.costi_struttura FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
CREATE POLICY "cs_write" ON public.costi_struttura FOR ALL TO authenticated
  USING (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]))
  WITH CHECK (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

-- ═══════════════ ORE PRODUTTIVE ═══════════════
CREATE TABLE public.ore_produttive_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  anno integer NOT NULL CHECK (anno BETWEEN 1990 AND 2200),
  dipendenti_produttivi numeric(10,2) NOT NULL DEFAULT 0 CHECK (dipendenti_produttivi >= 0),
  ore_teoriche_persona numeric(10,2) NOT NULL DEFAULT 2080 CHECK (ore_teoriche_persona >= 0),
  ore_ferie numeric(10,2) NOT NULL DEFAULT 0 CHECK (ore_ferie >= 0),
  ore_permessi numeric(10,2) NOT NULL DEFAULT 0 CHECK (ore_permessi >= 0),
  ore_festivita numeric(10,2) NOT NULL DEFAULT 0 CHECK (ore_festivita >= 0),
  ore_malattia numeric(10,2) NOT NULL DEFAULT 0 CHECK (ore_malattia >= 0),
  ore_formazione numeric(10,2) NOT NULL DEFAULT 0 CHECK (ore_formazione >= 0),
  ore_amministrative numeric(10,2) NOT NULL DEFAULT 0 CHECK (ore_amministrative >= 0),
  ore_non_produttive_altre numeric(10,2) NOT NULL DEFAULT 0 CHECK (ore_non_produttive_altre >= 0),
  ore_produttive_manuali numeric(12,2) CHECK (ore_produttive_manuali IS NULL OR ore_produttive_manuali >= 0),
  usa_manuale boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (organization_id, anno)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ore_produttive_config TO authenticated;
GRANT ALL ON public.ore_produttive_config TO service_role;
ALTER TABLE public.ore_produttive_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opc_select" ON public.ore_produttive_config FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
CREATE POLICY "opc_write" ON public.ore_produttive_config FOR ALL TO authenticated
  USING (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]))
  WITH CHECK (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

-- ═══════════════ CONFIG ECONOMICA ═══════════════
CREATE TABLE public.costi_struttura_config (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  includi_personale_diretto boolean NOT NULL DEFAULT false,
  includi_costo_personale_in_industriale boolean NOT NULL DEFAULT true,
  includi_costo_struttura_in_industriale boolean NOT NULL DEFAULT true,
  includi_costo_mezzi_in_industriale boolean NOT NULL DEFAULT false,
  costo_mezzi_orario numeric(12,4) NOT NULL DEFAULT 0 CHECK (costo_mezzi_orario >= 0),
  altri_overhead_orario numeric(12,4) NOT NULL DEFAULT 0 CHECK (altri_overhead_orario >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.costi_struttura_config TO authenticated;
GRANT ALL ON public.costi_struttura_config TO service_role;
ALTER TABLE public.costi_struttura_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "csc_select" ON public.costi_struttura_config FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
CREATE POLICY "csc_write" ON public.costi_struttura_config FOR ALL TO authenticated
  USING (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]))
  WITH CHECK (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

-- ═══════════════ VERSIONI COSTO ORARIO ═══════════════
CREATE TABLE public.costo_orario_versioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  anno integer NOT NULL CHECK (anno BETWEEN 1990 AND 2200),
  versione integer NOT NULL CHECK (versione > 0),
  totale_costi_annualizzati numeric(14,2) NOT NULL DEFAULT 0,
  ore_produttive numeric(12,2) NOT NULL DEFAULT 0,
  costo_orario_struttura numeric(12,4) NOT NULL DEFAULT 0,
  costo_personale_medio numeric(12,4) NOT NULL DEFAULT 0,
  costo_mezzi_orario numeric(12,4) NOT NULL DEFAULT 0,
  altri_overhead_orario numeric(12,4) NOT NULL DEFAULT 0,
  costo_industriale_orario numeric(12,4) NOT NULL DEFAULT 0,
  componenti jsonb NOT NULL DEFAULT '{}'::jsonb,
  origine text NOT NULL DEFAULT 'calcolo',
  stato public.costo_orario_stato NOT NULL DEFAULT 'bozza',
  note text,
  data_calcolo timestamptz NOT NULL DEFAULT now(),
  approvato_da uuid,
  approvato_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, anno, versione)
);
CREATE INDEX cov_org_anno_idx ON public.costo_orario_versioni(organization_id, anno DESC, versione DESC);
GRANT SELECT, INSERT, UPDATE ON public.costo_orario_versioni TO authenticated;
GRANT ALL ON public.costo_orario_versioni TO service_role;
ALTER TABLE public.costo_orario_versioni ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cov_select" ON public.costo_orario_versioni FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
CREATE POLICY "cov_write" ON public.costo_orario_versioni FOR ALL TO authenticated
  USING (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]))
  WITH CHECK (organization_id = public.current_organization_id() AND public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

-- versione approvata immutabile (salvo archiviazione)
CREATE OR REPLACE FUNCTION public._cov_immutable_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.stato = 'approvato' THEN
    IF NEW.stato = 'archiviato' AND
       NEW.totale_costi_annualizzati = OLD.totale_costi_annualizzati AND
       NEW.ore_produttive = OLD.ore_produttive AND
       NEW.costo_orario_struttura = OLD.costo_orario_struttura THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Una versione approvata non è modificabile: crea una nuova versione';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER cov_immutable BEFORE UPDATE ON public.costo_orario_versioni
  FOR EACH ROW EXECUTE FUNCTION public._cov_immutable_guard();

-- ═══════════════ PREVENTIVI: costo struttura congelato ═══════════════
ALTER TABLE public.preventivi
  ADD COLUMN costo_struttura_modalita public.cs_modalita NOT NULL DEFAULT 'nessuno',
  ADD COLUMN costo_struttura_ore numeric(12,2) NOT NULL DEFAULT 0 CHECK (costo_struttura_ore >= 0),
  ADD COLUMN costo_struttura_tariffa numeric(12,4) NOT NULL DEFAULT 0 CHECK (costo_struttura_tariffa >= 0),
  ADD COLUMN costo_struttura_pct numeric(6,2) NOT NULL DEFAULT 0 CHECK (costo_struttura_pct >= 0),
  ADD COLUMN costo_struttura_importo numeric(14,2) NOT NULL DEFAULT 0 CHECK (costo_struttura_importo >= 0),
  ADD COLUMN costo_struttura_versione_id uuid,
  ADD COLUMN costo_struttura_versione_label text,
  ADD CONSTRAINT preventivi_cs_versione_fk FOREIGN KEY (costo_struttura_versione_id, organization_id)
    REFERENCES public.costo_orario_versioni(id, organization_id) ON DELETE SET NULL;

-- ═══════════════ AUDIT TRIGGER COSTI ═══════════════
CREATE OR REPLACE FUNCTION public._cs_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._log_audit(NEW.organization_id, 'costo_struttura_creato', 'costi_struttura', NEW.id,
      jsonb_build_object('descrizione', NEW.descrizione, 'importo', NEW.importo, 'periodicita', NEW.periodicita));
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN _action := 'costo_struttura_archiviato';
  ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN _action := 'costo_struttura_ripristinato';
  ELSE _action := 'costo_struttura_modificato';
  END IF;
  PERFORM public._log_audit(NEW.organization_id, _action, 'costi_struttura', NEW.id,
    jsonb_build_object('importo', NEW.importo, 'periodicita', NEW.periodicita));
  RETURN NEW;
END; $$;
CREATE TRIGGER cs_audit_ins AFTER INSERT ON public.costi_struttura
  FOR EACH ROW EXECUTE FUNCTION public._cs_audit();
CREATE TRIGGER cs_audit_upd BEFORE UPDATE ON public.costi_struttura
  FOR EACH ROW EXECUTE FUNCTION public._cs_audit();

CREATE OR REPLACE FUNCTION public._cs_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER cs_cat_touch BEFORE UPDATE ON public.costi_struttura_categorie
  FOR EACH ROW EXECUTE FUNCTION public._cs_touch_updated_at();
CREATE TRIGGER opc_touch BEFORE UPDATE ON public.ore_produttive_config
  FOR EACH ROW EXECUTE FUNCTION public._cs_touch_updated_at();
CREATE TRIGGER csc_touch BEFORE UPDATE ON public.costi_struttura_config
  FOR EACH ROW EXECUTE FUNCTION public._cs_touch_updated_at();

-- ═══════════════ SEED CATEGORIE DI SISTEMA ═══════════════
CREATE OR REPLACE FUNCTION public.ensure_costi_struttura_categorie(_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.costi_struttura_categorie (organization_id, gruppo, nome, ordine, is_sistema)
  SELECT _org, g, n, o, true FROM (VALUES
    ('PERSONALE_INDIRETTO','Stipendi lordi',10),
    ('PERSONALE_INDIRETTO','Contributi',11),
    ('PERSONALE_INDIRETTO','Assicurazioni personale',12),
    ('PERSONALE_INDIRETTO','Amministrazione',13),
    ('PERSONALE_INDIRETTO','Personale non imputato a commessa',14),
    ('IMMOBILI','Affitti',20),
    ('IMMOBILI','Utenze',21),
    ('IMMOBILI','Manutenzioni immobili',22),
    ('IMMOBILI','Spese condominiali',23),
    ('MEZZI_ATTREZZATURE','Acquisto mezzi',30),
    ('MEZZI_ATTREZZATURE','Leasing',31),
    ('MEZZI_ATTREZZATURE','Noleggi',32),
    ('MEZZI_ATTREZZATURE','Manutenzioni mezzi',33),
    ('MEZZI_ATTREZZATURE','Assicurazioni mezzi',34),
    ('MEZZI_ATTREZZATURE','Carburanti',35),
    ('MEZZI_ATTREZZATURE','Attrezzature',36),
    ('SERVIZI','Commercialista',40),
    ('SERVIZI','Consulenze',41),
    ('SERVIZI','Software',42),
    ('SERVIZI','Telefonia',43),
    ('SERVIZI','Servizi IT',44),
    ('SERVIZI','Banche',45),
    ('MARKETING','Sponsorizzazioni',50),
    ('MARKETING','Pubblicità',51),
    ('MARKETING','Comunicazione',52),
    ('SICUREZZA','DPI',60),
    ('SICUREZZA','Formazione sicurezza',61),
    ('SICUREZZA','Visite mediche',62),
    ('SICUREZZA','Consulenze sicurezza',63),
    ('ASSICURAZIONI','RC aziendale',70),
    ('ASSICURAZIONI','Assicurazioni generali',71),
    ('ASSICURAZIONI','Polizze',72),
    ('AMMINISTRAZIONE','Spese bancarie',80),
    ('AMMINISTRAZIONE','Cancelleria',81),
    ('AMMINISTRAZIONE','Pratiche',82),
    ('AMMINISTRAZIONE','Commissioni',83),
    ('AMMINISTRAZIONE','Altri costi amministrativi',84),
    ('ALTRO','Altri costi generali',90)
  ) AS t(g,n,o)
  ON CONFLICT (organization_id, gruppo, nome) DO NOTHING;

  INSERT INTO public.costi_struttura_config (organization_id) VALUES (_org)
  ON CONFLICT (organization_id) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.ensure_costi_struttura_categorie(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_costi_struttura_categorie(uuid) TO authenticated, service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.ensure_costi_struttura_categorie(r.id);
  END LOOP;
END $$;