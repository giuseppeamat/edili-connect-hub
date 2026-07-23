
-- ==========================================================
-- Sprint 3 – Blocco A: schema Preventivi
-- ==========================================================

-- 1) Estensione enum preventivo_stato (i nuovi valori NON vengono usati in questa migration)
ALTER TYPE public.preventivo_stato ADD VALUE IF NOT EXISTS 'in_revisione';
ALTER TYPE public.preventivo_stato ADD VALUE IF NOT EXISTS 'pronto';
ALTER TYPE public.preventivo_stato ADD VALUE IF NOT EXISTS 'annullato';
ALTER TYPE public.preventivo_stato ADD VALUE IF NOT EXISTS 'convertito';

-- 2) Nuovo enum tipo preventivo
DO $$ BEGIN
  CREATE TYPE public.preventivo_tipo AS ENUM (
    'lavori_edili','ristrutturazione','manutenzione','fornitura_posa','consulenza','altro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Preventivi: nuove colonne
ALTER TABLE public.preventivi
  ADD COLUMN IF NOT EXISTS titolo TEXT,
  ADD COLUMN IF NOT EXISTS tipo public.preventivo_tipo,
  ADD COLUMN IF NOT EXISTS responsabile_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_invio DATE,
  ADD COLUMN IF NOT EXISTS data_accettazione DATE,
  ADD COLUMN IF NOT EXISTS data_rifiuto DATE,
  ADD COLUMN IF NOT EXISTS motivo_rifiuto TEXT,
  ADD COLUMN IF NOT EXISTS annullato_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS convertito_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sconto_globale_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maggiorazione_globale_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spese_accessorie NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_default_pct NUMERIC(6,2) NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS condizioni_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS tempi_esecuzione TEXT,
  ADD COLUMN IF NOT EXISTS esclusioni TEXT,
  ADD COLUMN IF NOT EXISTS garanzie TEXT,
  ADD COLUMN IF NOT EXISTS condizioni_generali TEXT,
  ADD COLUMN IF NOT EXISTS firma_referente TEXT,
  ADD COLUMN IF NOT EXISTS root_preventivo_id UUID,
  ADD COLUMN IF NOT EXISTS parent_version_id UUID,
  ADD COLUMN IF NOT EXISTS is_current_version BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by UUID,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_nuova_versione TEXT;

-- Init root_preventivo_id = id per righe esistenti
UPDATE public.preventivi SET root_preventivo_id = id WHERE root_preventivo_id IS NULL;

-- Auto FK su radice/parent/superseded_by (self, con composite anti-cross-tenant)
DO $$ BEGIN
  ALTER TABLE public.preventivi
    ADD CONSTRAINT preventivi_root_org_fkey
    FOREIGN KEY (root_preventivo_id, organization_id)
    REFERENCES public.preventivi(id, organization_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.preventivi
    ADD CONSTRAINT preventivi_parent_org_fkey
    FOREIGN KEY (parent_version_id, organization_id)
    REFERENCES public.preventivi(id, organization_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.preventivi
    ADD CONSTRAINT preventivi_superseded_by_org_fkey
    FOREIGN KEY (superseded_by, organization_id)
    REFERENCES public.preventivi(id, organization_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indici
CREATE INDEX IF NOT EXISTS preventivi_root_idx ON public.preventivi (root_preventivo_id);
CREATE INDEX IF NOT EXISTS preventivi_responsabile_idx ON public.preventivi (responsabile_id);
CREATE INDEX IF NOT EXISTS preventivi_data_emissione_idx ON public.preventivi (data_preventivo);
CREATE INDEX IF NOT EXISTS preventivi_data_scadenza_idx ON public.preventivi (data_validita);
CREATE INDEX IF NOT EXISTS preventivi_org_current_idx ON public.preventivi (organization_id, is_current_version);
CREATE INDEX IF NOT EXISTS preventivi_updated_at_idx ON public.preventivi (updated_at);

-- 4) preventivo_categorie
CREATE TABLE IF NOT EXISTS public.preventivo_categorie (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  preventivo_id UUID NOT NULL,
  titolo TEXT NOT NULL,
  descrizione TEXT,
  posizione INTEGER NOT NULL DEFAULT 0,
  subtotale_ricavo NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotale_costo NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT preventivo_categorie_id_org_uniq UNIQUE (id, organization_id),
  CONSTRAINT preventivo_categorie_prev_org_fkey
    FOREIGN KEY (preventivo_id, organization_id)
    REFERENCES public.preventivi(id, organization_id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventivo_categorie TO authenticated;
GRANT ALL ON public.preventivo_categorie TO service_role;
ALTER TABLE public.preventivo_categorie ENABLE ROW LEVEL SECURITY;

CREATE POLICY "preventivo_categorie_sel" ON public.preventivo_categorie FOR SELECT TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa']::app_role[]));
CREATE POLICY "preventivo_categorie_ins" ON public.preventivo_categorie FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]));
CREATE POLICY "preventivo_categorie_upd" ON public.preventivo_categorie FOR UPDATE TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]))
  WITH CHECK (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]));
