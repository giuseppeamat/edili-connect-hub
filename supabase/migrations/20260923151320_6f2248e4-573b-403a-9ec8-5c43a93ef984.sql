CREATE OR REPLACE FUNCTION public.list_bolle(_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org uuid; econ boolean; items jsonb; tot int;
  _q text; _forn uuid; _com uuid; _coll text; _stato text; _arch boolean; _page int; _size int;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata'; END IF;
  econ := public.can_see_econ(org);
  _q := NULLIF(btrim(COALESCE(_filters->>'q','')),'');
  _forn := NULLIF(_filters->>'fornitore_id','')::uuid;
  _com := NULLIF(_filters->>'commessa_id','')::uuid;
  _coll := NULLIF(_filters->>'collegamento','');
  _stato := NULLIF(_filters->>'stato','');
  _arch := COALESCE((_filters->>'includeArchived')::boolean, false);
  _page := GREATEST(1, COALESCE((_filters->>'page')::int, 1));
  _size := LEAST(100, GREATEST(1, COALESCE((_filters->>'pageSize')::int, 25)));

  WITH base AS (
    SELECT bo.id
    FROM public.rapportini_bolle bo
    LEFT JOIN public.fornitori f ON f.id = bo.fornitore_id
    WHERE bo.organization_id = org
      AND (_arch OR bo.archived_at IS NULL)
      AND (_forn IS NULL OR bo.fornitore_id = _forn)
      AND (_com IS NULL OR bo.commessa_id = _com)
      AND (_stato IS NULL OR bo.stato = _stato)
      AND (_coll IS NULL
           OR (_coll = 'collegata' AND bo.rapportino_id IS NOT NULL)
           OR (_coll = 'non_collegata' AND bo.rapportino_id IS NULL))
      AND (_q IS NULL OR bo.numero_bolla ILIKE '%'||_q||'%' OR f.ragione_sociale ILIKE '%'||_q||'%')
      AND (bo.commessa_id IS NULL OR public.can_access_commessa(bo.commessa_id))
  )
  SELECT count(*)::int INTO tot FROM base;

  WITH base AS (
    SELECT bo.*
    FROM public.rapportini_bolle bo
    LEFT JOIN public.fornitori f ON f.id = bo.fornitore_id
    WHERE bo.organization_id = org
      AND (_arch OR bo.archived_at IS NULL)
      AND (_forn IS NULL OR bo.fornitore_id = _forn)
      AND (_com IS NULL OR bo.commessa_id = _com)
      AND (_stato IS NULL OR bo.stato = _stato)
      AND (_coll IS NULL
           OR (_coll = 'collegata' AND bo.rapportino_id IS NOT NULL)
           OR (_coll = 'non_collegata' AND bo.rapportino_id IS NULL))
      AND (_q IS NULL OR bo.numero_bolla ILIKE '%'||_q||'%' OR f.ragione_sociale ILIKE '%'||_q||'%')
      AND (bo.commessa_id IS NULL OR public.can_access_commessa(bo.commessa_id))
    ORDER BY bo.data_bolla DESC, bo.created_at DESC
    LIMIT _size OFFSET (_page - 1) * _size
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'numero_bolla', b.numero_bolla,
    'data_bolla', b.data_bolla,
    'data_consegna', b.data_consegna,
    'stato', b.stato,
    'archived_at', b.archived_at,
    'note', b.note,
    'fornitore_id', b.fornitore_id,
    'fornitore_nome', f.ragione_sociale,
    'commessa_id', b.commessa_id,
    'commessa_codice', c.codice,
    'commessa_titolo', c.titolo,
    'cantiere_id', b.cantiere_id,
    'cantiere_nome', k.nome,
    'rapportino_id', b.rapportino_id,
    'rapportino_data', rp.data,
    'documento_id', b.documento_id,
    'righe_count', (SELECT count(*) FROM public.rapportini_bolle_righe ri WHERE ri.bolla_id = b.id),
    'imponibile', CASE WHEN econ THEN b.imponibile END,
    'iva', CASE WHEN econ THEN b.iva END,
    'totale', CASE WHEN econ THEN b.totale END
  ) ORDER BY b.data_bolla DESC, b.created_at DESC), '[]'::jsonb) INTO items
  FROM base b
  LEFT JOIN public.fornitori f ON f.id = b.fornitore_id
  LEFT JOIN public.commesse c ON c.id = b.commessa_id
  LEFT JOIN public.cantieri k ON k.id = b.cantiere_id
  LEFT JOIN public.rapportini rp ON rp.id = b.rapportino_id;

  RETURN jsonb_build_object(
    'items', items,
    'total', tot,
    'capabilities', jsonb_build_object(
      'canManage', public.can_edit_rapportino_extra(org),
      'canSeeEcon', econ
    )
  );
END $function$;