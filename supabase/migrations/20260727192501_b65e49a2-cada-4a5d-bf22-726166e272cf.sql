
-- =========================================================================
-- Sprint 5 · Blocco 2 — Workflow rapportini
-- =========================================================================

-- 1) Colonne di transizione
ALTER TABLE public.rapportini
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_rapportini_stato ON public.rapportini(organization_id, stato)
  WHERE archived_at IS NULL;

-- =========================================================================
-- 2) update_rapportino: SOLO stato = 'bozza'
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_rapportino(
  _id uuid,
  _expected_updated_at timestamptz,
  _cantiere_id uuid DEFAULT NULL,
  _clear_cantiere boolean DEFAULT false,
  _fase_id uuid DEFAULT NULL,
  _clear_fase boolean DEFAULT false,
  _data date DEFAULT NULL,
  _ora_inizio time DEFAULT NULL,
  _clear_ora_inizio boolean DEFAULT false,
  _ora_fine time DEFAULT NULL,
  _clear_ora_fine boolean DEFAULT false,
  _pausa_minuti integer DEFAULT NULL,
  _ore numeric DEFAULT NULL,
  _descrizione_lavori text DEFAULT NULL,
  _note text DEFAULT NULL,
  _clear_note boolean DEFAULT false,
  _override_ore boolean DEFAULT false,
  _override_motivo text DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _c_closed TIMESTAMPTZ;
  _c_arch TIMESTAMPTZ;
  _is_admin BOOLEAN;
  _new_data DATE;
  _new_ore NUMERIC;
  _new_pause INTEGER;
  _new_cant UUID;
  _new_fase UUID;
  _new_ini TIME;
  _new_fin TIME;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato: ripristina prima di modificarlo' USING ERRCODE='22023';
  END IF;
  IF _row.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Solo i rapportini in bozza sono modificabili' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _is_admin := public.has_any_role(_org,
    ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[]);
  IF _row.user_id <> _me AND _row.created_by <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non sei autorizzato a modificare questo rapportino' USING ERRCODE='42501';
  END IF;

  SELECT closed_at, archived_at INTO _c_closed, _c_arch
    FROM public.commesse WHERE id = _row.commessa_id;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa' USING ERRCODE='22023'; END IF;

  _new_cant := CASE WHEN _clear_cantiere THEN NULL WHEN _cantiere_id IS NOT NULL THEN _cantiere_id ELSE _row.cantiere_id END;
  _new_fase := CASE WHEN _clear_fase     THEN NULL WHEN _fase_id     IS NOT NULL THEN _fase_id     ELSE _row.fase_id     END;
  _new_data := COALESCE(_data, _row.data);
  _new_ore  := COALESCE(_ore,  _row.ore);
  _new_pause:= COALESCE(_pausa_minuti, _row.pausa_minuti);
  _new_ini  := CASE WHEN _clear_ora_inizio THEN NULL WHEN _ora_inizio IS NOT NULL THEN _ora_inizio ELSE _row.ora_inizio END;
  _new_fin  := CASE WHEN _clear_ora_fine   THEN NULL WHEN _ora_fine   IS NOT NULL THEN _ora_fine   ELSE _row.ora_fine   END;

  IF _new_data > (CURRENT_DATE + INTERVAL '1 day')::date THEN
    RAISE EXCEPTION 'Data futura oltre la soglia consentita (max domani)' USING ERRCODE='22023';
  END IF;
  IF _new_ore IS NULL OR _new_ore <= 0 OR _new_ore > 24 THEN
    RAISE EXCEPTION 'Ore non valide (0 < ore <= 24)' USING ERRCODE='22023';
  END IF;
  IF _new_ore > 16 THEN
    IF NOT _override_ore OR NOT public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]) THEN
      RAISE EXCEPTION 'Ore oltre il limite operativo di 16 (richiesto override amministratore)' USING ERRCODE='22023';
    END IF;
    IF _override_motivo IS NULL OR btrim(_override_motivo)='' THEN
      RAISE EXCEPTION 'Motivazione override obbligatoria' USING ERRCODE='22023';
    END IF;
  END IF;
  IF _new_ini IS NOT NULL AND _new_fin IS NOT NULL AND _new_fin < _new_ini THEN
    RAISE EXCEPTION 'Ora fine antecedente all''ora inizio' USING ERRCODE='22023';
  END IF;
  IF _new_pause < 0 THEN RAISE EXCEPTION 'Pausa non valida' USING ERRCODE='22023'; END IF;

  IF _new_cant IS NOT NULL AND NOT public.can_access_cantiere(_new_cant) THEN
    RAISE EXCEPTION 'Non sei autorizzato ad accedere al cantiere' USING ERRCODE='42501';
  END IF;

  UPDATE public.rapportini SET
    cantiere_id        = _new_cant,
    fase_id            = _new_fase,
    data               = _new_data,
    ora_inizio         = _new_ini,
    ora_fine           = _new_fin,
    pausa_minuti       = _new_pause,
    ore                = _new_ore,
    descrizione_lavori = COALESCE(NULLIF(btrim(COALESCE(_descrizione_lavori, descrizione_lavori)),''), descrizione_lavori),
    lavorazione        = COALESCE(NULLIF(btrim(COALESCE(_descrizione_lavori, lavorazione)),''), lavorazione),
    note               = CASE WHEN _clear_note THEN NULL WHEN _note IS NOT NULL THEN _note ELSE note END
  WHERE id = _id;

  PERFORM public._log_audit(_org, 'rapportino.updated', 'rapportini', _id, jsonb_build_object('by', _me));
  RETURN (SELECT updated_at FROM public.rapportini WHERE id = _id);
