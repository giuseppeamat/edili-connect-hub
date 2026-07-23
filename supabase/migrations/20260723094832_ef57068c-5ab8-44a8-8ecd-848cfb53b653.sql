
-- =========================================================================
-- Sprint 0 — RBAC via RLS
-- Deny by default, tenant isolation preserved, least privilege per role.
-- =========================================================================

-- Performance index for role lookups (has_role / has_any_role)
CREATE INDEX IF NOT EXISTS user_roles_user_org_role_idx
  ON public.user_roles (user_id, organization_id, role);

-- -------------------------------------------------------------------------
-- Helper: has_any_role — matches ANY of a list of roles for current user/org
-- SECURITY DEFINER, schema-qualified, safe search_path, EXECUTE only to authenticated.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_any_role(_org uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND organization_id = _org
      AND role = ANY(_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated;

-- Ensure existing helpers keep only needed EXECUTE
REVOKE ALL ON FUNCTION public.has_role(uuid, uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, uuid, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;

-- -------------------------------------------------------------------------
-- Drop existing broad policies (recreated below with role differentiation)
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS org_read_own       ON public.organizations;
DROP POLICY IF EXISTS org_update_own     ON public.organizations;

DROP POLICY IF EXISTS profiles_read_self_or_org ON public.profiles;
DROP POLICY IF EXISTS profiles_update_self       ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_self       ON public.profiles;

DROP POLICY IF EXISTS roles_read_org ON public.user_roles;

DROP POLICY IF EXISTS clienti_sel ON public.clienti;
DROP POLICY IF EXISTS clienti_ins ON public.clienti;
DROP POLICY IF EXISTS clienti_upd ON public.clienti;
DROP POLICY IF EXISTS clienti_del ON public.clienti;

DROP POLICY IF EXISTS fornitori_sel ON public.fornitori;
DROP POLICY IF EXISTS fornitori_ins ON public.fornitori;
DROP POLICY IF EXISTS fornitori_upd ON public.fornitori;
DROP POLICY IF EXISTS fornitori_del ON public.fornitori;

DROP POLICY IF EXISTS preventivi_sel ON public.preventivi;
DROP POLICY IF EXISTS preventivi_ins ON public.preventivi;
DROP POLICY IF EXISTS preventivi_upd ON public.preventivi;
DROP POLICY IF EXISTS preventivi_del ON public.preventivi;

DROP POLICY IF EXISTS preventivo_voci_sel ON public.preventivo_voci;
DROP POLICY IF EXISTS preventivo_voci_ins ON public.preventivo_voci;
DROP POLICY IF EXISTS preventivo_voci_upd ON public.preventivo_voci;
DROP POLICY IF EXISTS preventivo_voci_del ON public.preventivo_voci;

DROP POLICY IF EXISTS commesse_sel ON public.commesse;
DROP POLICY IF EXISTS commesse_ins ON public.commesse;
DROP POLICY IF EXISTS commesse_upd ON public.commesse;
DROP POLICY IF EXISTS commesse_del ON public.commesse;

DROP POLICY IF EXISTS rapportini_sel ON public.rapportini;
DROP POLICY IF EXISTS rapportini_ins ON public.rapportini;
DROP POLICY IF EXISTS rapportini_upd ON public.rapportini;
DROP POLICY IF EXISTS rapportini_del ON public.rapportini;

DROP POLICY IF EXISTS documenti_sel ON public.documenti;
DROP POLICY IF EXISTS documenti_ins ON public.documenti;
DROP POLICY IF EXISTS documenti_upd ON public.documenti;
DROP POLICY IF EXISTS documenti_del ON public.documenti;

DROP POLICY IF EXISTS audit_read_org   ON public.audit_log;
DROP POLICY IF EXISTS audit_insert_org ON public.audit_log;

-- =========================================================================
-- ORGANIZATIONS
-- SELECT: any internal role of the org (all except cliente/fornitore)
-- UPDATE: proprietario, amministratore
-- INSERT/DELETE: no client policies (handled by signup trigger)
-- =========================================================================
CREATE POLICY organizations_sel_internal ON public.organizations
FOR SELECT TO authenticated
USING (
  public.has_any_role(id, ARRAY[
    'proprietario','amministratore','ufficio_tecnico','amministrazione',
    'responsabile_commessa','capocantiere','operaio'
  ]::public.app_role[])
);

CREATE POLICY organizations_upd_admin ON public.organizations
FOR UPDATE TO authenticated
USING (public.has_any_role(id, ARRAY['proprietario','amministratore']::public.app_role[]))
WITH CHECK (public.has_any_role(id, ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- PROFILES
-- SELECT: self, OR proprietario/amministratore of same org (managers see team)
--         NOTE: cliente/fornitore are excluded from generic org read.
-- INSERT: self only (handled by signup trigger; kept for parity)
-- UPDATE: self only. RLS cannot restrict columns; organization_id changes
--         would break FKs downstream. Role is NOT stored here (see user_roles),
--         so no privilege escalation vector via profiles UPDATE.
-- =========================================================================
CREATE POLICY profiles_sel_self_or_manager ON public.profiles
FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.has_any_role(organization_id,
        ARRAY['proprietario','amministratore']::public.app_role[])
  )
);

CREATE POLICY profiles_ins_self ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_upd_self ON public.profiles
FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (
  id = (SELECT auth.uid())
  -- organization_id cannot be moved outside current org
  AND organization_id = (SELECT organization_id FROM public.profiles WHERE id = (SELECT auth.uid()))
);

-- =========================================================================
-- USER_ROLES — SELECT only. No client-side INSERT/UPDATE/DELETE.
-- Users see their own row; proprietario/amministratore see all org roles.
-- Deny-by-default handles the rest: no user can self-assign roles.
-- =========================================================================
CREATE POLICY user_roles_sel_self_or_admin ON public.user_roles
FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.has_any_role(organization_id,
       ARRAY['proprietario','amministratore']::public.app_role[])
);

-- =========================================================================
-- CLIENTI
-- SELECT: internal ops roles
-- INSERT/UPDATE: proprietario, amministratore, ufficio_tecnico, amministrazione
-- DELETE: proprietario, amministratore
-- =========================================================================
CREATE POLICY clienti_sel ON public.clienti
FOR SELECT TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione',
  'responsabile_commessa','capocantiere','operaio'
]::public.app_role[]));

