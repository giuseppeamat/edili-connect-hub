DO $mig$
DECLARE _def TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _def FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='update_rapportino';

  _def := replace(_def,
$old$  IF _new_ore IS NULL OR _new_ore <= 0 OR _new_ore > 24 THEN
    RAISE EXCEPTION 'Ore non valide (0 < ore <= 24)' USING ERRCODE='22023';$old$,
$new$  IF _new_ore IS NULL OR _new_ore <= 0 OR _new_ore > 24 * GREATEST(1, (SELECT COUNT(*) FROM public.rapportini_personale rp WHERE rp.rapportino_id = _id AND rp.annullato_at IS NULL)) THEN
    RAISE EXCEPTION 'Ore non valide (massimo 24 ore per persona impiegata)' USING ERRCODE='22023';$new$);

  _def := replace(_def,
$old$  IF _new_ore > 16 THEN$old$,
$new$  IF _new_ore > 16 * GREATEST(1, (SELECT COUNT(*) FROM public.rapportini_personale rp WHERE rp.rapportino_id = _id AND rp.annullato_at IS NULL)) THEN$new$);

  _def := replace(_def,
    'Ore oltre il limite operativo di 16 (richiesto override amministratore)',
    'Ore oltre il limite operativo di 16 per persona (richiesto override amministratore)');

  EXECUTE _def;
END $mig$;
