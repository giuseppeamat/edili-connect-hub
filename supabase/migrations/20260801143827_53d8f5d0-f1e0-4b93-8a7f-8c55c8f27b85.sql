-- 1) Fix commesse_sel capocantiere join bug
DROP POLICY IF EXISTS commesse_sel ON public.commesse;
CREATE POLICY commesse_sel ON public.commesse
FOR SELECT TO authenticated
USING (
  has_any_role(organization_id, ARRAY['proprietario'::app_role, 'amministratore'::app_role, 'ufficio_tecnico'::app_role, 'amministrazione'::app_role])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa'::app_role]) AND ((responsabile_id = auth.uid()) OR is_membro_commessa(id)))
  OR (has_any_role(organization_id, ARRAY['capocantiere'::app_role]) AND (
        is_membro_commessa(id)
        OR EXISTS (
          SELECT 1 FROM public.cantieri k
          WHERE k.commessa_id = commesse.id
            AND k.organization_id = commesse.organization_id
            AND k.capocantiere_id = auth.uid()
        )
      ))
  OR (has_any_role(organization_id, ARRAY['operaio'::app_role]) AND is_membro_commessa(id))
);

-- 2) invites: explicit admin-scoped INSERT/UPDATE policies (no DELETE by design)
DROP POLICY IF EXISTS invites_ins_admin ON public.invites;
CREATE POLICY invites_ins_admin ON public.invites
FOR INSERT TO authenticated
WITH CHECK (has_any_role(organization_id, ARRAY['proprietario'::app_role, 'amministratore'::app_role]));

DROP POLICY IF EXISTS invites_upd_admin ON public.invites;
CREATE POLICY invites_upd_admin ON public.invites
FOR UPDATE TO authenticated
USING (has_any_role(organization_id, ARRAY['proprietario'::app_role, 'amministratore'::app_role]))
WITH CHECK (has_any_role(organization_id, ARRAY['proprietario'::app_role, 'amministratore'::app_role]));

-- 3) storage.objects: explicit ownership-checked UPDATE/DELETE for the 'documenti' bucket
DROP POLICY IF EXISTS documenti_upd ON storage.objects;
CREATE POLICY documenti_upd ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'documenti'
  AND EXISTS (
    SELECT 1 FROM public.documenti d
    WHERE d.storage_bucket = 'documenti'
      AND d.storage_path = objects.name
      AND (d.organization_id)::text = (storage.foldername(objects.name))[1]
      AND is_org_member(d.organization_id)
      AND has_any_role(d.organization_id, ARRAY['proprietario'::app_role, 'amministratore'::app_role, 'ufficio_tecnico'::app_role, 'amministrazione'::app_role])
  )
)
WITH CHECK (
  bucket_id = 'documenti'
  AND EXISTS (
    SELECT 1 FROM public.documenti d
    WHERE d.storage_bucket = 'documenti'
      AND d.storage_path = objects.name
      AND (d.organization_id)::text = (storage.foldername(objects.name))[1]
      AND is_org_member(d.organization_id)
      AND has_any_role(d.organization_id, ARRAY['proprietario'::app_role, 'amministratore'::app_role, 'ufficio_tecnico'::app_role, 'amministrazione'::app_role])
  )
);

DROP POLICY IF EXISTS documenti_del ON storage.objects;
CREATE POLICY documenti_del ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'documenti'
  AND EXISTS (
    SELECT 1 FROM public.documenti d
    WHERE d.storage_bucket = 'documenti'
      AND d.storage_path = objects.name
      AND (d.organization_id)::text = (storage.foldername(objects.name))[1]
      AND is_org_member(d.organization_id)
      AND has_any_role(d.organization_id, ARRAY['proprietario'::app_role, 'amministratore'::app_role])
  )
);

-- 4) Revoke EXECUTE on internal SECURITY DEFINER helpers not callable by the app
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN (
        '_assert_commessa_budget_mutabile','_assert_commessa_fase_editabile','_cbv_audit','_log_audit',
        '_rap_current_profile','_recalculate_labor_budget_voce','can_manage_commessa_budget',
        'create_costo_orario_membro','create_rapportino_membro','documento_version_chain',
        'is_commessa_budget_locked','is_valid_responsabile_fase','mark_expired_invites',
        'notif_crm_trigger','notif_documenti_trigger','notif_rapportini_costi_trigger','notif_rapportini_trigger',
        'recalculate_commessa_avanzamento','recalculate_commessa_budget','tg_commessa_fasi_recalc',
        'tg_profiles_protect_sensitive','tg_user_roles_protect_owner'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated, anon, PUBLIC', r.sig);
  END LOOP;
END $$;