CREATE POLICY clienti_ins ON public.clienti
FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]));

CREATE POLICY clienti_upd ON public.clienti
FOR UPDATE TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]))
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]));

CREATE POLICY clienti_del ON public.clienti
FOR DELETE TO authenticated
USING (public.has_any_role(organization_id,
  ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- FORNITORI — analogous to clienti
-- =========================================================================
CREATE POLICY fornitori_sel ON public.fornitori
FOR SELECT TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione',
  'responsabile_commessa','capocantiere','operaio'
]::public.app_role[]));

CREATE POLICY fornitori_ins ON public.fornitori
FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]));

CREATE POLICY fornitori_upd ON public.fornitori
FOR UPDATE TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]))
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]));

CREATE POLICY fornitori_del ON public.fornitori
FOR DELETE TO authenticated
USING (public.has_any_role(organization_id,
  ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- PREVENTIVI
-- SELECT: proprietario, amministratore, ufficio_tecnico, amministrazione, responsabile_commessa
-- INSERT/UPDATE: proprietario, amministratore, ufficio_tecnico
-- DELETE: proprietario, amministratore
-- =========================================================================
CREATE POLICY preventivi_sel ON public.preventivi
FOR SELECT TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa'
]::public.app_role[]));

CREATE POLICY preventivi_ins ON public.preventivi
FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]));

CREATE POLICY preventivi_upd ON public.preventivi
FOR UPDATE TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]))
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]));

CREATE POLICY preventivi_del ON public.preventivi
FOR DELETE TO authenticated
USING (public.has_any_role(organization_id,
  ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- PREVENTIVO_VOCI — mirror parent
-- =========================================================================
CREATE POLICY preventivo_voci_sel ON public.preventivo_voci
FOR SELECT TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa'
]::public.app_role[]));

CREATE POLICY preventivo_voci_ins ON public.preventivo_voci
FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]));

CREATE POLICY preventivo_voci_upd ON public.preventivo_voci
FOR UPDATE TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]))
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]));

CREATE POLICY preventivo_voci_del ON public.preventivo_voci
FOR DELETE TO authenticated
USING (public.has_any_role(organization_id,
  ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- COMMESSE
-- SELECT: internal ops roles
-- INSERT: proprietario, amministratore, ufficio_tecnico
-- UPDATE: proprietario, amministratore, ufficio_tecnico (any),
--         responsabile_commessa ONLY for commesse where responsabile_id = auth.uid()
-- DELETE: proprietario, amministratore
-- =========================================================================
CREATE POLICY commesse_sel ON public.commesse
FOR SELECT TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione',
  'responsabile_commessa','capocantiere','operaio'
]::public.app_role[]));

CREATE POLICY commesse_ins ON public.commesse
FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]));

CREATE POLICY commesse_upd_admin ON public.commesse
FOR UPDATE TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]))
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico'
]::public.app_role[]));

