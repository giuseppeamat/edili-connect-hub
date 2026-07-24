
-- 1) Aggiunta stato 'bozza'
ALTER TYPE public.commessa_stato ADD VALUE IF NOT EXISTS 'bozza' BEFORE 'pianificata';

-- 2) RPC transizioni di stato (usa confronti testuali per evitare parse-time issue col nuovo enum)
CREATE OR REPLACE FUNCTION public.change_commessa_stato(
  _commessa_id uuid,
  _nuovo_stato public.commessa_stato,
  _expected_updated_at timestamptz,
  _motivazione text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  _uid uuid := auth.uid();
  _cur text;
  _new text;
  _ok boolean := false;
  _is_admin boolean;
  _is_tecnico boolean;
  _is_resp_only boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;

  SELECT * INTO c FROM public.commesse WHERE id = _commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;

  _is_admin  := public.has_any_role(c.organization_id, ARRAY['proprietario','amministratore']::app_role[]);
  _is_tecnico := public.has_any_role(c.organization_id, ARRAY['ufficio_tecnico']::app_role[]);
  _is_resp_only := (NOT _is_admin) AND (NOT _is_tecnico)
                   AND public.has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[])
                   AND c.responsabile_id = _uid;

  IF NOT (_is_admin OR _is_tecnico OR _is_resp_only) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  IF c.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Questa commessa è stata modificata da un altro utente. Ricarica la pagina prima di salvare.';
  END IF;
  IF c.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'La commessa è chiusa e non può essere modificata senza essere riaperta.';
  END IF;
  IF c.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Commessa archiviata: ripristinala prima di modificarla.';
  END IF;

  _cur := c.stato::text;
  _new := _nuovo_stato::text;
  IF _cur = _new THEN RETURN; END IF;

  _ok := CASE
    WHEN _cur='bozza'       AND _new IN ('pianificata','annullata') THEN true
    WHEN _cur='pianificata' AND _new IN ('in_corso','sospesa','annullata') THEN true
    WHEN _cur='in_corso'    AND _new IN ('sospesa','completata') THEN true
    WHEN _cur='in_corso'    AND _new='annullata' AND _motivazione IS NOT NULL AND length(trim(_motivazione))>0 THEN true
    WHEN _cur='sospesa'     AND _new IN ('in_corso','completata','annullata') THEN true
    ELSE false
  END;

  -- Restrizioni per ruolo
  IF _new = 'completata' AND NOT _is_admin AND NOT _is_tecnico THEN
    _ok := false; -- responsabile_commessa non completa
  END IF;
  IF _new = 'completata' AND _is_tecnico AND NOT _is_admin THEN
    -- ufficio_tecnico non chiude definitivamente ma può marcare completata? Spec: "non chiude definitivamente"
    -- Completare != chiudere (closeCommessa fa closed_at). Consentiamo completata a tecnico.
    NULL;
  END IF;
  IF _is_resp_only AND _new IN ('completata','annullata') THEN
    _ok := false;
  END IF;

  IF NOT _ok THEN
    RAISE EXCEPTION 'Il passaggio di stato richiesto non è consentito.';
  END IF;

  UPDATE public.commesse SET stato = _nuovo_stato, updated_at = now() WHERE id = _commessa_id;

  INSERT INTO public.audit_log (organization_id, user_id, action, entity, entity_id, metadata)
  VALUES (c.organization_id, _uid, 'commessa.state_changed', 'commesse', _commessa_id,
    jsonb_build_object('stato_precedente', _cur, 'stato_nuovo', _new, 'motivazione', _motivazione));
END;
$$;

