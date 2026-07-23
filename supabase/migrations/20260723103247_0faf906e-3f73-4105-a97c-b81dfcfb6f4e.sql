-- 1) Audit log: rimuovi INSERT client-side (deny by default)
DROP POLICY IF EXISTS audit_ins_self ON public.audit_log;

-- 2) Profili: trigger che blocca la modifica di campi sensibili in UPDATE
CREATE OR REPLACE FUNCTION public.tg_profiles_protect_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- id, organization_id, email, created_at non modificabili dal client
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_sensitive ON public.profiles;
CREATE TRIGGER profiles_protect_sensitive
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_profiles_protect_sensitive();

REVOKE EXECUTE ON FUNCTION public.tg_profiles_protect_sensitive() FROM PUBLIC, anon;