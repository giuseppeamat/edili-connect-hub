
-- ============ ORGANIZATIONS: nuovi campi ============
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS nome_commerciale TEXT,
  ADD COLUMN IF NOT EXISTS pec TEXT,
  ADD COLUMN IF NOT EXISTS sito_web TEXT,
  ADD COLUMN IF NOT EXISTS paese TEXT DEFAULT 'IT';

-- ============ PROFILES: stato attivazione ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disattivato_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disattivato_da UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Protezione trigger profiles: is_active/disattivato_* non modificabili dal client (solo server via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.tg_profiles_protect_sensitive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Non è possibile modificare l''id del profilo' USING ERRCODE = '42501';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Non è possibile modificare l''organizzazione dal profilo' USING ERRCODE = '42501';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'L''email non può essere modificata da questa pagina' USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.disattivato_at IS DISTINCT FROM OLD.disattivato_at
     OR NEW.disattivato_da IS DISTINCT FROM OLD.disattivato_da THEN
    -- Consentito solo se chiamante ha bypass (session_replication_role = replica) o funzioni SECURITY DEFINER
    IF current_setting('app.allow_member_admin', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Lo stato di attivazione può essere modificato solo dai gestori membri' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- ============ INVITES ============
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invite_status') THEN
    CREATE TYPE public.invite_status AS ENUM ('pending','accepted','revoked','expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role app_role NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  status public.invite_status NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ
);

GRANT SELECT ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;

CREATE INDEX IF NOT EXISTS invites_org_status_idx ON public.invites(organization_id, status);
CREATE INDEX IF NOT EXISTS invites_email_idx ON public.invites(lower(email));

-- Un solo invito pending per (org, email)
CREATE UNIQUE INDEX IF NOT EXISTS invites_org_email_pending_uidx
  ON public.invites(organization_id, lower(email))
  WHERE status = 'pending';

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invites_sel_admin ON public.invites;
CREATE POLICY invites_sel_admin ON public.invites
  FOR SELECT TO authenticated
  USING (public.has_any_role(organization_id, ARRAY['proprietario'::app_role,'amministratore'::app_role]));

-- Nessuna policy INSERT/UPDATE/DELETE dal client: tutto passa da server function SECURITY DEFINER

CREATE TRIGGER tg_invites_upd BEFORE UPDATE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ Protezione ruolo proprietario ============
-- Impedisce eliminazione dell'ultimo proprietario di un'organizzazione
CREATE OR REPLACE FUNCTION public.tg_user_roles_protect_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_count INT;
  target_org UUID;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.role = 'proprietario' THEN
    target_org := OLD.organization_id;
    SELECT COUNT(*) INTO owner_count FROM public.user_roles
      WHERE organization_id = target_org AND role = 'proprietario' AND user_id <> OLD.user_id;
    IF owner_count = 0 THEN
      RAISE EXCEPTION 'Impossibile rimuovere l''unico proprietario dell''organizzazione' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS tg_user_roles_protect_owner ON public.user_roles;
CREATE TRIGGER tg_user_roles_protect_owner
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_roles_protect_owner();

-- ============ Helper: scadenza inviti (derivato) ============
CREATE OR REPLACE FUNCTION public.mark_expired_invites()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.invites
    SET status = 'expired', updated_at = now()
    WHERE status = 'pending' AND expires_at < now();
$$;
REVOKE ALL ON FUNCTION public.mark_expired_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_expired_invites() TO authenticated;
