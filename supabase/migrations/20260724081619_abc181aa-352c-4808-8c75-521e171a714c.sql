
CREATE OR REPLACE FUNCTION public.change_preventivo_stato(_preventivo_id uuid, _nuovo_stato preventivo_stato, _note text DEFAULT NULL::text, _motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  _uid uuid := auth.uid();
  _existing_commessa uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.preventivi WHERE id = _preventivo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preventivo non trovato'; END IF;

  IF NOT public.has_any_role(p.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  IF p.stato = _nuovo_stato THEN
    RETURN;
  END IF;

  UPDATE public.preventivi SET
    stato = _nuovo_stato,
    data_invio        = CASE WHEN _nuovo_stato='inviato'    AND data_invio        IS NULL THEN now() ELSE data_invio END,
    data_accettazione = CASE WHEN _nuovo_stato='accettato'  AND data_accettazione IS NULL THEN now() ELSE data_accettazione END,
    data_rifiuto      = CASE WHEN _nuovo_stato='rifiutato'  AND data_rifiuto      IS NULL THEN now() ELSE data_rifiuto END,
    motivo_rifiuto    = CASE WHEN _nuovo_stato='rifiutato'  THEN COALESCE(_motivo, motivo_rifiuto) ELSE motivo_rifiuto END,
    annullato_at      = CASE WHEN _nuovo_stato='annullato'  AND annullato_at      IS NULL THEN now() ELSE annullato_at END,
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

  -- Auto-conversione in commessa quando si passa ad "accettato"
  IF _nuovo_stato = 'accettato' AND COALESCE(p.is_current_version, true) = true THEN
    SELECT id INTO _existing_commessa FROM public.commesse WHERE preventivo_id = _preventivo_id LIMIT 1;
    IF _existing_commessa IS NULL THEN
      BEGIN
        PERFORM public.convert_preventivo_to_commessa(_preventivo_id, NULL, NULL, NULL, NULL, NULL);
      EXCEPTION WHEN OTHERS THEN
        -- non blocca il cambio stato se la conversione fallisce
        NULL;
      END;
    END IF;
  END IF;
END;
$function$;
