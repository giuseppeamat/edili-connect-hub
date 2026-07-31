-- 1. GRANT hardening ---------------------------------------------------------
REVOKE ALL ON public.documenti FROM anon;
REVOKE ALL ON public.documenti FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.documenti TO authenticated;
GRANT ALL ON public.documenti TO service_role;

DROP POLICY IF EXISTS documenti_del ON public.documenti;

-- 2. Modello documento --------------------------------------------------------
ALTER TABLE public.documenti
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'documenti',
  ADD COLUMN IF NOT EXISTS file_name_originale TEXT,
  ADD COLUMN IF NOT EXISTS versione INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS documento_precedente_id UUID,
  ADD COLUMN IF NOT EXISTS is_versione_corrente BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS note_versione TEXT,
  ADD COLUMN IF NOT EXISTS upload_stato TEXT NOT NULL DEFAULT 'disponibile';

ALTER TABLE public.documenti
  DROP CONSTRAINT IF EXISTS documenti_upload_stato_chk;
ALTER TABLE public.documenti
  ADD CONSTRAINT documenti_upload_stato_chk
  CHECK (upload_stato IN ('preparato','disponibile','fallito'));

ALTER TABLE public.documenti
  DROP CONSTRAINT IF EXISTS documenti_versione_chk;
ALTER TABLE public.documenti
  ADD CONSTRAINT documenti_versione_chk CHECK (versione >= 1);

-- chiave composita necessaria alla FK sotto
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.documenti'::regclass AND conname = 'documenti_id_org_key'
  ) THEN
    ALTER TABLE public.documenti ADD CONSTRAINT documenti_id_org_key UNIQUE (id, organization_id);
  END IF;
END $$;

ALTER TABLE public.documenti
  DROP CONSTRAINT IF EXISTS documenti_precedente_fk;
ALTER TABLE public.documenti
  ADD CONSTRAINT documenti_precedente_fk
  FOREIGN KEY (documento_precedente_id, organization_id)
  REFERENCES public.documenti(id, organization_id) ON DELETE SET NULL;

-- 3. Backfill dati esistenti (nessuna modifica ai contenuti storici) ----------
UPDATE public.documenti
SET created_by = COALESCE(created_by, uploaded_by),
    file_name_originale = COALESCE(file_name_originale, nome),
    upload_stato = CASE WHEN storage_path IS NULL THEN 'preparato' ELSE 'disponibile' END
WHERE created_by IS NULL OR file_name_originale IS NULL;

UPDATE public.documenti
SET archived_at = COALESCE(archived_at, updated_at)
WHERE stato = 'archiviato' AND archived_at IS NULL;

-- 4. Stato scadenza derivato --------------------------------------------------
CREATE OR REPLACE FUNCTION public.documento_scadenza_stato(_data_scadenza DATE, _soglia_giorni INTEGER DEFAULT 30)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _data_scadenza IS NULL THEN 'senza_scadenza'
    WHEN _data_scadenza < CURRENT_DATE THEN 'scaduto'
    WHEN _data_scadenza <= CURRENT_DATE + (COALESCE(_soglia_giorni, 30) || ' days')::interval THEN 'in_scadenza'
    ELSE 'valido'
  END
$$;

GRANT EXECUTE ON FUNCTION public.documento_scadenza_stato(DATE, INTEGER) TO authenticated, service_role;

-- 5. Indici -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS documenti_archived_at_idx ON public.documenti (organization_id, archived_at);
CREATE INDEX IF NOT EXISTS documenti_categoria_idx ON public.documenti (organization_id, categoria);
CREATE INDEX IF NOT EXISTS documenti_upload_stato_idx ON public.documenti (organization_id, upload_stato);
CREATE INDEX IF NOT EXISTS documenti_versione_gruppo_idx ON public.documenti (documento_precedente_id);
CREATE INDEX IF NOT EXISTS documenti_scadenza_attivi_idx ON public.documenti (organization_id, data_scadenza)
  WHERE archived_at IS NULL;

-- 6. Storage: nessuna DELETE/UPDATE diretta lato utente -----------------------
DROP POLICY IF EXISTS documenti_del ON storage.objects;
DROP POLICY IF EXISTS documenti_upd ON storage.objects;
DROP POLICY IF EXISTS documenti_ins ON storage.objects;
DROP POLICY IF EXISTS documenti_sel ON storage.objects;

CREATE POLICY documenti_sel ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'documenti'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY documenti_ins ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documenti'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
  AND public.has_any_role(
    ((storage.foldername(name))[1])::uuid,
    ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]
  )
);