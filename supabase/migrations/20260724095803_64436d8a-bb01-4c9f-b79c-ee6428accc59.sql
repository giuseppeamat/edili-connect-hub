-- s4_02_roles_active_filter
-- Definizioni precedenti (per rollback):
-- has_role:      SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id=_user_id AND organization_id=_org AND role=_role)
-- has_any_role:  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id=(SELECT auth.uid()) AND organization_id=_org AND role=ANY(_roles))
-- is_org_member: SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND organization_id=_org)

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _org uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.organization_id = _org
      AND ur.role = _role
      AND p.organization_id = _org
      AND COALESCE(p.is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_org uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.organization_id = _org
      AND ur.role = ANY(_roles)
      AND p.organization_id = _org
      AND COALESCE(p.is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = _org
      AND p.organization_id = _org
      AND COALESCE(p.is_active, true) = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated, service_role;