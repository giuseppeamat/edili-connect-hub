
CREATE OR REPLACE FUNCTION public.assign_commessa_codice(_org uuid, _anno integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_n INT;
  codice TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('commessa|' || _org::text || '|' || _anno::text, 0));
  SELECT COALESCE(MAX(
    CASE WHEN codice ~ ('^CANT-' || _anno || '-\d+$')
      THEN CAST(split_part(codice, '-', 3) AS INT)
      ELSE 0 END
  ), 0) + 1
  INTO next_n
  FROM public.commesse
  WHERE organization_id = _org;
  codice := 'CANT-' || _anno || '-' || LPAD(next_n::text, 4, '0');
  RETURN codice;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_commessa_codice(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_commessa_codice(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.convert_preventivo_to_commessa(
  _preventivo_id uuid,
  _data_inizio date DEFAULT NULL,
  _data_fine_prevista date DEFAULT NULL,
  _indirizzo_cantiere text DEFAULT NULL,
  _responsabile_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS uuid
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

  _codice := public.assign_commessa_codice(_org, EXTRACT(YEAR FROM COALESCE(_data_inizio, CURRENT_DATE))::int);

  INSERT INTO public.commesse (
    organization_id, cliente_id, preventivo_id, codice, denominazione,
    importo, budget_costi, data_inizio, data_fine_prevista,
    indirizzo_cantiere, responsabile_id, note, stato
  ) VALUES (
    _org, p.cliente_id, p.id, _codice,
    COALESCE(p.titolo, p.oggetto),
    COALESCE(p.totale_ricavo, p.totale, 0),
    COALESCE(p.totale_costo, 0),
    COALESCE(_data_inizio, CURRENT_DATE),
    _data_fine_prevista,
    _indirizzo_cantiere,
    COALESCE(_responsabile_id, p.responsabile_id),
    _note,
    'pianificata'
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
  VALUES (_org, _uid, 'convert_to_commessa', 'preventivi', _preventivo_id,
          jsonb_build_object('commessa_id', _new_commessa_id, 'codice', _codice));

  RETURN _new_commessa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_preventivo_to_commessa(uuid, date, date, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_preventivo_to_commessa(uuid, date, date, text, uuid, text) TO authenticated;

-- Server-side validated state transition (single source of truth)
CREATE OR REPLACE FUNCTION public.change_preventivo_stato(
  _preventivo_id uuid,
  _nuovo_stato preventivo_stato,
  _note text DEFAULT NULL,
  _motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  _uid uuid := auth.uid();
  ok boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.preventivi WHERE id = _preventivo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preventivo non trovato'; END IF;

  IF NOT public.has_any_role(p.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  -- Transizioni consentite
  ok := CASE p.stato
    WHEN 'bozza'        THEN _nuovo_stato IN ('in_revisione','pronto','inviato','annullato')
    WHEN 'in_revisione' THEN _nuovo_stato IN ('bozza','pronto','annullato')
    WHEN 'pronto'       THEN _nuovo_stato IN ('bozza','inviato','annullato')
    WHEN 'inviato'      THEN _nuovo_stato IN ('accettato','rifiutato','scaduto','annullato')
    WHEN 'accettato'    THEN _nuovo_stato IN ('convertito','annullato')
    WHEN 'rifiutato'    THEN _nuovo_stato IN ('bozza','annullato')
    WHEN 'scaduto'      THEN _nuovo_stato IN ('bozza','annullato')
    ELSE false
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Transizione non consentita: % → %', p.stato, _nuovo_stato USING ERRCODE='22023';
  END IF;

  UPDATE public.preventivi SET
    stato = _nuovo_stato,
    data_invio       = CASE WHEN _nuovo_stato='inviato'    AND data_invio       IS NULL THEN now() ELSE data_invio END,
    data_accettazione= CASE WHEN _nuovo_stato='accettato'  AND data_accettazione IS NULL THEN now() ELSE data_accettazione END,
    data_rifiuto     = CASE WHEN _nuovo_stato='rifiutato'  AND data_rifiuto     IS NULL THEN now() ELSE data_rifiuto END,
    motivo_rifiuto   = CASE WHEN _nuovo_stato='rifiutato'  THEN COALESCE(_motivo, motivo_rifiuto) ELSE motivo_rifiuto END,
    annullato_at     = CASE WHEN _nuovo_stato='annullato'  AND annullato_at     IS NULL THEN now() ELSE annullato_at END,
    updated_at = now()
  WHERE id = _preventivo_id;

  INSERT INTO public.preventivo_storico_stati
    (organization_id, preventivo_id, stato_precedente, stato_nuovo, changed_by, note, metadata)
  VALUES
    (p.organization_id, _preventivo_id, p.stato, _nuovo_stato, _uid, _note,
     jsonb_build_object('motivo', _motivo));

  INSERT INTO public.audit_log (organization_id, user_id, action, entity, entity_id, metadata)
  VALUES (p.organization_id, _uid, 'change_stato', 'preventivi', _preventivo_id,
          jsonb_build_object('from', p.stato, 'to', _nuovo_stato));
END;
$$;

REVOKE ALL ON FUNCTION public.change_preventivo_stato(uuid, preventivo_stato, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_preventivo_stato(uuid, preventivo_stato, text, text) TO authenticated;

-- Nuova versione atomica del preventivo (copia intestazione, categorie, voci)
CREATE OR REPLACE FUNCTION public.create_preventivo_nuova_versione(
  _preventivo_id uuid,
  _motivo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  _uid uuid := auth.uid();
  _new_id uuid;
  _new_version int;
  _root uuid;
  cat RECORD;
  _new_cat_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.preventivi WHERE id = _preventivo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preventivo non trovato'; END IF;
  IF NOT public.has_any_role(p.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  _root := COALESCE(p.root_preventivo_id, p.id);

  SELECT COALESCE(MAX(versione),0)+1 INTO _new_version
  FROM public.preventivi
  WHERE organization_id = p.organization_id
    AND (id = _root OR root_preventivo_id = _root)
    AND numero = p.numero;

  INSERT INTO public.preventivi (
    organization_id, cliente_id, numero, versione, stato, tipo, titolo, oggetto, note,
    data_preventivo, data_validita, responsabile_id,
    sconto_globale_pct, maggiorazione_globale_pct, spese_accessorie, iva_default_pct,
    condizioni_pagamento, tempi_esecuzione, esclusioni, garanzie, condizioni_generali, firma_referente,
    root_preventivo_id, parent_version_id, is_current_version, motivo_nuova_versione, created_by
  ) VALUES (
    p.organization_id, p.cliente_id, p.numero, _new_version, 'bozza', p.tipo, p.titolo, p.oggetto, p.note,
    CURRENT_DATE, p.data_validita, p.responsabile_id,
    p.sconto_globale_pct, p.maggiorazione_globale_pct, p.spese_accessorie, p.iva_default_pct,
    p.condizioni_pagamento, p.tempi_esecuzione, p.esclusioni, p.garanzie, p.condizioni_generali, p.firma_referente,
    _root, p.id, true, _motivo, _uid
  ) RETURNING id INTO _new_id;

  -- Marca vecchia versione come superata
  UPDATE public.preventivi
    SET is_current_version = false,
        superseded_at = now(),
        superseded_by = _new_id,
        updated_at = now()
    WHERE id = _preventivo_id;

  -- Copia categorie + voci
  FOR cat IN SELECT * FROM public.preventivo_categorie WHERE preventivo_id = _preventivo_id ORDER BY posizione LOOP
    INSERT INTO public.preventivo_categorie (organization_id, preventivo_id, titolo, descrizione, posizione)
    VALUES (p.organization_id, _new_id, cat.titolo, cat.descrizione, cat.posizione)
    RETURNING id INTO _new_cat_id;

    INSERT INTO public.preventivo_voci (
      organization_id, preventivo_id, categoria_id, ordine, codice, capitolo, categoria,
      descrizione, unita_misura, quantita, costo_unitario, ricarico_pct, prezzo_unitario,
      sconto_pct, maggiorazione_pct, iva_pct, note
    )
    SELECT p.organization_id, _new_id, _new_cat_id, v.ordine, v.codice, v.capitolo, v.categoria,
           v.descrizione, v.unita_misura, v.quantita, v.costo_unitario, v.ricarico_pct, v.prezzo_unitario,
           v.sconto_pct, v.maggiorazione_pct, v.iva_pct, v.note
    FROM public.preventivo_voci v
    WHERE v.categoria_id = cat.id
    ORDER BY v.ordine;
  END LOOP;

  INSERT INTO public.audit_log (organization_id, user_id, action, entity, entity_id, metadata)
  VALUES (p.organization_id, _uid, 'new_version', 'preventivi', _new_id,
          jsonb_build_object('from', _preventivo_id, 'versione', _new_version, 'motivo', _motivo));

  RETURN _new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_preventivo_nuova_versione(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_preventivo_nuova_versione(uuid, text) TO authenticated;