CREATE POLICY "preventivo_categorie_del" ON public.preventivo_categorie FOR DELETE TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]));

CREATE INDEX IF NOT EXISTS preventivo_categorie_org_idx ON public.preventivo_categorie (organization_id);
CREATE INDEX IF NOT EXISTS preventivo_categorie_prev_idx ON public.preventivo_categorie (preventivo_id);
CREATE INDEX IF NOT EXISTS preventivo_categorie_prev_pos_idx ON public.preventivo_categorie (preventivo_id, posizione);

CREATE TRIGGER tg_preventivo_categorie_upd BEFORE UPDATE ON public.preventivo_categorie
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5) preventivo_voci: nuove colonne + updated_at
ALTER TABLE public.preventivo_voci
  ADD COLUMN IF NOT EXISTS categoria_id UUID,
  ADD COLUMN IF NOT EXISTS codice TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS maggiorazione_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importo_netto NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_totale NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margine NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margine_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.preventivo_voci
    ADD CONSTRAINT preventivo_voci_categoria_org_fkey
    FOREIGN KEY (categoria_id, organization_id)
    REFERENCES public.preventivo_categorie(id, organization_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS preventivo_voci_categoria_idx ON public.preventivo_voci (categoria_id);
CREATE INDEX IF NOT EXISTS preventivo_voci_prev_ord_idx ON public.preventivo_voci (preventivo_id, ordine);

DO $$ BEGIN
  CREATE TRIGGER tg_preventivo_voci_upd BEFORE UPDATE ON public.preventivo_voci
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Vincoli economici (validazione soft — non blocca dati esistenti)
DO $$ BEGIN
  ALTER TABLE public.preventivo_voci
    ADD CONSTRAINT preventivo_voci_quantita_chk CHECK (quantita >= 0),
    ADD CONSTRAINT preventivo_voci_prezzo_chk CHECK (prezzo_unitario >= 0),
    ADD CONSTRAINT preventivo_voci_costo_chk CHECK (costo_unitario >= 0),
    ADD CONSTRAINT preventivo_voci_sconto_chk CHECK (sconto_pct BETWEEN 0 AND 100),
    ADD CONSTRAINT preventivo_voci_magg_chk CHECK (maggiorazione_pct >= 0),
    ADD CONSTRAINT preventivo_voci_iva_chk CHECK (iva_pct >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6) Migrazione dati: crea categoria "Generale" per ogni preventivo che ha voci senza categoria
DO $$
DECLARE
  r RECORD;
  new_cat_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT p.id AS preventivo_id, p.organization_id
    FROM public.preventivi p
    JOIN public.preventivo_voci v ON v.preventivo_id = p.id
    WHERE v.categoria_id IS NULL
  LOOP
    INSERT INTO public.preventivo_categorie (organization_id, preventivo_id, titolo, posizione)
    VALUES (r.organization_id, r.preventivo_id, 'Generale', 0)
    RETURNING id INTO new_cat_id;

    UPDATE public.preventivo_voci
      SET categoria_id = new_cat_id
      WHERE preventivo_id = r.preventivo_id AND categoria_id IS NULL;
  END LOOP;
END $$;

-- 7) Trigger di calcolo voce aggiornato (retro-compatibile)
CREATE OR REPLACE FUNCTION public.tg_calc_voce()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  lordo NUMERIC(14,4);
  sconto NUMERIC(14,4);
  scontato NUMERIC(14,4);
  maggior NUMERIC(14,4);
  netto NUMERIC(14,2);
  costo_t NUMERIC(14,2);
