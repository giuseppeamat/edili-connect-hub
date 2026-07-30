-- Funzione centrale: commessa non modificabile per il Budget
CREATE OR REPLACE FUNCTION public.is_commessa_budget_locked(_commessa_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_stato text;
  v_closed timestamptz;
  v_archived timestamptz;
  v_my_org uuid;
BEGIN
  SELECT organization_id, stato::text, closed_at, archived_at
    INTO v_org, v_stato, v_closed, v_archived
    FROM public.commesse WHERE id = _commessa_id;

  -- Record inesistente => considerato bloccato (nessun leakage)
  IF v_org IS NULL THEN RETURN true; END IF;

  -- Isolamento tenant: una commessa di un'altra organizzazione è sempre bloccata
  SELECT organization_id INTO v_my_org FROM public.profiles WHERE id = auth.uid();
  IF v_my_org IS NULL OR v_my_org <> v_org THEN RETURN true; END IF;

  RETURN v_stato IN ('completata','annullata')
      OR v_closed IS NOT NULL
      OR v_archived IS NOT NULL;
END $function$;

REVOKE ALL ON FUNCTION public.is_commessa_budget_locked(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_commessa_budget_locked(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_commessa_budget_locked(uuid) TO service_role;

-- Allineamento del gate permessi Budget
CREATE OR REPLACE FUNCTION public.can_manage_commessa_budget(_commessa_id uuid, _operation text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid UUID; v_org UUID; v_active BOOLEAN; v_resp UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT organization_id, responsabile_id INTO v_org, v_resp
    FROM public.commesse WHERE id = _commessa_id;
  IF v_org IS NULL THEN RETURN false; END IF;
  SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;
  IF COALESCE(v_active,false) = false THEN RETURN false; END IF;

  -- Stato non operativo => nessuna mutazione Budget
  IF public.is_commessa_budget_locked(_commessa_id) THEN RETURN false; END IF;

  IF public.has_any_role(v_org, ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::public.app_role[]) THEN
    RETURN true;
  END IF;
  IF public.has_any_role(v_org, ARRAY['responsabile_commessa']::public.app_role[])
     AND v_resp = v_uid THEN
    RETURN true;
  END IF;
  RETURN false;
END $function$;

-- Baseline: aggiunge il controllo di stato mancante
CREATE OR REPLACE FUNCTION public.set_commessa_baseline(_commessa_id uuid, _expected_updated_at timestamp with time zone, _motivazione text DEFAULT NULL::text, _replace boolean DEFAULT false)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_org UUID; v_upd TIMESTAMPTZ; v_has BOOLEAN;
  v_prev UUID; v_ric NUMERIC; v_cost NUMERIC; v_marg NUMERIC;
BEGIN
  SELECT organization_id, updated_at INTO v_org, v_upd FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Commessa inesistente'; END IF;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF NOT public.has_any_role(v_org, ARRAY['proprietario','amministratore']::public.app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  IF public.is_commessa_budget_locked(_commessa_id) THEN
    RAISE EXCEPTION 'La commessa non è modificabile nello stato attuale.' USING ERRCODE='42501';
  END IF;

  SELECT baseline_created_at IS NOT NULL INTO v_has FROM public.commesse WHERE id=_commessa_id;
  IF v_has AND NOT _replace THEN RAISE EXCEPTION 'Baseline già presente: richiesta sostituzione esplicita'; END IF;
  IF v_has AND _replace AND (_motivazione IS NULL OR length(btrim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per sostituzione baseline';
  END IF;

  SELECT preventivo_id,
         COALESCE(ricavi_aggiornati, ricavi_previsti),
         COALESCE(costo_aggiornato, costi_previsti),
         COALESCE(margine_aggiornato, margine_previsto)
    INTO v_prev, v_ric, v_cost, v_marg
    FROM public.commesse WHERE id=_commessa_id;

  UPDATE public.commesse SET
    baseline_preventivo_id = v_prev,
    baseline_ricavi = v_ric,
    baseline_costi = v_cost,
    baseline_margine = v_marg,
    baseline_created_at = now(),
    baseline_created_by = auth.uid(),
    updated_at = now()
  WHERE id=_commessa_id;

  PERFORM public._cbv_audit(v_org, _commessa_id,
    CASE WHEN v_has THEN 'commessa.baseline_replaced' ELSE 'commessa.baseline_created' END,
    jsonb_build_object('motivazione',_motivazione,'ricavi',v_ric,'costi',v_cost,'margine',v_marg));
  RETURN (SELECT updated_at FROM public.commesse WHERE id=_commessa_id);
END $function$;