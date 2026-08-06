-- 1) Mansione nel personale del rapportino ────────────────────────────────
DROP FUNCTION IF EXISTS public.get_rapportino_personale(uuid);
CREATE OR REPLACE FUNCTION public.get_rapportino_personale(_rapportino_id uuid)
 RETURNS TABLE(id uuid, membro_id uuid, membro_nome text, membro_qualifica text, mansione text, ore numeric, nota text, stato_contabilizzazione text, errore_contabilizzazione text, tariffa_oraria_congelata numeric, costo_congelato numeric, contabilizzato_at timestamp with time zone, annullato_at timestamp with time zone, can_see_costs boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _org UUID; _econ BOOLEAN; _ok INT;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT 1 INTO _ok FROM public.rapportini r WHERE r.id = _rapportino_id AND r.organization_id = _org;
  IF _ok IS NULL THEN RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501'; END IF;
  _econ := public._rp_can_see_costs(_org);

  RETURN QUERY
  SELECT rp.id, rp.membro_id,
         TRIM(COALESCE(m.nome,'') || ' ' || COALESCE(m.cognome,'')) AS membro_nome,
         m.qualifica,
         rp.mansione,
         rp.ore, rp.nota, rp.stato_contabilizzazione, rp.errore_contabilizzazione,
         CASE WHEN _econ THEN rp.tariffa_oraria_congelata ELSE NULL END,
         CASE WHEN _econ THEN rp.costo_congelato ELSE NULL END,
         rp.contabilizzato_at, rp.annullato_at, _econ
  FROM public.rapportini_personale rp
  JOIN public.organization_members m ON m.id = rp.membro_id
  WHERE rp.rapportino_id = _rapportino_id AND rp.organization_id = _org
  ORDER BY rp.annullato_at NULLS FIRST, m.cognome, m.nome;
END $function$;

CREATE OR REPLACE FUNCTION public.save_rapportino_personale(_rapportino_id uuid, _righe jsonb, _allow_recalc boolean DEFAULT false)
 RETURNS TABLE(righe_totali integer, contabilizzate integer, tariffa_mancante integer, conflitto integer, rimosse integer, ore_totali numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid(); _org UUID; _rap public.rapportini%ROWTYPE;
  _el JSONB; _membro UUID; _ore NUMERIC; _nota TEXT; _mans TEXT;
  _m public.organization_members%ROWTYPE;
  _ex public.rapportini_personale%ROWTYPE;
  _ids UUID[] := ARRAY[]::UUID[];
  _riga RECORD; _new_id UUID; _rimosse INT := 0;
  _tot NUMERIC(8,2);
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _rap FROM public.rapportini WHERE id = _rapportino_id;
  IF NOT FOUND OR _rap.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _rap.archived_at IS NOT NULL OR _rap.stato = 'annullato' THEN
    RAISE EXCEPTION 'Rapportino non modificabile' USING ERRCODE='22023';
  END IF;
  IF NOT (public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione','responsabile_commessa','capocantiere']::public.app_role[])
          OR _rap.created_by = _me) THEN
    RAISE EXCEPTION 'Non sei autorizzato a modificare il personale del rapportino' USING ERRCODE='42501';
  END IF;

  IF _righe IS NULL OR jsonb_typeof(_righe) <> 'array' THEN
    RAISE EXCEPTION 'Righe personale non valide' USING ERRCODE='22023';
  END IF;

  FOR _el IN SELECT * FROM jsonb_array_elements(_righe) LOOP
    _membro := NULLIF(_el->>'membro_id','')::uuid;
    _ore := NULLIF(_el->>'ore','')::numeric;
    _nota := NULLIF(_el->>'nota','');
    _mans := NULLIF(btrim(COALESCE(_el->>'mansione','')),'');
    IF _membro IS NULL THEN RAISE EXCEPTION 'Persona non selezionata' USING ERRCODE='22023'; END IF;
    IF _ore IS NULL OR _ore <= 0 THEN RAISE EXCEPTION 'Ore non valide: devono essere maggiori di zero' USING ERRCODE='22023'; END IF;
    IF _ore > 24 THEN RAISE EXCEPTION 'Ore non valide: massimo 24 per persona' USING ERRCODE='22023'; END IF;
    IF _membro = ANY(_ids) THEN RAISE EXCEPTION 'La stessa persona è stata inserita due volte' USING ERRCODE='22023'; END IF;
    IF _mans IS NOT NULL AND length(_mans) > 100 THEN
      RAISE EXCEPTION 'Mansione troppo lunga (max 100 caratteri)' USING ERRCODE='22023';
    END IF;

    SELECT * INTO _m FROM public.organization_members WHERE id = _membro;
    IF NOT FOUND OR _m.organization_id <> _org THEN
      RAISE EXCEPTION 'Persona non trovata nell''organizzazione' USING ERRCODE='42501';
    END IF;
    IF _m.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Persona archiviata: non selezionabile' USING ERRCODE='22023';
    END IF;

    SELECT * INTO _ex FROM public.rapportini_personale
      WHERE rapportino_id = _rapportino_id AND membro_id = _membro AND annullato_at IS NULL
      FOR UPDATE;

    IF FOUND THEN
      IF _ex.stato_contabilizzazione = 'contabilizzato' AND _ex.ore IS DISTINCT FROM _ore THEN
        IF NOT _allow_recalc THEN
          RAISE EXCEPTION 'Ore già contabilizzate: serve un ricalcolo controllato per modificarle' USING ERRCODE='22023';
        END IF;
        PERFORM public._storna_riga_personale(_ex.id, 'Ricalcolo controllato ore', false);
        UPDATE public.rapportini_personale SET
          ore = _ore, nota = _nota, mansione = _mans, updated_by = _me,
          stato_contabilizzazione = 'da_contabilizzare',
          tariffa_id = NULL, tariffa_oraria_congelata = NULL, costo_congelato = NULL,
          contabilizzato_at = NULL, errore_contabilizzazione = NULL
          WHERE id = _ex.id;
        PERFORM public._log_audit(_org, 'ore_personale_modificate', 'rapportini_personale', _ex.id,
          jsonb_build_object('rapportino_id', _rapportino_id, 'ore_prima', _ex.ore, 'ore_dopo', _ore));
      ELSE
        UPDATE public.rapportini_personale SET ore = _ore, nota = _nota, mansione = _mans, updated_by = _me
          WHERE id = _ex.id;
      END IF;
      _new_id := _ex.id;
    ELSE
      INSERT INTO public.rapportini_personale (
        organization_id, rapportino_id, membro_id, ore, nota, mansione, created_by, updated_by
      ) VALUES (_org, _rapportino_id, _membro, _ore, _nota, _mans, _me, _me)
      RETURNING id INTO _new_id;
      PERFORM public._log_audit(_org, 'personale_aggiunto_rapportino', 'rapportini_personale', _new_id,
        jsonb_build_object('rapportino_id', _rapportino_id, 'membro_id', _membro, 'ore', _ore));
    END IF;

    _ids := array_append(_ids, _membro);
  END LOOP;

  FOR _riga IN
    SELECT id FROM public.rapportini_personale
    WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL
      AND NOT (membro_id = ANY(_ids))
  LOOP
    PERFORM public._storna_riga_personale(_riga.id, 'Persona rimossa dal rapportino', true);
    _rimosse := _rimosse + 1;
  END LOOP;

  FOR _riga IN
    SELECT id FROM public.rapportini_personale
    WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL
      AND stato_contabilizzazione <> 'contabilizzato'
  LOOP
    PERFORM public._contabilizza_riga_personale(_riga.id);
  END LOOP;

  SELECT COALESCE(SUM(ore),0)::numeric(8,2) INTO _tot FROM public.rapportini_personale
    WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL;
  IF _tot > 0 THEN
    UPDATE public.rapportini SET ore = _tot WHERE id = _rapportino_id;
  END IF;

  RETURN QUERY
  SELECT COUNT(*)::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'contabilizzato')::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'tariffa_mancante')::int,
         COUNT(*) FILTER (WHERE stato_contabilizzazione = 'conflitto_tariffa')::int,
         _rimosse,
         COALESCE(SUM(ore),0)::numeric
  FROM public.rapportini_personale
  WHERE rapportino_id = _rapportino_id AND annullato_at IS NULL;