REVOKE ALL ON FUNCTION public.change_commessa_stato(uuid, public.commessa_stato, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_commessa_stato(uuid, public.commessa_stato, timestamptz, text) TO authenticated;

-- 3) Estensione conversione preventivo → commessa: campi canonici + responsabile validato
CREATE OR REPLACE FUNCTION public.convert_preventivo_to_commessa(
  _preventivo_id uuid,
  _data_inizio date DEFAULT NULL,
  _data_fine_prevista date DEFAULT NULL,
  _indirizzo_cantiere text DEFAULT NULL,
  _responsabile_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  _org uuid;
  _uid uuid := auth.uid();
  _codice text;
  _new_commessa_id uuid;
  _existing uuid;
  _resp uuid;
  _resp_req uuid;
  _resp_dropped boolean := false;
  _ricavi numeric(14,2);
  _costi numeric(14,2);
  _margine_prev numeric(14,2);
  _margine_pct numeric(6,2);
  _data_ap date;
  _titolo text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;

  SELECT * INTO p FROM public.preventivi WHERE id = _preventivo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preventivo non trovato' USING ERRCODE='P0002'; END IF;
  _org := p.organization_id;

  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato a convertire preventivi' USING ERRCODE='42501';
  END IF;

  IF p.stato NOT IN ('accettato') THEN
    RAISE EXCEPTION 'Solo preventivi accettati possono essere convertiti (stato attuale: %)', p.stato USING ERRCODE='22023';
  END IF;
  IF p.is_current_version = false THEN
    RAISE EXCEPTION 'Solo la versione corrente del preventivo può essere convertita' USING ERRCODE='22023';
  END IF;

  SELECT id INTO _existing FROM public.commesse WHERE preventivo_id = _preventivo_id LIMIT 1;
  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'Preventivo già convertito nella commessa %', _existing USING ERRCODE='23505';
  END IF;

  _data_ap := COALESCE(_data_inizio, CURRENT_DATE);
  _codice := public.assign_commessa_codice(_org, EXTRACT(YEAR FROM _data_ap)::int);

  _resp_req := COALESCE(_responsabile_id, p.responsabile_id);
  IF _resp_req IS NOT NULL AND public.is_valid_responsabile(_resp_req, _org) THEN
    _resp := _resp_req;
  ELSE
    _resp := NULL;
    IF _resp_req IS NOT NULL THEN _resp_dropped := true; END IF;
  END IF;

  _titolo := COALESCE(p.titolo, p.oggetto, 'Commessa ' || _codice);
  _ricavi := COALESCE(p.totale_ricavo, p.totale, 0);
  _costi  := COALESCE(p.totale_costo, 0);
  _margine_prev := ROUND(_ricavi - _costi, 2);
  _margine_pct  := CASE WHEN _ricavi > 0 THEN ROUND(_margine_prev / _ricavi * 100, 2) ELSE 0 END;

  INSERT INTO public.commesse (
    organization_id, cliente_id, preventivo_id, codice,
    denominazione, titolo, descrizione,
    importo, importo_contratto, ricavi_previsti,
    budget_costi, costi_previsti, costi_impegnati,
    margine_previsto, margine_aggiornato, margine_percentuale,
    data_inizio, data_apertura, data_inizio_prevista, data_fine_prevista,
    indirizzo_cantiere, responsabile_id, note, note_interne,
    stato, priorita, created_by
  ) VALUES (
    _org, p.cliente_id, p.id, _codice,
    _titolo, _titolo, p.oggetto,
    _ricavi, _ricavi, _ricavi,
    _costi, _costi, 0,
    _margine_prev, _margine_prev, _margine_pct,
    _data_ap, _data_ap, _data_ap, _data_fine_prevista,
    _indirizzo_cantiere, _resp, _note, _note,
    'pianificata', 'normale', _uid
  ) RETURNING id INTO _new_commessa_id;

  UPDATE public.preventivi
    SET stato = 'convertito',
        convertito_at = now(),
        updated_at = now()
    WHERE id = _preventivo_id;

  INSERT INTO public.preventivo_storico_stati
    (organization_id, preventivo_id, stato_precedente, stato_nuovo, changed_by, note, metadata)
  VALUES
    (_org, _preventivo_id, p.stato, 'convertito', _uid,
     'Conversione in commessa ' || _codice,
     jsonb_build_object('commessa_id', _new_commessa_id, 'codice', _codice));

  INSERT INTO public.audit_log (organization_id, user_id, action, entity, entity_id, metadata)
  VALUES (_org, _uid, 'commessa.converted_from_preventivo', 'commesse', _new_commessa_id,
    jsonb_build_object(
      'preventivo_id', _preventivo_id,
      'codice', _codice,
      'responsabile_richiesto', _resp_req,
      'responsabile_assegnato', _resp,
      'responsabile_scartato', _resp_dropped,
      'ricavi_previsti', _ricavi,
      'costi_previsti', _costi
    ));

  RETURN _new_commessa_id;
END;
$$;