END; $$;

-- =========================================================================
-- 3) archive_rapportino: solo bozza/respinto; annullato solo prop/admin
-- =========================================================================
CREATE OR REPLACE FUNCTION public.archive_rapportino(
  _id uuid, _expected_updated_at timestamptz, _motivazione text
)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _new_upd TIMESTAMPTZ;
  _is_prop_admin BOOLEAN;
  _is_admin_ext BOOLEAN;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino già archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;
  IF _motivazione IS NULL OR btrim(_motivazione)='' THEN
    RAISE EXCEPTION 'Motivazione obbligatoria' USING ERRCODE='22023';
  END IF;

  _is_prop_admin := public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]);
  _is_admin_ext  := public.has_any_role(_org, ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa']::app_role[]);

  IF _row.stato = 'inviato' THEN
    RAISE EXCEPTION 'Rapportino inviato: annullalo o respingilo prima di archiviarlo' USING ERRCODE='22023';
  ELSIF _row.stato = 'approvato' THEN
    RAISE EXCEPTION 'Rapportino approvato: non può essere archiviato' USING ERRCODE='22023';
  ELSIF _row.stato = 'annullato' THEN
    IF NOT _is_prop_admin THEN
      RAISE EXCEPTION 'Solo proprietario o amministratore possono archiviare un rapportino annullato' USING ERRCODE='42501';
    END IF;
  ELSE
    -- bozza | respinto: autore o ruoli autorizzati
    IF _row.user_id <> _me AND _row.created_by <> _me AND NOT _is_admin_ext THEN
      RAISE EXCEPTION 'Non sei autorizzato ad archiviare questo rapportino' USING ERRCODE='42501';
    END IF;
  END IF;

  UPDATE public.rapportini SET archived_at = now(), archived_by = _me
    WHERE id = _id RETURNING updated_at INTO _new_upd;
  PERFORM public._log_audit(_org, 'rapportino.archived', 'rapportini', _id,
    jsonb_build_object('motivazione', _motivazione, 'by', _me, 'stato_at_archive', _row.stato));
  RETURN _new_upd;
END; $$;

-- =========================================================================
-- 4) submit_rapportino
-- =========================================================================
CREATE OR REPLACE FUNCTION public.submit_rapportino(
  _id uuid, _expected_updated_at timestamptz
)
RETURNS TABLE(id uuid, stato text, updated_at timestamptz, transition_at timestamptz, transition_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _c_closed TIMESTAMPTZ;
  _c_arch TIMESTAMPTZ;
  _now TIMESTAMPTZ := now();
  _is_admin BOOLEAN;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato: ripristina prima di inviarlo' USING ERRCODE='22023';
  END IF;
  IF _row.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _is_admin := public.has_any_role(_org,
    ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[]);
  IF _row.user_id <> _me AND _row.created_by <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non sei autorizzato a inviare questo rapportino' USING ERRCODE='42501';
  END IF;

  -- validazioni minime
  IF _row.descrizione_lavori IS NULL OR btrim(_row.descrizione_lavori) = '' THEN
    RAISE EXCEPTION 'Descrizione lavori obbligatoria' USING ERRCODE='22023';
  END IF;
  IF _row.ore IS NULL OR _row.ore <= 0 OR _row.ore > 24 THEN
    RAISE EXCEPTION 'Ore non valide' USING ERRCODE='22023';
  END IF;
  IF _row.data IS NULL THEN
    RAISE EXCEPTION 'Data obbligatoria' USING ERRCODE='22023';
  END IF;
  SELECT closed_at, archived_at INTO _c_closed, _c_arch FROM public.commesse WHERE id = _row.commessa_id;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'La commessa è chiusa o archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'La commessa è chiusa o archiviata' USING ERRCODE='22023'; END IF;

  UPDATE public.rapportini SET
    stato = 'inviato',
    submitted_at = _now,
    submitted_by = _me
  WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.submitted', 'rapportini', _id, jsonb_build_object('by', _me));

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, r.submitted_at, r.submitted_by
    FROM public.rapportini r WHERE r.id = _id;
END; $$;

-- =========================================================================
-- 5) approve_rapportino
-- =========================================================================
CREATE OR REPLACE FUNCTION public.approve_rapportino(
  _id uuid, _expected_updated_at timestamptz, _note text DEFAULT NULL
)
RETURNS TABLE(id uuid, stato text, updated_at timestamptz, transition_at timestamptz, transition_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _now TIMESTAMPTZ := now();
  _is_prop_admin BOOLEAN;
  _can_approve BOOLEAN := false;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.stato = 'approvato' THEN
    RAISE EXCEPTION 'Il rapportino è già stato approvato' USING ERRCODE='22023';
  END IF;
  IF _row.stato <> 'inviato' THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _is_prop_admin := public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]);

  IF _is_prop_admin OR public.has_any_role(_org, ARRAY['ufficio_tecnico']::app_role[]) THEN
    _can_approve := true;
  ELSIF public.has_any_role(_org, ARRAY['responsabile_commessa']::app_role[]) AND public.can_access_commessa(_row.commessa_id) THEN
    _can_approve := true;
  ELSIF public.has_any_role(_org, ARRAY['capocantiere']::app_role[]) AND _row.cantiere_id IS NOT NULL AND public.is_capocantiere_di(_row.cantiere_id) THEN
    _can_approve := true;
  END IF;

  IF NOT _can_approve THEN
    RAISE EXCEPTION 'Non sei autorizzato ad approvare questo rapportino' USING ERRCODE='42501';
  END IF;

  -- separazione autore/approvatore (salvo prop/admin)
  IF NOT _is_prop_admin AND (_row.user_id = _me OR _row.created_by = _me) THEN
    RAISE EXCEPTION 'Non puoi approvare un rapportino creato da te o intestato a te stesso' USING ERRCODE='42501';
  END IF;

  UPDATE public.rapportini SET
    stato = 'approvato',
    approved_at = _now,
    approved_by = _me
  WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.approved', 'rapportini', _id,
    jsonb_build_object('by', _me, 'note', _note));

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, r.approved_at, r.approved_by
    FROM public.rapportini r WHERE r.id = _id;