END $function$;

-- 2) Costi extra per periodo (dashboard) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_costi_extra_periodo(_from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _org uuid; ma numeric := 0; su numeric := 0; nb int := 0; ns int := 0;
BEGIN
  _org := public.current_organization_id();
  IF _org IS NULL THEN RETURN jsonb_build_object('visibile', false); END IF;
  IF NOT public.can_see_econ(_org) THEN RETURN jsonb_build_object('visibile', false); END IF;

  SELECT COALESCE(SUM(b.imponibile),0), COUNT(*) INTO ma, nb
  FROM public.rapportini_bolle b
  JOIN public.rapportini r ON r.id = b.rapportino_id
  WHERE b.organization_id = _org AND b.stato <> 'annullata'
    AND r.archived_at IS NULL AND r.data BETWEEN _from AND _to;

  SELECT COALESCE(SUM(s.importo_congelato),0), COUNT(*) INTO su, ns
  FROM public.rapportini_subappaltatori s
  JOIN public.rapportini r ON r.id = s.rapportino_id
  WHERE s.organization_id = _org AND s.annullato_at IS NULL
    AND r.archived_at IS NULL AND r.data BETWEEN _from AND _to;

  RETURN jsonb_build_object(
    'visibile', true,
    'materiali', round(ma, 2), 'subappalti', round(su, 2),
    'totale', round(ma + su, 2), 'bolle', nb, 'righe_subappalto', ns);
END $function$;

REVOKE ALL ON FUNCTION public.get_costi_extra_periodo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_costi_extra_periodo(date, date) TO authenticated;

-- 3) Costi extra per cantiere ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cantiere_costi_extra(_cantiere_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE org uuid; ma numeric := 0; su numeric := 0; mo numeric := 0;
BEGIN
  SELECT organization_id INTO org FROM public.cantieri WHERE id = _cantiere_id;
  IF org IS NULL OR org <> public.current_organization_id() THEN
    RAISE EXCEPTION 'Cantiere non trovato';
  END IF;
  IF NOT public.can_access_cantiere(_cantiere_id) THEN
    RAISE EXCEPTION 'Accesso negato al cantiere';
  END IF;
  IF NOT public.can_see_econ(org) THEN RETURN jsonb_build_object('visibile', false); END IF;

  SELECT COALESCE(SUM(imponibile),0) INTO ma FROM public.rapportini_bolle
    WHERE cantiere_id = _cantiere_id AND stato <> 'annullata';
  SELECT COALESCE(SUM(importo_congelato),0) INTO su FROM public.rapportini_subappaltatori
    WHERE cantiere_id = _cantiere_id AND annullato_at IS NULL;
  SELECT COALESCE(SUM(costo_totale),0) INTO mo FROM public.rapportini_costi
    WHERE cantiere_id = _cantiere_id AND stato = 'contabilizzato';

  RETURN jsonb_build_object('visibile', true, 'materiali', round(ma,2),
    'subappalti', round(su,2), 'manodopera', round(mo,2),
    'totale', round(ma + su + mo, 2));
END $function$;

REVOKE ALL ON FUNCTION public.get_cantiere_costi_extra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cantiere_costi_extra(uuid) TO authenticated;

-- 4) Riepilogo commessa: manodopera + dettaglio per cantiere ───────────────
CREATE OR REPLACE FUNCTION public.get_commessa_costi_extra(_commessa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE org uuid; ma numeric := 0; su numeric := 0; mo numeric := 0; per_cant jsonb;
BEGIN
  SELECT organization_id INTO org FROM public.commesse WHERE id = _commessa_id;
  IF org IS NULL OR org <> public.current_organization_id() THEN RAISE EXCEPTION 'Commessa non trovata'; END IF;
  IF NOT public.can_access_commessa(_commessa_id) THEN RAISE EXCEPTION 'Accesso negato alla commessa'; END IF;
  IF NOT public.can_see_econ(org) THEN RETURN jsonb_build_object('visibile', false); END IF;

  SELECT COALESCE(SUM(imponibile),0) INTO ma FROM public.rapportini_bolle
    WHERE commessa_id = _commessa_id AND stato <> 'annullata';
  SELECT COALESCE(SUM(importo_congelato),0) INTO su FROM public.rapportini_subappaltatori
    WHERE commessa_id = _commessa_id AND annullato_at IS NULL;
  SELECT COALESCE(SUM(costo_totale),0) INTO mo FROM public.rapportini_costi
    WHERE commessa_id = _commessa_id AND stato = 'contabilizzato';

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'cantiere'), '[]'::jsonb) INTO per_cant
  FROM (
    SELECT jsonb_build_object(
             'cantiere_id', t.cantiere_id,
             'cantiere', COALESCE(k.nome, 'Senza cantiere'),
             'materiali', round(SUM(t.ma),2),
             'subappalti', round(SUM(t.su),2),
             'manodopera', round(SUM(t.mo),2),
             'totale', round(SUM(t.ma + t.su + t.mo),2)) AS x
    FROM (
      SELECT cantiere_id, SUM(imponibile) AS ma, 0::numeric AS su, 0::numeric AS mo
        FROM public.rapportini_bolle
        WHERE commessa_id = _commessa_id AND stato <> 'annullata' GROUP BY cantiere_id
      UNION ALL
      SELECT cantiere_id, 0, SUM(importo_congelato), 0
        FROM public.rapportini_subappaltatori
        WHERE commessa_id = _commessa_id AND annullato_at IS NULL GROUP BY cantiere_id
      UNION ALL
      SELECT cantiere_id, 0, 0, SUM(costo_totale)
        FROM public.rapportini_costi
        WHERE commessa_id = _commessa_id AND stato = 'contabilizzato' GROUP BY cantiere_id
    ) t
    LEFT JOIN public.cantieri k ON k.id = t.cantiere_id
    GROUP BY t.cantiere_id, k.nome
  ) agg;

  RETURN jsonb_build_object('visibile', true, 'materiali', round(ma,2),
    'subappalti', round(su,2), 'manodopera', round(mo,2),
    'totale', round(ma + su + mo, 2), 'per_cantiere', per_cant);
END $function$;