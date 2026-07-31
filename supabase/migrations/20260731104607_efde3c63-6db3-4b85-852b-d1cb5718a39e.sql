-- Sprint 7 — Fase 4: la INSERT su storage deve corrispondere a un documento
-- "preparato" dal server, creato dall'utente corrente, con path registrato.
DROP POLICY IF EXISTS documenti_ins ON storage.objects;

CREATE POLICY documenti_ins ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'documenti'
  AND array_length(storage.foldername(name), 1) = 3
  AND EXISTS (
    SELECT 1
    FROM public.documenti d
    WHERE d.id::text = (storage.foldername(name))[2]
      AND d.organization_id::text = (storage.foldername(name))[1]
      AND d.storage_bucket = 'documenti'
      AND d.storage_path = storage.objects.name
      AND d.upload_stato = 'preparato'
      AND d.versione::text = (storage.foldername(name))[3]
      AND d.created_by = auth.uid()
      AND public.is_org_member(d.organization_id)
      AND public.has_any_role(
        d.organization_id,
        ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]
      )
  )
);