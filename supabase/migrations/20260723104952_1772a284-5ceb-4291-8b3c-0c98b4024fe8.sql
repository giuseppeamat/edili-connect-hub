
-- Fix infinite recursion: profiles_upd_self WITH CHECK subquery on profiles
-- re-entered profiles RLS. Sensitive columns are already protected by
-- trigger tg_profiles_protect_sensitive (blocks changes to id, organization_id,
-- email, created_at), so the subquery is unnecessary.

DROP POLICY IF EXISTS profiles_upd_self ON public.profiles;

CREATE POLICY profiles_upd_self
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));
