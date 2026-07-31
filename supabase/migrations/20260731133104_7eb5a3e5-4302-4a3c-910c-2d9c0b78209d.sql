CREATE OR REPLACE FUNCTION public.notif_rapportini_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  approvatori uuid[];
  costi_roles uuid[];
  comm record;
  label text;
  has_tariffa boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stato IS NOT DISTINCT FROM OLD.stato THEN RETURN NEW; END IF;

  SELECT codice, denominazione INTO comm FROM public.commesse WHERE id = NEW.commessa_id;
  label := COALESCE(comm.codice,'') || ' ' || COALESCE(comm.denominazione,'');

  IF NEW.stato = 'inviato' THEN
    PERFORM public.resolve_notifiche(NEW.organization_id,
      ARRAY['rapportino_respinto','rapportino_annullato'], NEW.id);
    approvatori := (
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) FROM (
        SELECT unnest(public.notif_users_by_roles(NEW.organization_id,
          ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])) AS x
        UNION SELECT unnest(public.notif_users_commessa(NEW.commessa_id))
      ) s WHERE x IS DISTINCT FROM NEW.user_id
    );
    PERFORM public.create_notifica_event(
      NEW.organization_id, approvatori, 'rapportino_inviato_da_approvare', 'attenzione',
      'Rapportino da approvare',
      'Un rapportino del ' || to_char(NEW.data,'DD/MM/YYYY') || ' su ' || label || ' attende approvazione.',
      'rapportino', NEW.id, '/rapportini/' || NEW.id::text, NULL, '{}'::jsonb, NEW.id);

  ELSIF NEW.stato = 'respinto' THEN
    PERFORM public.resolve_notifiche(NEW.organization_id, ARRAY['rapportino_inviato_da_approvare'], NEW.id);
    PERFORM public.create_notifica_event(
      NEW.organization_id, ARRAY[NEW.user_id], 'rapportino_respinto', 'critica',
      'Rapportino respinto',
      'Il rapportino del ' || to_char(NEW.data,'DD/MM/YYYY') || ' è stato respinto. Correggilo e reinvialo.',
      'rapportino', NEW.id, '/rapportini/' || NEW.id::text, NULL, '{}'::jsonb, NEW.id);

  ELSIF NEW.stato = 'approvato' THEN
    PERFORM public.resolve_notifiche(NEW.organization_id,
      ARRAY['rapportino_inviato_da_approvare','rapportino_respinto'], NEW.id);
    PERFORM public.create_notifica_event(
      NEW.organization_id, ARRAY[NEW.user_id], 'rapportino_approvato', 'info',
      'Rapportino approvato',
      'Il rapportino del ' || to_char(NEW.data,'DD/MM/YYYY') || ' è stato approvato.',
      'rapportino', NEW.id, '/rapportini/' || NEW.id::text, NULL, '{}'::jsonb, NEW.id);

    SELECT EXISTS (
      SELECT 1 FROM public.personale_costi_orari pc
      WHERE pc.organization_id = NEW.organization_id AND pc.user_id = NEW.user_id
        AND pc.archived_at IS NULL AND pc.valido_dal <= NEW.data
        AND (pc.valido_al IS NULL OR pc.valido_al >= NEW.data)
    ) INTO has_tariffa;
    IF NOT has_tariffa THEN
      costi_roles := public.notif_users_by_roles(NEW.organization_id,
        ARRAY['proprietario','amministratore','amministrazione']::app_role[]);
      PERFORM public.create_notifica_event(
        NEW.organization_id, costi_roles, 'rapportino_senza_tariffa', 'critica',
        'Tariffa oraria mancante',
        'Un rapportino approvato del ' || to_char(NEW.data,'DD/MM/YYYY') || ' non può essere contabilizzato: manca la tariffa oraria del dipendente.',
        'rapportino', NEW.id, '/costi-personale', NULL, '{}'::jsonb, NEW.id);
    ELSE
      PERFORM public.resolve_notifiche(NEW.organization_id, ARRAY['rapportino_senza_tariffa'], NEW.id);
    END IF;

  ELSIF NEW.stato = 'annullato' THEN
    PERFORM public.resolve_notifiche(NEW.organization_id,
      ARRAY['rapportino_inviato_da_approvare','rapportino_senza_tariffa','rapportino_approvato'], NEW.id);
    PERFORM public.create_notifica_event(
      NEW.organization_id, ARRAY[NEW.user_id], 'rapportino_annullato', 'attenzione',
      'Rapportino annullato',
      'Il rapportino del ' || to_char(NEW.data,'DD/MM/YYYY') || ' è stato annullato.',
      'rapportino', NEW.id, '/rapportini/' || NEW.id::text, NULL, '{}'::jsonb, NEW.id);
  END IF;

  RETURN NEW;
END; $$;