BEGIN
  IF NEW.prezzo_unitario = 0 AND NEW.costo_unitario > 0 THEN
    NEW.prezzo_unitario := ROUND(NEW.costo_unitario * (1 + COALESCE(NEW.ricarico_pct,0)/100), 4);
  END IF;

  lordo := NEW.prezzo_unitario * NEW.quantita;
  sconto := lordo * COALESCE(NEW.sconto_pct,0) / 100;
  scontato := lordo - sconto;
  maggior := scontato * COALESCE(NEW.maggiorazione_pct,0) / 100;
  netto := ROUND(scontato + maggior, 2);
  costo_t := ROUND(NEW.costo_unitario * NEW.quantita, 2);

  NEW.importo_netto := netto;
  NEW.costo_totale := costo_t;
  NEW.totale := netto; -- retro-compat (imponibile)
  NEW.margine := netto - costo_t;
  NEW.margine_pct := CASE WHEN netto > 0 THEN ROUND((netto - costo_t) / netto * 100, 2) ELSE 0 END;
  RETURN NEW;
END;
$function$;

-- 8) Trigger ricalcolo preventivo esteso (usa sconto/maggiorazione/spese globali)
CREATE OR REPLACE FUNCTION public.tg_recalc_preventivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  pid UUID;
  netto NUMERIC(14,2);
  costo NUMERIC(14,2);
  iva NUMERIC(14,2);
  sconto_g NUMERIC(6,2);
  magg_g NUMERIC(6,2);
  spese NUMERIC(14,2);
  imponibile NUMERIC(14,2);
BEGIN
  pid := COALESCE(NEW.preventivo_id, OLD.preventivo_id);

  SELECT
    COALESCE(SUM(v.importo_netto),0),
    COALESCE(SUM(v.costo_totale),0),
    COALESCE(SUM(v.importo_netto * v.iva_pct / 100),0)
  INTO netto, costo, iva
  FROM public.preventivo_voci v
  WHERE v.preventivo_id = pid;

  SELECT
    COALESCE(sconto_globale_pct,0),
    COALESCE(maggiorazione_globale_pct,0),
    COALESCE(spese_accessorie,0)
  INTO sconto_g, magg_g, spese
  FROM public.preventivi WHERE id = pid;

  imponibile := ROUND(netto * (1 - sconto_g/100) * (1 + magg_g/100) + spese, 2);

  UPDATE public.preventivi p SET
    totale_costo = costo,
    totale_ricavo = imponibile,
    totale_iva = ROUND(imponibile * (CASE WHEN netto > 0 THEN iva/netto ELSE 0 END), 2),
    totale = ROUND(imponibile + imponibile * (CASE WHEN netto > 0 THEN iva/netto ELSE 0 END), 2),
    margine = imponibile - costo,
    updated_at = now()
  WHERE p.id = pid;

  -- Aggiorna subtotali categoria
  UPDATE public.preventivo_categorie c SET
    subtotale_ricavo = COALESCE((SELECT SUM(v.importo_netto) FROM public.preventivo_voci v WHERE v.categoria_id = c.id),0),
    subtotale_costo = COALESCE((SELECT SUM(v.costo_totale) FROM public.preventivo_voci v WHERE v.categoria_id = c.id),0),
    updated_at = now()
  WHERE c.preventivo_id = pid;

  RETURN NULL;
END;
$function$;

-- Ricalcolo immediato di tutti i preventivi esistenti (touch)
UPDATE public.preventivo_voci SET updated_at = now();