END; $$;

-- =========================================================================
-- 6) reject_rapportino
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reject_rapportino(
  _id uuid, _expected_updated_at timestamptz, _reason text
)
RETURNS TABLE(id uuid, stato text, updated_at timestamptz, transition_at timestamptz, transition_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _now TIMESTAMPTZ := now();
  _is_prop_admin BOOLEAN;
  _can BOOLEAN := false;
  _reason_norm TEXT;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.stato <> 'inviato' THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _reason_norm := btrim(COALESCE(_reason, ''));
  IF length(_reason_norm) < 5 THEN
    RAISE EXCEPTION 'Inserisci una motivazione (minimo 5 caratteri)' USING ERRCODE='22023';
  END IF;
  IF length(_reason_norm) > 1000 THEN
    RAISE EXCEPTION 'Motivazione troppo lunga (massimo 1000 caratteri)' USING ERRCODE='22023';
  END IF;

  _is_prop_admin := public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]);
  IF _is_prop_admin OR public.has_any_role(_org, ARRAY['ufficio_tecnico']::app_role[]) THEN _can := true;
  ELSIF public.has_any_role(_org, ARRAY['responsabile_commessa']::app_role[]) AND public.can_access_commessa(_row.commessa_id) THEN _can := true;
  ELSIF public.has_any_role(_org, ARRAY['capocantiere']::app_role[]) AND _row.cantiere_id IS NOT NULL AND public.is_capocantiere_di(_row.cantiere_id) THEN _can := true;
  END IF;
  IF NOT _can THEN
    RAISE EXCEPTION 'Non sei autorizzato a respingere questo rapportino' USING ERRCODE='42501';
  END IF;

  UPDATE public.rapportini SET
    stato = 'respinto',
    rejected_at = _now,
    rejected_by = _me,
    rejection_reason = _reason_norm
  WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.rejected', 'rapportini', _id,
    jsonb_build_object('by', _me, 'reason', _reason_norm));

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, r.rejected_at, r.rejected_by
    FROM public.rapportini r WHERE r.id = _id;
