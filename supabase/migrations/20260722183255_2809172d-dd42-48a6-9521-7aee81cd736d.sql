
CREATE POLICY "documenti_sel" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documenti' AND public.is_org_member((storage.foldername(name))[1]::uuid));
CREATE POLICY "documenti_ins" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documenti' AND public.is_org_member((storage.foldername(name))[1]::uuid));
CREATE POLICY "documenti_upd" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documenti' AND public.is_org_member((storage.foldername(name))[1]::uuid));
CREATE POLICY "documenti_del" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documenti' AND public.is_org_member((storage.foldername(name))[1]::uuid));