-- Responsabile commessa: may update ONLY commesse assigned to them.
-- responsabile_id must remain themselves in the resulting row (no reassignment).
CREATE POLICY commesse_upd_responsabile ON public.commesse
FOR UPDATE TO authenticated
USING (
  responsabile_id = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['responsabile_commessa']::public.app_role[])
)
WITH CHECK (
  responsabile_id = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['responsabile_commessa']::public.app_role[])
);

CREATE POLICY commesse_del ON public.commesse
FOR DELETE TO authenticated
USING (public.has_any_role(organization_id,
  ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- RAPPORTINI
-- SELECT: proprietario/amministratore/ufficio_tecnico/amministrazione/responsabile_commessa/capocantiere
--         (org-wide);  operaio: only own rapportini (user_id = auth.uid())
-- INSERT: proprietario/amministratore/ufficio_tecnico/responsabile_commessa/capocantiere: any user of the org;
--         operaio: only rows where user_id = auth.uid()
-- UPDATE: proprietario/amministratore (any); responsabile_commessa/capocantiere (org-wide);
--         operaio: only own rows
-- DELETE: proprietario, amministratore
-- =========================================================================
CREATE POLICY rapportini_sel_internal ON public.rapportini
FOR SELECT TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione',
  'responsabile_commessa','capocantiere'
]::public.app_role[]));

CREATE POLICY rapportini_sel_own_operaio ON public.rapportini
FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['operaio']::public.app_role[])
);

CREATE POLICY rapportini_ins_ops ON public.rapportini
FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico',
  'responsabile_commessa','capocantiere'
]::public.app_role[]));

CREATE POLICY rapportini_ins_own_operaio ON public.rapportini
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['operaio']::public.app_role[])
);

CREATE POLICY rapportini_upd_ops ON public.rapportini
FOR UPDATE TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','responsabile_commessa','capocantiere'
]::public.app_role[]))
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','responsabile_commessa','capocantiere'
]::public.app_role[]));

CREATE POLICY rapportini_upd_own_operaio ON public.rapportini
FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['operaio']::public.app_role[])
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['operaio']::public.app_role[])
);

CREATE POLICY rapportini_del ON public.rapportini
FOR DELETE TO authenticated
USING (public.has_any_role(organization_id,
  ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- DOCUMENTI
-- SELECT: internal ops roles
-- INSERT: proprietario/amministratore/ufficio_tecnico/amministrazione/responsabile_commessa/capocantiere.
--         uploaded_by must be = auth.uid() when present, to prevent identity spoofing.
-- UPDATE: proprietario/amministratore/ufficio_tecnico/amministrazione;
--         responsabile_commessa/capocantiere ONLY on rows they uploaded (uploaded_by = auth.uid())
-- DELETE: proprietario, amministratore
-- =========================================================================
CREATE POLICY documenti_sel ON public.documenti
FOR SELECT TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione',
  'responsabile_commessa','capocantiere','operaio'
]::public.app_role[]));

CREATE POLICY documenti_ins ON public.documenti
FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(organization_id, ARRAY[
    'proprietario','amministratore','ufficio_tecnico','amministrazione',
    'responsabile_commessa','capocantiere'
  ]::public.app_role[])
  AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid()))
);

CREATE POLICY documenti_upd_admin ON public.documenti
FOR UPDATE TO authenticated
USING (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]))
WITH CHECK (public.has_any_role(organization_id, ARRAY[
  'proprietario','amministratore','ufficio_tecnico','amministrazione'
]::public.app_role[]));

CREATE POLICY documenti_upd_own_ops ON public.documenti
FOR UPDATE TO authenticated
USING (
  uploaded_by = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['responsabile_commessa','capocantiere']::public.app_role[])
)
WITH CHECK (
  uploaded_by = (SELECT auth.uid())
  AND public.has_any_role(organization_id,
        ARRAY['responsabile_commessa','capocantiere']::public.app_role[])
);

CREATE POLICY documenti_del ON public.documenti
FOR DELETE TO authenticated
USING (public.has_any_role(organization_id,
  ARRAY['proprietario','amministratore']::public.app_role[]));

-- =========================================================================
-- AUDIT_LOG
-- SELECT: proprietario, amministratore, amministrazione (read-only)
-- INSERT: any org member but user_id MUST equal auth.uid() (no identity spoofing)
-- UPDATE/DELETE: no policies -> denied for everyone (immutable audit)
-- =========================================================================
CREATE POLICY audit_sel ON public.audit_log
FOR SELECT TO authenticated
USING (
  organization_id IS NOT NULL
  AND public.has_any_role(organization_id, ARRAY[
    'proprietario','amministratore','amministrazione'
  ]::public.app_role[])
);

CREATE POLICY audit_ins_self ON public.audit_log
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND organization_id IS NOT NULL
  AND public.is_org_member(organization_id)
);
