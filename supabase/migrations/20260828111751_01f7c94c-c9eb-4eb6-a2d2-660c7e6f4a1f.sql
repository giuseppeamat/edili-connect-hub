-- 1) Amministrazione equiparata ad Amministratore ovunque
CREATE OR REPLACE FUNCTION public.has_any_role(_org uuid, _roles app_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.organization_id = _org
      AND ur.role = ANY(
        CASE WHEN 'amministratore'::app_role = ANY(_roles)
             THEN _roles || ARRAY['amministrazione']::app_role[]
             ELSE _roles END)
      AND p.organization_id = _org
      AND COALESCE(p.is_active, true) = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _org uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.organization_id = _org
      AND (ur.role = _role
           OR (_role = 'amministratore'::app_role AND ur.role = 'amministrazione'::app_role))
      AND p.organization_id = _org
      AND COALESCE(p.is_active, true) = true
  );
$function$;

-- 2) Capocantiere e Responsabile commessa: creazione commesse e operatività interna
DROP POLICY IF EXISTS commesse_ins ON public.commesse;
CREATE POLICY commesse_ins ON public.commesse FOR INSERT TO authenticated
WITH CHECK (has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[]));

DROP POLICY IF EXISTS commesse_upd_responsabile ON public.commesse;
CREATE POLICY commesse_upd_operativo ON public.commesse FOR UPDATE TO authenticated
USING (
  has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
  AND (responsabile_id = (SELECT auth.uid()) OR created_by = (SELECT auth.uid()) OR can_access_commessa(id))
)
WITH CHECK (
  has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
  AND (responsabile_id = (SELECT auth.uid()) OR created_by = (SELECT auth.uid()) OR can_access_commessa(id))
);

DROP POLICY IF EXISTS cantieri_ins ON public.cantieri;
CREATE POLICY cantieri_ins ON public.cantieri FOR INSERT TO authenticated
WITH CHECK (
  has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
      AND can_access_commessa(commessa_id))
);

DROP POLICY IF EXISTS cantieri_upd ON public.cantieri;
CREATE POLICY cantieri_upd ON public.cantieri FOR UPDATE TO authenticated
USING (
  has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
      AND can_access_commessa(commessa_id))
);

DROP POLICY IF EXISTS commessa_fasi_ins ON public.commessa_fasi;
CREATE POLICY commessa_fasi_ins ON public.commessa_fasi FOR INSERT TO authenticated
WITH CHECK (
  has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
      AND can_access_commessa(commessa_id))
);

DROP POLICY IF EXISTS commessa_fasi_upd ON public.commessa_fasi;
CREATE POLICY commessa_fasi_upd ON public.commessa_fasi FOR UPDATE TO authenticated
USING (
  has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
      AND can_access_commessa(commessa_id))
)
WITH CHECK (
  has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
      AND can_access_commessa(commessa_id))
);

DROP POLICY IF EXISTS commessa_membri_ins ON public.commessa_membri;
CREATE POLICY commessa_membri_ins ON public.commessa_membri FOR INSERT TO authenticated
WITH CHECK (
  has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
      AND can_access_commessa(commessa_id)
      AND ruolo_operativo <> 'responsabile_commessa')
);

DROP POLICY IF EXISTS commessa_membri_upd ON public.commessa_membri;
CREATE POLICY commessa_membri_upd ON public.commessa_membri FOR UPDATE TO authenticated
USING (
  has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
  OR (has_any_role(organization_id, ARRAY['responsabile_commessa','capocantiere']::app_role[])
      AND can_access_commessa(commessa_id))
);

-- Il capocantiere che ha accesso alla commessa può essere responsabile di fase
CREATE OR REPLACE FUNCTION public.is_valid_responsabile_fase(_org uuid, _user uuid, _commessa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user
      AND ur.organization_id = _org
      AND p.organization_id = _org
      AND COALESCE(p.is_active, true) = true
      AND ur.role = ANY (ARRAY['proprietario','amministratore','amministrazione','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[])
  );
$function$;