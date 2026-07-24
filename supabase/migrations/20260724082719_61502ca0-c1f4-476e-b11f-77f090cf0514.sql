
CREATE OR REPLACE FUNCTION public.assign_commessa_codice(_org uuid, _anno integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  next_n INT;
  v_codice TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('commessa|' || _org::text || '|' || _anno::text, 0));
  SELECT COALESCE(MAX(
    CASE WHEN c.codice ~ ('^CANT-' || _anno || '-\d+$')
      THEN CAST(split_part(c.codice, '-', 3) AS INT)
      ELSE 0 END
  ), 0) + 1
  INTO next_n
  FROM public.commesse c
  WHERE c.organization_id = _org;
  v_codice := 'CANT-' || _anno || '-' || LPAD(next_n::text, 4, '0');
  RETURN v_codice;
END;
$function$;
