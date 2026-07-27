CREATE OR REPLACE FUNCTION public.is_valid_responsabile(_user uuid, _org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = _user
      AND p.organization_id = _org
      AND coalesce(p.is_active, true) = true
      AND ur.organization_id = _org
      AND ur.role IN ('proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere')
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_valid_responsabile(uuid, uuid) TO authenticated;