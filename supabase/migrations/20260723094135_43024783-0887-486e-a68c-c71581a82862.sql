
-- =========================================================================
-- Sprint 0 - Integrità referenziale, indici e isolamento multi-tenant
-- Idempotente. Nessuna modifica a RLS, policy, enum, o dati.
-- =========================================================================

-- ---------- 1. INDICI MANCANTI ----------
CREATE INDEX IF NOT EXISTS profiles_organization_id_idx ON public.profiles(organization_id);
CREATE INDEX IF NOT EXISTS user_roles_organization_id_idx ON public.user_roles(organization_id);

CREATE INDEX IF NOT EXISTS preventivi_cliente_id_idx      ON public.preventivi(cliente_id);
CREATE INDEX IF NOT EXISTS preventivi_org_stato_idx       ON public.preventivi(organization_id, stato);

CREATE INDEX IF NOT EXISTS commesse_cliente_id_idx        ON public.commesse(cliente_id);
CREATE INDEX IF NOT EXISTS commesse_preventivo_id_idx     ON public.commesse(preventivo_id);
CREATE INDEX IF NOT EXISTS commesse_responsabile_id_idx   ON public.commesse(responsabile_id);
CREATE INDEX IF NOT EXISTS commesse_org_stato_idx         ON public.commesse(organization_id, stato);

CREATE INDEX IF NOT EXISTS rapportini_commessa_id_idx     ON public.rapportini(commessa_id);
CREATE INDEX IF NOT EXISTS rapportini_user_id_idx         ON public.rapportini(user_id);
CREATE INDEX IF NOT EXISTS rapportini_data_idx            ON public.rapportini(data);

CREATE INDEX IF NOT EXISTS documenti_cliente_id_idx       ON public.documenti(cliente_id);
CREATE INDEX IF NOT EXISTS documenti_fornitore_id_idx     ON public.documenti(fornitore_id);
CREATE INDEX IF NOT EXISTS documenti_commessa_id_idx      ON public.documenti(commessa_id);
CREATE INDEX IF NOT EXISTS documenti_org_stato_idx        ON public.documenti(organization_id, stato);

-- audit_log(organization_id) già coperto dall'indice (organization_id, created_at DESC).

-- ---------- 2. UNIQUE SCOPED PER ORGANIZZAZIONE ----------
-- Numero preventivo unico per organizzazione (per versione).
CREATE UNIQUE INDEX IF NOT EXISTS preventivi_org_numero_versione_uniq
  ON public.preventivi(organization_id, numero, versione);

-- Codice commessa unico per organizzazione.
CREATE UNIQUE INDEX IF NOT EXISTS commesse_org_codice_uniq
  ON public.commesse(organization_id, codice);

-- ---------- 3. UNIQUE (id, organization_id) SUI PARENT ----------
-- Necessari per poter aggiungere FK composite anti cross-tenant.
-- id è già PK unico, quindi il vincolo non introduce duplicati.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clienti_id_org_uniq') THEN
    ALTER TABLE public.clienti      ADD CONSTRAINT clienti_id_org_uniq      UNIQUE (id, organization_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fornitori_id_org_uniq') THEN
    ALTER TABLE public.fornitori    ADD CONSTRAINT fornitori_id_org_uniq    UNIQUE (id, organization_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='preventivi_id_org_uniq') THEN
    ALTER TABLE public.preventivi   ADD CONSTRAINT preventivi_id_org_uniq   UNIQUE (id, organization_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_id_org_uniq') THEN
    ALTER TABLE public.commesse     ADD CONSTRAINT commesse_id_org_uniq     UNIQUE (id, organization_id);
  END IF;
END $$;

-- ---------- 4. CORREZIONE ON DELETE (RESTRICT dove richiesto) ----------
-- preventivi.cliente_id: SET NULL -> RESTRICT
ALTER TABLE public.preventivi DROP CONSTRAINT IF EXISTS preventivi_cliente_id_fkey;
ALTER TABLE public.preventivi
  ADD CONSTRAINT preventivi_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clienti(id) ON DELETE RESTRICT;

-- commesse.cliente_id: SET NULL -> RESTRICT
ALTER TABLE public.commesse DROP CONSTRAINT IF EXISTS commesse_cliente_id_fkey;
ALTER TABLE public.commesse
  ADD CONSTRAINT commesse_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clienti(id) ON DELETE RESTRICT;

-- rapportini.commessa_id: SET NULL -> RESTRICT
ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_commessa_id_fkey;
ALTER TABLE public.rapportini
  ADD CONSTRAINT rapportini_commessa_id_fkey
  FOREIGN KEY (commessa_id) REFERENCES public.commesse(id) ON DELETE RESTRICT;

-- ---------- 5. FK COMPOSITE ANTI CROSS-TENANT ----------
-- Garantiscono che child.organization_id = parent.organization_id.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='preventivi_cliente_org_fkey') THEN
    ALTER TABLE public.preventivi
      ADD CONSTRAINT preventivi_cliente_org_fkey
      FOREIGN KEY (cliente_id, organization_id)
      REFERENCES public.clienti(id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='preventivo_voci_preventivo_org_fkey') THEN
    ALTER TABLE public.preventivo_voci
      ADD CONSTRAINT preventivo_voci_preventivo_org_fkey
      FOREIGN KEY (preventivo_id, organization_id)
      REFERENCES public.preventivi(id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_cliente_org_fkey') THEN
    ALTER TABLE public.commesse
      ADD CONSTRAINT commesse_cliente_org_fkey
      FOREIGN KEY (cliente_id, organization_id)
      REFERENCES public.clienti(id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commesse_preventivo_org_fkey') THEN
    ALTER TABLE public.commesse
      ADD CONSTRAINT commesse_preventivo_org_fkey
      FOREIGN KEY (preventivo_id, organization_id)
      REFERENCES public.preventivi(id, organization_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rapportini_commessa_org_fkey') THEN
    ALTER TABLE public.rapportini
      ADD CONSTRAINT rapportini_commessa_org_fkey
      FOREIGN KEY (commessa_id, organization_id)
      REFERENCES public.commesse(id, organization_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documenti_cliente_org_fkey') THEN
    ALTER TABLE public.documenti
      ADD CONSTRAINT documenti_cliente_org_fkey
      FOREIGN KEY (cliente_id, organization_id)
      REFERENCES public.clienti(id, organization_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documenti_fornitore_org_fkey') THEN
    ALTER TABLE public.documenti
      ADD CONSTRAINT documenti_fornitore_org_fkey
      FOREIGN KEY (fornitore_id, organization_id)
      REFERENCES public.fornitori(id, organization_id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documenti_commessa_org_fkey') THEN
    ALTER TABLE public.documenti
      ADD CONSTRAINT documenti_commessa_org_fkey
      FOREIGN KEY (commessa_id, organization_id)
      REFERENCES public.commesse(id, organization_id) ON DELETE SET NULL;
  END IF;
END $$;
