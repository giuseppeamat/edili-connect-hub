CREATE OR REPLACE FUNCTION public.get_kpi_manodopera_pendente()
RETURNS TABLE(righe integer, rapportini integer, persone integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _org UUID;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF _org IS NULL OR NOT public._rp_can_see_costs(_org) THEN
    RAISE EXCEPTION 'Non sei autorizzato a consultare i costi del personale' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT COUNT(*)::int,
         COUNT(DISTINCT rp.rapportino_id)::int,
         COUNT(DISTINCT rp.membro_id)::int
  FROM public.rapportini_personale rp
  JOIN public.rapportini r ON r.id = rp.rapportino_id
  WHERE rp.organization_id = _org
    AND rp.annullato_at IS NULL
    AND rp.ore > 0
    AND rp.stato_contabilizzazione IN ('da_contabilizzare','tariffa_mancante','conflitto_tariffa')
    AND r.archived_at IS NULL
    AND r.stato <> 'annullato';
END $function$;

REVOKE ALL ON FUNCTION public.get_kpi_manodopera_pendente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_kpi_manodopera_pendente() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_costi_manodopera(_commessa_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(
  commessa_id uuid,
  cantiere_id uuid,
  costo numeric,
  righe integer,
  rapportini integer,
  persone integer,
  gia_nel_budget boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _org UUID;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF _org IS NULL OR NOT public._rp_can_see_costs(_org) THEN
    RAISE EXCEPTION 'Non sei autorizzato a consultare i costi del personale' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT rc.commessa_id,
         rc.cantiere_id,
         COALESCE(SUM(rc.costo_totale),0)::numeric(14,2),
         COUNT(*)::int,
         COUNT(DISTINCT rc.rapportino_id)::int,
         COUNT(DISTINCT rc.membro_id)::int,
         bool_or(c.budget_modalita = 'analitico')
  FROM public.rapportini_costi rc
  JOIN public.rapportini r ON r.id = rc.rapportino_id
  JOIN public.commesse c ON c.id = rc.commessa_id
  WHERE rc.organization_id = _org
    AND rc.stato = 'contabilizzato'
    AND rc.stornato_at IS NULL
    AND r.archived_at IS NULL
    AND r.stato <> 'annullato'
    AND (_commessa_ids IS NULL OR rc.commessa_id = ANY(_commessa_ids))
  GROUP BY rc.commessa_id, rc.cantiere_id;
END $function$;

REVOKE ALL ON FUNCTION public.get_costi_manodopera(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_costi_manodopera(uuid[]) TO authenticated, service_role;