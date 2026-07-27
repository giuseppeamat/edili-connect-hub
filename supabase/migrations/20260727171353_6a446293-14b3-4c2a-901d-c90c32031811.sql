CREATE OR REPLACE FUNCTION public.create_rapportino(_commessa_id uuid, _user_id uuid, _data date, _ore numeric, _descrizione_lavori text, _cantiere_id uuid DEFAULT NULL::uuid, _fase_id uuid DEFAULT NULL::uuid, _ora_inizio time without time zone DEFAULT NULL::time without time zone, _ora_fine time without time zone DEFAULT NULL::time without time zone, _pausa_minuti integer DEFAULT 0, _note text DEFAULT NULL::text, _foto_urls text[] DEFAULT NULL::text[], _override_ore boolean DEFAULT false, _override_motivo text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _me         UUID := auth.uid();
  _org        UUID;
  _c_org      UUID;
  _c_closed   TIMESTAMPTZ;
  _c_arch     TIMESTAMPTZ;
  _t_active   BOOLEAN;
  _t_org      UUID;
  _is_admin   BOOLEAN;
  _new_id     UUID;
  _new_upd    TIMESTAMPTZ;
BEGIN
  SELECT p.organization_id INTO _org
    FROM public._rap_current_profile() p;

  IF _user_id IS NULL THEN RAISE EXCEPTION 'Utente obbligatorio' USING ERRCODE='22023'; END IF;
  SELECT organization_id, COALESCE(is_active,false)
    INTO _t_org, _t_active FROM public.profiles WHERE profiles.id = _user_id;
  IF _t_org IS DISTINCT FROM _org THEN
    RAISE EXCEPTION 'Utente non appartiene all''organizzazione' USING ERRCODE='42501';
  END IF;
  IF _t_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Utente riferito non è attivo' USING ERRCODE='42501';
  END IF;

  _is_admin := public.has_any_role(_org,
      ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]);
  IF _user_id <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non autorizzato a creare rapportini per altri utenti' USING ERRCODE='42501';
  END IF;

  SELECT organization_id, closed_at, archived_at INTO _c_org, _c_closed, _c_arch
    FROM public.commesse WHERE commesse.id = _commessa_id;
  IF _c_org IS DISTINCT FROM _org THEN
    RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='42501';
  END IF;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_commessa(_commessa_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere alla commessa' USING ERRCODE='42501';
  END IF;
  IF _cantiere_id IS NOT NULL AND NOT public.can_access_cantiere(_cantiere_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere al cantiere' USING ERRCODE='42501';
  END IF;

  IF _data IS NULL THEN RAISE EXCEPTION 'Data obbligatoria' USING ERRCODE='22023'; END IF;
  IF _data > (CURRENT_DATE + INTERVAL '1 day')::date THEN
    RAISE EXCEPTION 'Data futura oltre la soglia consentita (max domani)' USING ERRCODE='22023';
  END IF;

  IF _descrizione_lavori IS NULL OR btrim(_descrizione_lavori) = '' THEN
    RAISE EXCEPTION 'Descrizione lavori obbligatoria' USING ERRCODE='22023';
  END IF;

  IF _ore IS NULL OR _ore <= 0 OR _ore > 24 THEN
    RAISE EXCEPTION 'Ore non valide (0 < ore <= 24)' USING ERRCODE='22023';
  END IF;
  IF _ore > 16 THEN
    IF NOT _override_ore OR NOT public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]) THEN
      RAISE EXCEPTION 'Ore oltre il limite operativo di 16 (richiesto override amministratore)' USING ERRCODE='22023';
    END IF;
    IF _override_motivo IS NULL OR btrim(_override_motivo) = '' THEN
      RAISE EXCEPTION 'Motivazione override obbligatoria' USING ERRCODE='22023';
    END IF;
  END IF;

  IF _ora_inizio IS NOT NULL AND _ora_fine IS NOT NULL AND _ora_fine < _ora_inizio THEN
    RAISE EXCEPTION 'Ora fine antecedente all''ora inizio' USING ERRCODE='22023';
  END IF;
  IF _pausa_minuti IS NULL OR _pausa_minuti < 0 THEN
    RAISE EXCEPTION 'Pausa non valida' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.rapportini(
    organization_id, commessa_id, cantiere_id, fase_id, user_id,
    data, ora_inizio, ora_fine, pausa_minuti, ore,
    descrizione_lavori, lavorazione, note, foto_urls,
    stato, created_by, updated_at
  ) VALUES (
    _org, _commessa_id, _cantiere_id, _fase_id, _user_id,
    _data, _ora_inizio, _ora_fine, COALESCE(_pausa_minuti,0), _ore,
    btrim(_descrizione_lavori), btrim(_descrizione_lavori), _note, COALESCE(_foto_urls, '{}'::text[]),
    'bozza', _me, now()
  ) RETURNING rapportini.id, rapportini.updated_at INTO _new_id, _new_upd;

  PERFORM public._log_audit(_org, 'rapportino.created', 'rapportini', _new_id,
    jsonb_build_object('commessa_id', _commessa_id, 'user_id', _user_id, 'ore', _ore));

  id := _new_id; updated_at := _new_upd; RETURN NEXT;
END; $function$;