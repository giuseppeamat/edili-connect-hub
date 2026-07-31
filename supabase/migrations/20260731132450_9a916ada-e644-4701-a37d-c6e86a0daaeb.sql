-- ============================================================
-- SPRINT 8 — NOTIFICHE OPERATIVE
-- ============================================================

CREATE TABLE public.notifiche (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  destinatario_user_id uuid NOT NULL,
  tipo text NOT NULL,
  severita text NOT NULL DEFAULT 'info' CHECK (severita IN ('info','attenzione','critica')),
  titolo text NOT NULL,
  messaggio text,
  entity_type text,
  entity_id uuid,
  route text,
  dedupe_key text NOT NULL,
  source_event_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  archived_at timestamptz
);

GRANT SELECT ON public.notifiche TO authenticated;
GRANT ALL ON public.notifiche TO service_role;

ALTER TABLE public.notifiche ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifiche_select_own" ON public.notifiche
  FOR SELECT TO authenticated
  USING (destinatario_user_id = auth.uid() AND organization_id = public.current_organization_id());

-- Anti-duplicato: una sola notifica attiva per (org, destinatario, chiave)
CREATE UNIQUE INDEX notifiche_dedupe_active_uidx
  ON public.notifiche (organization_id, destinatario_user_id, dedupe_key)
  WHERE archived_at IS NULL;

CREATE INDEX notifiche_inbox_idx ON public.notifiche (organization_id, destinatario_user_id, read_at);
CREATE INDEX notifiche_created_idx ON public.notifiche (created_at DESC);
CREATE INDEX notifiche_archived_idx ON public.notifiche (archived_at);
CREATE INDEX notifiche_entity_idx ON public.notifiche (entity_type, entity_id);

-- ============================================================
-- Helper destinatari (server-side)
-- ============================================================
CREATE OR REPLACE FUNCTION public.notif_users_by_roles(_org uuid, _roles app_role[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT ur.user_id), ARRAY[]::uuid[])
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.organization_id = _org
    AND ur.role = ANY(_roles)
    AND p.organization_id = _org
    AND p.is_active = true;
$$;

-- Utenti coinvolti su una commessa (responsabile + membri attivi)
CREATE OR REPLACE FUNCTION public.notif_users_commessa(_commessa_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::uuid[]) FROM (
    SELECT c.responsabile_id AS u FROM public.commesse c
      WHERE c.id = _commessa_id AND c.responsabile_id IS NOT NULL
    UNION
    SELECT cm.user_id FROM public.commessa_membri cm
      WHERE cm.commessa_id = _commessa_id AND cm.is_active = true AND cm.archived_at IS NULL
  ) s
  WHERE u IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u AND p.is_active = true);
$$;

