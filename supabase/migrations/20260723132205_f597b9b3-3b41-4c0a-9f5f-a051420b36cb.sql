
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id UUID;
  org_name TEXT;
  invited_org_id UUID;
BEGIN
  -- Signup da invito: metadati impostati lato server dalla server function.
  -- Non creiamo nuova organizzazione né ruolo proprietario.
  IF NEW.raw_user_meta_data ? 'invited_org_id' THEN
    BEGIN
      invited_org_id := (NEW.raw_user_meta_data->>'invited_org_id')::uuid;
    EXCEPTION WHEN others THEN
      invited_org_id := NULL;
    END;

    IF invited_org_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.organizations WHERE id = invited_org_id) THEN
      INSERT INTO public.profiles (id, organization_id, email, nome, cognome)
      VALUES (
        NEW.id,
        invited_org_id,
        NEW.email,
        NEW.raw_user_meta_data->>'nome',
        NEW.raw_user_meta_data->>'cognome'
      );
      RETURN NEW;
    END IF;
    -- Se l'org indicata non esiste, si prosegue col flusso ordinario (fallback sicuro).
  END IF;

  -- Signup ordinario: crea nuova organizzazione + profilo proprietario.
  org_name := COALESCE(NEW.raw_user_meta_data->>'organization_name', 'La mia impresa');

  INSERT INTO public.organizations (nome, email)
  VALUES (org_name, NEW.email)
  RETURNING id INTO new_org_id;

  INSERT INTO public.profiles (id, organization_id, email, nome, cognome)
  VALUES (
    NEW.id,
    new_org_id,
    NEW.email,
    NEW.raw_user_meta_data->>'nome',
    NEW.raw_user_meta_data->>'cognome'
  );

  INSERT INTO public.user_roles (user_id, organization_id, role)
  VALUES (NEW.id, new_org_id, 'proprietario');

  RETURN NEW;
END; $function$;