END; $$;

-- =========================================================================
-- 7) reopen_rejected_rapportino: respinto -> bozza
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reopen_rejected_rapportino(
  _id uuid, _expected_updated_at timestamptz
)
RETURNS TABLE(id uuid, stato text, updated_at timestamptz, transition_at timestamptz, transition_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _now TIMESTAMPTZ := now();
  _is_admin BOOLEAN;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.stato <> 'respinto' THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _is_admin := public.has_any_role(_org,
    ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[]);
  IF _row.user_id <> _me AND _row.created_by <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non sei autorizzato a riaprire questo rapportino' USING ERRCODE='42501';
  END IF;

  -- Riporta a bozza ma CONSERVA rejected_at/by/reason come storico
  UPDATE public.rapportini SET stato = 'bozza' WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.reopened', 'rapportini', _id, jsonb_build_object('by', _me));

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, _now, _me
    FROM public.rapportini r WHERE r.id = _id;
END; $$;

-- =========================================================================
-- 8) cancel_rapportino
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cancel_rapportino(
  _id uuid, _expected_updated_at timestamptz, _reason text
)
RETURNS TABLE(id uuid, stato text, updated_at timestamptz, transition_at timestamptz, transition_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _now TIMESTAMPTZ := now();
  _is_prop_admin BOOLEAN;
  _reason_norm TEXT;
  _can BOOLEAN := false;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE rapportini.id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.stato = 'annullato' THEN
    RAISE EXCEPTION 'Il rapportino è già annullato' USING ERRCODE='22023';
  END IF;
  IF _row.stato NOT IN ('bozza','inviato','approvato') THEN
    RAISE EXCEPTION 'Questa operazione non è disponibile nello stato attuale del rapportino' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _reason_norm := btrim(COALESCE(_reason, ''));
  IF length(_reason_norm) < 5 THEN
    RAISE EXCEPTION 'Inserisci una motivazione (minimo 5 caratteri)' USING ERRCODE='22023';
  END IF;
  IF length(_reason_norm) > 1000 THEN
    RAISE EXCEPTION 'Motivazione troppo lunga (massimo 1000 caratteri)' USING ERRCODE='22023';
  END IF;

  _is_prop_admin := public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]);

  IF _row.stato = 'bozza' THEN
    -- autore o prop/admin
    IF _row.user_id = _me OR _row.created_by = _me OR _is_prop_admin THEN _can := true; END IF;
  ELSE
    -- inviato o approvato: solo prop/admin
    _can := _is_prop_admin;
  END IF;

  IF NOT _can THEN
    RAISE EXCEPTION 'Non sei autorizzato ad annullare questo rapportino' USING ERRCODE='42501';
  END IF;

  UPDATE public.rapportini SET
    stato = 'annullato',
    cancelled_at = _now,
    cancelled_by = _me,
    cancellation_reason = _reason_norm
  WHERE rapportini.id = _id;

  PERFORM public._log_audit(_org, 'rapportino.cancelled', 'rapportini', _id,
    jsonb_build_object('by', _me, 'reason', _reason_norm, 'stato_precedente', _row.stato));

  RETURN QUERY SELECT r.id, r.stato, r.updated_at, r.cancelled_at, r.cancelled_by
    FROM public.rapportini r WHERE r.id = _id;
END; $$;

-- =========================================================================
-- 9) GRANTS
-- =========================================================================
REVOKE ALL ON FUNCTION public.submit_rapportino(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_rapportino(uuid,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_rapportino(uuid,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_rejected_rapportino(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_rapportino(uuid,timestamptz,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_rapportino(uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_rapportino(uuid,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_rapportino(uuid,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_rejected_rapportino(uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_rapportino(uuid,timestamptz,text) TO authenticated;