-- ============================================================
-- Generatore centralizzato
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_notifica_event(
  _org uuid,
  _destinatari uuid[],
  _tipo text,
  _severita text,
  _titolo text,
  _messaggio text,
  _entity_type text,
  _entity_id uuid,
  _route text,
  _dedupe_scope text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _source_event_id uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid; n integer := 0; k text;
BEGIN
  IF _org IS NULL OR _destinatari IS NULL THEN RETURN 0; END IF;
  FOREACH u IN ARRAY _destinatari LOOP
    CONTINUE WHEN u IS NULL;
    k := _tipo || ':' || COALESCE(_dedupe_scope, COALESCE(_entity_id::text, 'global')) || ':' || u::text;
    INSERT INTO public.notifiche (
      organization_id, destinatario_user_id, tipo, severita, titolo, messaggio,
      entity_type, entity_id, route, dedupe_key, metadata, source_event_id, created_by
    ) VALUES (
      _org, u, _tipo, _severita, _titolo, _messaggio,
      _entity_type, _entity_id, _route, k, COALESCE(_metadata,'{}'::jsonb), _source_event_id, auth.uid()
    )
    ON CONFLICT (organization_id, destinatario_user_id, dedupe_key) WHERE archived_at IS NULL
    DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END; $$;

-- Risoluzione automatica: archivia notifiche attive per tipo+entità
CREATE OR REPLACE FUNCTION public.resolve_notifiche(_org uuid, _tipi text[], _entity_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.notifiche
     SET archived_at = now(),
         metadata = metadata || jsonb_build_object('risolta', true)
   WHERE organization_id = _org
     AND entity_id = _entity_id
     AND tipo = ANY(_tipi)
     AND archived_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

-- ============================================================
-- HOOK RAPPORTINI (trigger su cambio stato)
-- ============================================================
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
    PERFORM public.resolve_notifiche(NEW.organization_id, ARRAY['rapportino_inviato_da_approvare'], NEW.id);
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

CREATE TRIGGER notifiche_rapportini_stato
AFTER INSERT OR UPDATE OF stato ON public.rapportini
FOR EACH ROW EXECUTE FUNCTION public.notif_rapportini_trigger();

-- Contabilizzazione riuscita → risolvi "senza tariffa"
CREATE OR REPLACE FUNCTION public.notif_rapportini_costi_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stato = 'contabilizzato' THEN
    PERFORM public.resolve_notifiche(NEW.organization_id, ARRAY['rapportino_senza_tariffa'], NEW.rapportino_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER notifiche_rapportini_costi
AFTER INSERT OR UPDATE OF stato ON public.rapportini_costi
FOR EACH ROW EXECUTE FUNCTION public.notif_rapportini_costi_trigger();

-- Documento archiviato → risolvi notifiche attive
CREATE OR REPLACE FUNCTION public.notif_documenti_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    PERFORM public.resolve_notifiche(NEW.organization_id,
      ARRAY['documento_scaduto','documento_in_scadenza_7','documento_in_scadenza_30'], NEW.id);
  END IF;
  IF NEW.data_scadenza IS DISTINCT FROM OLD.data_scadenza AND NEW.data_scadenza > CURRENT_DATE THEN
    PERFORM public.resolve_notifiche(NEW.organization_id, ARRAY['documento_scaduto'], NEW.id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER notifiche_documenti_update
AFTER UPDATE ON public.documenti
FOR EACH ROW EXECUTE FUNCTION public.notif_documenti_trigger();

-- Attività CRM completata → risolvi
CREATE OR REPLACE FUNCTION public.notif_crm_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assegnata_a IS NOT NULL AND NEW.stato = 'pianificata' THEN
      PERFORM public.create_notifica_event(
        NEW.organization_id, ARRAY[NEW.assegnata_a], 'attivita_assegnata', 'info',
        'Nuova attività assegnata', NEW.titolo,
        'crm_attivita', NEW.id, '/clienti/' || NEW.cliente_id::text, NULL, '{}'::jsonb, NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stato <> 'pianificata' AND OLD.stato = 'pianificata' THEN
    PERFORM public.resolve_notifiche(NEW.organization_id,
      ARRAY['attivita_in_scadenza','attivita_scaduta','attivita_assegnata'], NEW.id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER notifiche_crm_attivita
AFTER INSERT OR UPDATE OF stato ON public.crm_attivita
FOR EACH ROW EXECUTE FUNCTION public.notif_crm_trigger();

-- ============================================================
-- SWEEP condizioni temporali (documenti, commesse, budget, CRM, preventivi)
-- ============================================================
CREATE OR REPLACE FUNCTION public.notifiche_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  org uuid;
  admins uuid[]; econ uuid[]; tecnici uuid[];
  n integer := 0;
  r record;
  dest uuid[];
BEGIN
  org := public.current_organization_id();
  IF org IS NULL THEN RETURN 0; END IF;

  admins := public.notif_users_by_roles(org, ARRAY['proprietario','amministratore']::app_role[]);
  econ := public.notif_users_by_roles(org, ARRAY['proprietario','amministratore','amministrazione']::app_role[]);
  tecnici := public.notif_users_by_roles(org, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]);

  -- DOCUMENTI
  FOR r IN
    SELECT d.id, d.nome, d.data_scadenza, d.commessa_id
    FROM public.documenti d
    WHERE d.organization_id = org AND d.archived_at IS NULL
      AND d.is_versione_corrente = true AND d.upload_stato = 'disponibile'
      AND d.data_scadenza IS NOT NULL
      AND d.data_scadenza <= CURRENT_DATE + 30
  LOOP
    dest := (SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) FROM (
      SELECT unnest(econ) AS x
      UNION SELECT unnest(CASE WHEN r.commessa_id IS NOT NULL
        THEN public.notif_users_commessa(r.commessa_id) ELSE ARRAY[]::uuid[] END)
    ) s);
    IF r.data_scadenza < CURRENT_DATE THEN
      PERFORM public.resolve_notifiche(org, ARRAY['documento_in_scadenza_7','documento_in_scadenza_30'], r.id);
      n := n + public.create_notifica_event(org, dest, 'documento_scaduto', 'critica',
        'Documento scaduto', 'Il documento "' || r.nome || '" è scaduto il ' || to_char(r.data_scadenza,'DD/MM/YYYY') || '.',
        'documento', r.id, '/documenti/' || r.id::text,
        r.id::text || ':' || to_char(r.data_scadenza,'YYYY-MM'));
    ELSIF r.data_scadenza <= CURRENT_DATE + 7 THEN
      PERFORM public.resolve_notifiche(org, ARRAY['documento_in_scadenza_30'], r.id);
      n := n + public.create_notifica_event(org, dest, 'documento_in_scadenza_7', 'attenzione',
        'Documento in scadenza', 'Il documento "' || r.nome || '" scade il ' || to_char(r.data_scadenza,'DD/MM/YYYY') || '.',
        'documento', r.id, '/documenti/' || r.id::text,
        r.id::text || ':' || to_char(r.data_scadenza,'YYYY-MM-DD'));
    ELSE
      n := n + public.create_notifica_event(org, dest, 'documento_in_scadenza_30', 'info',
        'Documento in scadenza tra 30 giorni', 'Il documento "' || r.nome || '" scade il ' || to_char(r.data_scadenza,'DD/MM/YYYY') || '.',
        'documento', r.id, '/documenti/' || r.id::text,
        r.id::text || ':' || to_char(r.data_scadenza,'YYYY-MM-DD'));
    END IF;
  END LOOP;

  -- COMMESSE
  FOR r IN
    SELECT c.id, c.codice, c.denominazione, c.stato, c.data_fine_prevista,
           c.costi_sostenuti, c.costi_previsti, c.margine_aggiornato
    FROM public.commesse c
    WHERE c.organization_id = org AND c.archived_at IS NULL AND c.closed_at IS NULL
  LOOP
    dest := (SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) FROM (
      SELECT unnest(tecnici) AS x UNION SELECT unnest(public.notif_users_commessa(r.id))
    ) s);

    IF r.stato = 'sospesa' THEN
      n := n + public.create_notifica_event(org, dest, 'commessa_sospesa', 'attenzione',
        'Commessa sospesa', 'La commessa ' || r.codice || ' — ' || r.denominazione || ' è sospesa.',
        'commessa', r.id, '/commesse/' || r.id::text);
    ELSE
      PERFORM public.resolve_notifiche(org, ARRAY['commessa_sospesa'], r.id);
    END IF;

    IF r.data_fine_prevista IS NOT NULL AND r.data_fine_prevista < CURRENT_DATE
       AND r.stato NOT IN ('completata','annullata') THEN
      n := n + public.create_notifica_event(org, dest, 'commessa_scadenza_superata', 'critica',
        'Scadenza commessa superata',
        'La commessa ' || r.codice || ' doveva concludersi il ' || to_char(r.data_fine_prevista,'DD/MM/YYYY') || '.',
        'commessa', r.id, '/commesse/' || r.id::text, r.id::text || ':' || to_char(CURRENT_DATE,'YYYY-MM'));
    ELSE
      PERFORM public.resolve_notifiche(org, ARRAY['commessa_scadenza_superata'], r.id);
    END IF;

    -- BUDGET (solo ruoli economici)
    IF COALESCE(r.costi_previsti,0) > 0 AND COALESCE(r.costi_sostenuti,0) > COALESCE(r.costi_previsti,0) THEN
      n := n + public.create_notifica_event(org, econ, 'budget_superato', 'critica',
        'Budget superato', 'I costi sostenuti della commessa ' || r.codice || ' superano il budget previsto.',
        'commessa', r.id, '/commesse/' || r.id::text, r.id::text || ':' || to_char(CURRENT_DATE,'YYYY-MM'));
    ELSE
      PERFORM public.resolve_notifiche(org, ARRAY['budget_superato'], r.id);
    END IF;

    IF r.margine_aggiornato IS NOT NULL AND r.margine_aggiornato < 0 THEN
      n := n + public.create_notifica_event(org, econ, 'margine_negativo', 'critica',
        'Margine negativo', 'La commessa ' || r.codice || ' presenta un margine aggiornato negativo.',
        'commessa', r.id, '/commesse/' || r.id::text, r.id::text || ':' || to_char(CURRENT_DATE,'YYYY-MM'));
    ELSE
      PERFORM public.resolve_notifiche(org, ARRAY['margine_negativo'], r.id);
    END IF;
  END LOOP;

  -- CRM ATTIVITÀ
  FOR r IN
    SELECT a.id, a.titolo, a.scadenza, a.assegnata_a, a.cliente_id
    FROM public.crm_attivita a
    WHERE a.organization_id = org AND a.archived_at IS NULL
      AND a.stato = 'pianificata' AND a.scadenza IS NOT NULL
      AND a.scadenza <= now() + interval '24 hours'
  LOOP
    dest := COALESCE(NULLIF(ARRAY[r.assegnata_a], ARRAY[NULL]::uuid[]), admins);
    IF r.scadenza < now() THEN
      PERFORM public.resolve_notifiche(org, ARRAY['attivita_in_scadenza'], r.id);
      n := n + public.create_notifica_event(org, dest, 'attivita_scaduta', 'critica',
        'Attività scaduta', r.titolo, 'crm_attivita', r.id, '/clienti/' || r.cliente_id::text,
        r.id::text || ':' || to_char(r.scadenza,'YYYY-MM-DD'));
    ELSE
      n := n + public.create_notifica_event(org, dest, 'attivita_in_scadenza', 'attenzione',
        'Attività in scadenza', r.titolo, 'crm_attivita', r.id, '/clienti/' || r.cliente_id::text,
        r.id::text || ':' || to_char(r.scadenza,'YYYY-MM-DD'));
    END IF;
  END LOOP;

  -- PREVENTIVI
  FOR r IN
    SELECT p.id, p.numero, p.oggetto, p.stato, p.data_invio, p.data_validita, p.data_accettazione
    FROM public.preventivi p
    WHERE p.organization_id = org AND p.is_current_version = true
      AND p.stato IN ('inviato','accettato')
  LOOP
    IF r.stato = 'inviato' AND r.data_invio IS NOT NULL AND r.data_invio < CURRENT_DATE - 14 THEN
      n := n + public.create_notifica_event(org, tecnici, 'preventivo_inviato_da_seguire', 'attenzione',
        'Preventivo da seguire', 'Il preventivo ' || r.numero || ' è inviato da oltre 14 giorni senza esito.',
        'preventivo', r.id, '/preventivi/' || r.id::text, r.id::text || ':' || to_char(CURRENT_DATE,'YYYY-MM'));
    END IF;
    IF r.stato = 'inviato' AND r.data_validita IS NOT NULL AND r.data_validita <= CURRENT_DATE + 7 THEN
      n := n + public.create_notifica_event(org, tecnici, 'preventivo_in_scadenza', 'attenzione',
        'Preventivo in scadenza', 'Il preventivo ' || r.numero || ' scade il ' || to_char(r.data_validita,'DD/MM/YYYY') || '.',
        'preventivo', r.id, '/preventivi/' || r.id::text, r.id::text || ':' || to_char(r.data_validita,'YYYY-MM-DD'));
    END IF;
    IF r.stato = 'accettato' THEN
      n := n + public.create_notifica_event(org, tecnici, 'preventivo_accettato_non_convertito', 'attenzione',
        'Preventivo accettato non convertito', 'Il preventivo ' || r.numero || ' è accettato ma non ancora convertito in commessa.',
        'preventivo', r.id, '/preventivi/' || r.id::text);
    ELSE
      PERFORM public.resolve_notifiche(org, ARRAY['preventivo_accettato_non_convertito'], r.id);
    END IF;
  END LOOP;

  RETURN n;
END; $$;

-- ============================================================
-- RPC lettura/archiviazione (destinatario = auth.uid())
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_notifica_read(_id uuid, _read boolean DEFAULT true)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v timestamptz;
BEGIN
  UPDATE public.notifiche SET read_at = CASE WHEN _read THEN COALESCE(read_at, now()) ELSE NULL END
   WHERE id = _id AND destinatario_user_id = auth.uid()
  RETURNING read_at INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICA_NON_TROVATA'; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_all_notifiche_read()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.notifiche SET read_at = now()
   WHERE destinatario_user_id = auth.uid() AND read_at IS NULL AND archived_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.archive_notifica(_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v timestamptz;
BEGIN
  UPDATE public.notifiche SET archived_at = COALESCE(archived_at, now()), read_at = COALESCE(read_at, now())
   WHERE id = _id AND destinatario_user_id = auth.uid()
  RETURNING archived_at INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICA_NON_TROVATA'; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.archive_all_read_notifiche()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.notifiche SET archived_at = now()
   WHERE destinatario_user_id = auth.uid() AND read_at IS NOT NULL AND archived_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.create_notifica_event(uuid,uuid[],text,text,text,text,text,uuid,text,text,jsonb,uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_notifiche(uuid,text[],uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.notif_users_by_roles(uuid,app_role[]) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.notif_users_commessa(uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.notifiche_sweep() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifica_read(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifiche_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_notifica(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_all_read_notifiche() TO authenticated;