-- 9) preventivo_storico_stati (immutabile lato client)
CREATE TABLE IF NOT EXISTS public.preventivo_storico_stati (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  preventivo_id UUID NOT NULL,
  stato_precedente public.preventivo_stato,
  stato_nuovo public.preventivo_stato NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT preventivo_storico_prev_org_fkey
    FOREIGN KEY (preventivo_id, organization_id)
    REFERENCES public.preventivi(id, organization_id) ON DELETE CASCADE
);
-- Nessun grant di INSERT/UPDATE/DELETE agli utenti: solo lettura via RLS, scritture solo via server-side (service_role o SECURITY DEFINER)
GRANT SELECT ON public.preventivo_storico_stati TO authenticated;
GRANT ALL ON public.preventivo_storico_stati TO service_role;
ALTER TABLE public.preventivo_storico_stati ENABLE ROW LEVEL SECURITY;

CREATE POLICY "preventivo_storico_sel" ON public.preventivo_storico_stati FOR SELECT TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa']::app_role[]));

CREATE INDEX IF NOT EXISTS preventivo_storico_org_idx ON public.preventivo_storico_stati (organization_id);
CREATE INDEX IF NOT EXISTS preventivo_storico_prev_idx ON public.preventivo_storico_stati (preventivo_id);
CREATE INDEX IF NOT EXISTS preventivo_storico_changed_idx ON public.preventivo_storico_stati (changed_at);

-- 10) preventivo_templates
CREATE TABLE IF NOT EXISTS public.preventivo_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descrizione TEXT,
  iva_default_pct NUMERIC(6,2) NOT NULL DEFAULT 22,
  condizioni_pagamento TEXT,
  tempi_esecuzione TEXT,
  esclusioni TEXT,
  garanzie TEXT,
  condizioni_generali TEXT,
  attivo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT preventivo_templates_org_nome_uniq UNIQUE (organization_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventivo_templates TO authenticated;
GRANT ALL ON public.preventivo_templates TO service_role;
ALTER TABLE public.preventivo_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "preventivo_templates_sel" ON public.preventivo_templates FOR SELECT TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa']::app_role[]));
CREATE POLICY "preventivo_templates_ins" ON public.preventivo_templates FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]));
CREATE POLICY "preventivo_templates_upd" ON public.preventivo_templates FOR UPDATE TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]))
  WITH CHECK (public.has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]));
CREATE POLICY "preventivo_templates_del" ON public.preventivo_templates FOR DELETE TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario','amministratore']::app_role[]));

CREATE INDEX IF NOT EXISTS preventivo_templates_org_attivo_idx ON public.preventivo_templates (organization_id, attivo);

DO $$ BEGIN
  CREATE TRIGGER tg_preventivo_templates_upd BEFORE UPDATE ON public.preventivo_templates
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 11) documenti.preventivo_id
ALTER TABLE public.documenti ADD COLUMN IF NOT EXISTS preventivo_id UUID;
DO $$ BEGIN
  ALTER TABLE public.documenti
    ADD CONSTRAINT documenti_preventivo_id_fkey FOREIGN KEY (preventivo_id)
      REFERENCES public.preventivi(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.documenti
    ADD CONSTRAINT documenti_preventivo_org_fkey FOREIGN KEY (preventivo_id, organization_id)
      REFERENCES public.preventivi(id, organization_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS documenti_preventivo_idx ON public.documenti (preventivo_id);

-- 12) Vincolo: impedire doppia conversione (una sola commessa per preventivo)
CREATE UNIQUE INDEX IF NOT EXISTS commesse_preventivo_uniq
  ON public.commesse (preventivo_id) WHERE preventivo_id IS NOT NULL;

-- 13) Funzione numerazione atomica (advisory lock per anno/org)
CREATE OR REPLACE FUNCTION public.assign_preventivo_numero(_org UUID, _anno INT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  next_n INT;
  numero TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_org::text || '|' || _anno::text, 0));

  SELECT COALESCE(MAX(
    CASE WHEN numero ~ ('^PREV-' || _anno || '-\d+$')
      THEN CAST(split_part(numero, '-', 3) AS INT)
      ELSE 0 END
  ), 0) + 1
  INTO next_n
  FROM public.preventivi
  WHERE organization_id = _org;

  numero := 'PREV-' || _anno || '-' || LPAD(next_n::text, 4, '0');
  RETURN numero;
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_preventivo_numero(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_preventivo_numero(UUID, INT) TO authenticated, service_role;
