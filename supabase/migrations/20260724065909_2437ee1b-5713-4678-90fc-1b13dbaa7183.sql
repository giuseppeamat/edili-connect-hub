CREATE OR REPLACE FUNCTION public.assign_preventivo_numero(_org uuid, _anno integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_n INT;
  v_numero TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_org::text || '|' || _anno::text, 0));

  SELECT COALESCE(MAX(
    CASE WHEN p.numero ~ ('^PREV-' || _anno || '-\d+$')
      THEN CAST(split_part(p.numero, '-', 3) AS INT)
      ELSE 0 END
  ), 0) + 1
  INTO next_n
  FROM public.preventivi p
  WHERE p.organization_id = _org;

  v_numero := 'PREV-' || _anno || '-' || LPAD(next_n::text, 4, '0');
  RETURN v_numero;
END;
$function$;