-- ============================================================================
-- EVOLUZIONE RAPPORTINI: bolle, materiali, prezzi, subappaltatori
-- ============================================================================

-- 0) Helper economico -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_econ(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::app_role[]);
$$;
REVOKE ALL ON FUNCTION public.can_see_econ(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_econ(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_edit_rapportino_extra(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[]);
$$;
REVOKE ALL ON FUNCTION public.can_edit_rapportino_extra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_rapportino_extra(uuid) TO authenticated, service_role;

-- 1) Estensione fornitori ---------------------------------------------------
ALTER TABLE public.fornitori
  ADD COLUMN IF NOT EXISTS tipo_soggetto text NOT NULL DEFAULT 'fornitore',
  ADD COLUMN IF NOT EXISTS specializzazioni text[],
  ADD COLUMN IF NOT EXISTS stato_qualifica text NOT NULL DEFAULT 'da_verificare',
  ADD COLUMN IF NOT EXISTS note_operative text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.fornitori ADD CONSTRAINT fornitori_tipo_soggetto_chk
    CHECK (tipo_soggetto IN ('fornitore','subappaltatore','entrambi'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.fornitori ADD CONSTRAINT fornitori_stato_qualifica_chk
    CHECK (stato_qualifica IN ('da_verificare','qualificato','sospeso','non_idoneo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.fornitori ADD CONSTRAINT fornitori_id_org_uk UNIQUE (id, organization_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_fornitori_tipo ON public.fornitori(organization_id, tipo_soggetto);

-- 2) Documenti: collegamento a rapportino e subappaltatore ------------------
ALTER TABLE public.documenti
  ADD COLUMN IF NOT EXISTS rapportino_id uuid REFERENCES public.rapportini(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subappaltatore_id uuid REFERENCES public.fornitori(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documenti_rapportino ON public.documenti(organization_id, rapportino_id);
CREATE INDEX IF NOT EXISTS idx_documenti_subapp ON public.documenti(organization_id, subappaltatore_id);

-- 3) Personale: mansione ----------------------------------------------------
ALTER TABLE public.rapportini_personale ADD COLUMN IF NOT EXISTS mansione text;

-- 4) Anagrafica materiali ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.materiali (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  codice text,
  nome text NOT NULL,
  descrizione text,
  categoria text,
  unita_misura_predefinita text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT materiali_nome_nonempty CHECK (length(btrim(nome)) > 0),
  CONSTRAINT materiali_id_org_uk UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_materiali_nome ON public.materiali(organization_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_materiali_codice ON public.materiali(organization_id, lower(btrim(codice))) WHERE codice IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.materiali TO authenticated;
GRANT ALL ON public.materiali TO service_role;
ALTER TABLE public.materiali ENABLE ROW LEVEL SECURITY;

CREATE POLICY materiali_sel ON public.materiali FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id());
CREATE POLICY materiali_ins ON public.materiali FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_organization_id()
              AND public.can_edit_rapportino_extra(organization_id));
CREATE POLICY materiali_upd ON public.materiali FOR UPDATE TO authenticated
  USING (organization_id = public.current_organization_id()
         AND public.can_edit_rapportino_extra(organization_id))
  WITH CHECK (organization_id = public.current_organization_id());

-- 5) Bolle ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rapportini_bolle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rapportino_id uuid NOT NULL REFERENCES public.rapportini(id) ON DELETE CASCADE,
  commessa_id uuid NOT NULL REFERENCES public.commesse(id),
  cantiere_id uuid REFERENCES public.cantieri(id),
  fornitore_id uuid NOT NULL REFERENCES public.fornitori(id),
  numero_bolla text NOT NULL,
  data_bolla date NOT NULL,
  data_consegna date,
  note text,
  imponibile numeric(14,2),
  iva numeric(14,2),
  totale numeric(14,2),
  stato text NOT NULL DEFAULT 'registrata',
  documento_id uuid REFERENCES public.documenti(id) ON DELETE SET NULL,
  storage_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bolle_stato_chk CHECK (stato IN ('registrata','da_verificare','verificata','contabilizzata','annullata')),
  CONSTRAINT bolle_numero_nonempty CHECK (length(btrim(numero_bolla)) > 0),
  CONSTRAINT bolle_id_org_uk UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_bolle_rapportino ON public.rapportini_bolle(rapportino_id);
CREATE INDEX IF NOT EXISTS idx_bolle_commessa ON public.rapportini_bolle(organization_id, commessa_id);
CREATE INDEX IF NOT EXISTS idx_bolle_fornitore ON public.rapportini_bolle(organization_id, fornitore_id);

GRANT ALL ON public.rapportini_bolle TO service_role;
ALTER TABLE public.rapportini_bolle ENABLE ROW LEVEL SECURITY;
CREATE POLICY bolle_no_direct ON public.rapportini_bolle FOR SELECT TO authenticated USING (false);

CREATE TABLE IF NOT EXISTS public.rapportini_bolle_righe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bolla_id uuid NOT NULL REFERENCES public.rapportini_bolle(id) ON DELETE CASCADE,
  materiale_id uuid REFERENCES public.materiali(id),
  descrizione text NOT NULL,
  codice_articolo text,
  quantita numeric(14,3) NOT NULL,
  unita_misura text,
  prezzo_unitario numeric(14,4),
  sconto_pct numeric(6,3) NOT NULL DEFAULT 0,
  totale_riga numeric(14,2),
  iva_pct numeric(6,3),
  note text,
  posizione integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT righe_desc_nonempty CHECK (length(btrim(descrizione)) > 0),
  CONSTRAINT righe_qta_pos CHECK (quantita > 0),
  CONSTRAINT righe_sconto_chk CHECK (sconto_pct >= 0 AND sconto_pct <= 100),
  CONSTRAINT righe_prezzo_chk CHECK (prezzo_unitario IS NULL OR prezzo_unitario >= 0),
  CONSTRAINT righe_id_org_uk UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_bolle_righe_bolla ON public.rapportini_bolle_righe(bolla_id);
CREATE INDEX IF NOT EXISTS idx_bolle_righe_materiale ON public.rapportini_bolle_righe(organization_id, materiale_id);

GRANT ALL ON public.rapportini_bolle_righe TO service_role;
ALTER TABLE public.rapportini_bolle_righe ENABLE ROW LEVEL SECURITY;
CREATE POLICY bolle_righe_no_direct ON public.rapportini_bolle_righe FOR SELECT TO authenticated USING (false);

-- 6) Storico prezzi materiali ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.materiali_prezzi_fornitori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  materiale_id uuid REFERENCES public.materiali(id),
  descrizione text,
  fornitore_id uuid NOT NULL REFERENCES public.fornitori(id),
  data_prezzo date NOT NULL,
  prezzo_unitario numeric(14,4) NOT NULL,
  unita_misura text,
  quantita_riferimento numeric(14,3),
  bolla_riga_id uuid REFERENCES public.rapportini_bolle_righe(id) ON DELETE SET NULL,
  bolla_id uuid REFERENCES public.rapportini_bolle(id) ON DELETE SET NULL,
  commessa_id uuid REFERENCES public.commesse(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prezzi_positivo CHECK (prezzo_unitario >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prezzi_riga ON public.materiali_prezzi_fornitori(bolla_riga_id) WHERE bolla_riga_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prezzi_mat ON public.materiali_prezzi_fornitori(organization_id, materiale_id, data_prezzo DESC);
CREATE INDEX IF NOT EXISTS idx_prezzi_forn ON public.materiali_prezzi_fornitori(organization_id, fornitore_id, data_prezzo DESC);

GRANT ALL ON public.materiali_prezzi_fornitori TO service_role;
ALTER TABLE public.materiali_prezzi_fornitori ENABLE ROW LEVEL SECURITY;
CREATE POLICY prezzi_sel ON public.materiali_prezzi_fornitori FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
GRANT SELECT ON public.materiali_prezzi_fornitori TO authenticated;

-- 7) Contratti subappalto ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subappalti_contratti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subappaltatore_id uuid NOT NULL REFERENCES public.fornitori(id),
  commessa_id uuid NOT NULL REFERENCES public.commesse(id),
  cantiere_id uuid REFERENCES public.cantieri(id),
  oggetto text NOT NULL,
  data_inizio date NOT NULL,
  data_fine date,
  importo_contratto numeric(14,2) NOT NULL DEFAULT 0,
  importo_maturato numeric(14,2) NOT NULL DEFAULT 0,
  importo_pagato numeric(14,2) NOT NULL DEFAULT 0,
  stato text NOT NULL DEFAULT 'bozza',
  documento_id uuid REFERENCES public.documenti(id) ON DELETE SET NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contratti_stato_chk CHECK (stato IN ('bozza','attivo','sospeso','completato','chiuso','annullato')),
  CONSTRAINT contratti_oggetto_nonempty CHECK (length(btrim(oggetto)) > 0),
  CONSTRAINT contratti_id_org_uk UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_contratti_sub ON public.subappalti_contratti(organization_id, subappaltatore_id);
CREATE INDEX IF NOT EXISTS idx_contratti_commessa ON public.subappalti_contratti(organization_id, commessa_id);

GRANT SELECT, INSERT, UPDATE ON public.subappalti_contratti TO authenticated;
GRANT ALL ON public.subappalti_contratti TO service_role;
ALTER TABLE public.subappalti_contratti ENABLE ROW LEVEL SECURITY;
CREATE POLICY contratti_sel ON public.subappalti_contratti FOR SELECT TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
CREATE POLICY contratti_ins ON public.subappalti_contratti FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id));
CREATE POLICY contratti_upd ON public.subappalti_contratti FOR UPDATE TO authenticated
  USING (organization_id = public.current_organization_id() AND public.can_see_econ(organization_id))
  WITH CHECK (organization_id = public.current_organization_id());

-- 8) Subappaltatori nel rapportino -----------------------------------------
CREATE TABLE IF NOT EXISTS public.rapportini_subappaltatori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rapportino_id uuid NOT NULL REFERENCES public.rapportini(id) ON DELETE CASCADE,
  commessa_id uuid NOT NULL REFERENCES public.commesse(id),
  cantiere_id uuid REFERENCES public.cantieri(id),
  fase_id uuid REFERENCES public.commessa_fasi(id),
  subappaltatore_id uuid NOT NULL REFERENCES public.fornitori(id),
  contratto_id uuid REFERENCES public.subappalti_contratti(id) ON DELETE SET NULL,
  lavorazione text NOT NULL,
  descrizione text,
  quantita numeric(14,3),
  unita_misura text,
  modalita_compenso text NOT NULL,
  importo_unitario numeric(14,4),
  importo_totale numeric(14,2),
  importo_congelato numeric(14,2),
  iva_pct numeric(6,3),
  ritenuta_pct numeric(6,3),
  note text,
  documento_id uuid REFERENCES public.documenti(id) ON DELETE SET NULL,
  stato_contabilizzazione text NOT NULL DEFAULT 'da_contabilizzare',
  contabilizzato_at timestamptz,
  annullato_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rsub_lav_nonempty CHECK (length(btrim(lavorazione)) > 0),
  CONSTRAINT rsub_modalita_chk CHECK (modalita_compenso IN ('a_corpo','a_giornata','a_quantita','a_sal','a_ore_ditta','altro')),
  CONSTRAINT rsub_stato_chk CHECK (stato_contabilizzazione IN ('da_contabilizzare','contabilizzato','importo_mancante','annullato')),
  CONSTRAINT rsub_importi_chk CHECK ((importo_totale IS NULL OR importo_totale >= 0) AND (importo_unitario IS NULL OR importo_unitario >= 0)),
  CONSTRAINT rsub_id_org_uk UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_rsub_rapportino ON public.rapportini_subappaltatori(rapportino_id);
CREATE INDEX IF NOT EXISTS idx_rsub_commessa ON public.rapportini_subappaltatori(organization_id, commessa_id);
CREATE INDEX IF NOT EXISTS idx_rsub_sub ON public.rapportini_subappaltatori(organization_id, subappaltatore_id);

GRANT ALL ON public.rapportini_subappaltatori TO service_role;
ALTER TABLE public.rapportini_subappaltatori ENABLE ROW LEVEL SECURITY;
CREATE POLICY rsub_no_direct ON public.rapportini_subappaltatori FOR SELECT TO authenticated USING (false);

-- 9) Trigger updated_at -----------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['materiali','rapportini_bolle','rapportini_bolle_righe','subappalti_contratti','rapportini_subappaltatori'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s; CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();', t);
  END LOOP;
END $$;
