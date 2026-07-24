
-- ============================================================
-- Blocco 5.1b — RPC dedicate per commessa_fasi + REVOKE writes
-- ============================================================

-- Helper: check editability comune
CREATE OR REPLACE FUNCTION public._assert_commessa_fase_editabile(_commessa_id uuid)
RETURNS public.commesse
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.commesse;
  _uid uuid := auth.uid();
  _is_manage boolean;
  _is_resp boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.commesse WHERE id = _commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;
  IF c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa: riaprila prima di modificarne le fasi'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata: ripristinala prima di modificarne le fasi'; END IF;

  _is_manage := public.has_any_role(c.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]);
  _is_resp := public.has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]) AND c.responsabile_id = _uid;
  IF NOT (_is_manage OR _is_resp) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;
  RETURN c;
END $$;

REVOKE ALL ON FUNCTION public._assert_commessa_fase_editabile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_commessa_fase_editabile(uuid) TO authenticated;

-- ============================================================
-- CREATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_commessa_fase(
  _commessa_id uuid,
  _titolo text,
  _descrizione text DEFAULT NULL,
  _cantiere_id uuid DEFAULT NULL,
  _responsabile_id uuid DEFAULT NULL,
  _peso_percentuale numeric DEFAULT 0,
  _data_inizio_prevista date DEFAULT NULL,
  _data_fine_prevista date DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS TABLE(id uuid, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.commesse;
  _uid uuid := auth.uid();
  _cant_commessa uuid;
  _next_pos int;
  _new_id uuid;
  _new_upd timestamptz;
BEGIN
  IF _titolo IS NULL OR length(trim(_titolo)) = 0 THEN
    RAISE EXCEPTION 'Titolo obbligatorio' USING ERRCODE='22023';
  END IF;
  IF _peso_percentuale IS NULL OR _peso_percentuale < 0 OR _peso_percentuale > 100 THEN
    RAISE EXCEPTION 'Peso fuori range (0-100)' USING ERRCODE='22023';
  END IF;
  IF _data_inizio_prevista IS NOT NULL AND _data_fine_prevista IS NOT NULL
     AND _data_fine_prevista < _data_inizio_prevista THEN
    RAISE EXCEPTION 'La data di fine prevista non può essere antecedente alla data di inizio prevista' USING ERRCODE='22023';
  END IF;

  c := public._assert_commessa_fase_editabile(_commessa_id);

  IF _cantiere_id IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE id = _cantiere_id;
    IF _cant_commessa IS DISTINCT FROM _commessa_id THEN
      RAISE EXCEPTION 'Il cantiere selezionato non appartiene alla commessa' USING ERRCODE='22023';
    END IF;
  END IF;

  IF _responsabile_id IS NOT NULL THEN
    IF NOT public.is_valid_responsabile_fase(_responsabile_id, c.organization_id, _commessa_id, _cantiere_id) THEN
      RAISE EXCEPTION 'Responsabile fase non valido' USING ERRCODE='22023';
    END IF;
  END IF;

  SELECT COALESCE(MAX(posizione), -1) + 1 INTO _next_pos
  FROM public.commessa_fasi
  WHERE commessa_id = _commessa_id AND organization_id = c.organization_id;

  INSERT INTO public.commessa_fasi(
    organization_id, commessa_id, cantiere_id, titolo, descrizione,
    posizione, stato, peso_percentuale, avanzamento_percentuale,
    data_inizio_prevista, data_fine_prevista,
    responsabile_id, note, created_by
  ) VALUES (
    c.organization_id, _commessa_id, _cantiere_id, trim(_titolo), _descrizione,
    _next_pos, 'non_iniziata', _peso_percentuale, 0,
    _data_inizio_prevista, _data_fine_prevista,
    _responsabile_id, _note, _uid
  ) RETURNING commessa_fasi.id, commessa_fasi.updated_at INTO _new_id, _new_upd;

  PERFORM public._log_audit(c.organization_id, 'fase.created', 'commessa_fasi', _new_id,
    jsonb_build_object('commessa_id', _commessa_id, 'titolo', _titolo));

  PERFORM public.recalculate_commessa_avanzamento(_commessa_id);
  RETURN QUERY SELECT _new_id, _new_upd;
END $$;

REVOKE ALL ON FUNCTION public.create_commessa_fase(uuid,text,text,uuid,uuid,numeric,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_commessa_fase(uuid,text,text,uuid,uuid,numeric,date,date,text) TO authenticated;

-- ============================================================
-- UPDATE (solo dati anagrafici/pianificazione — NON stato/avanzamento/pesi via distribuzione)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_commessa_fase(
  _id uuid,
  _expected_updated_at timestamptz,
  _titolo text DEFAULT NULL,
  _descrizione text DEFAULT NULL,
  _cantiere_id uuid DEFAULT NULL,
  _clear_cantiere boolean DEFAULT false,
  _responsabile_id uuid DEFAULT NULL,
  _clear_responsabile boolean DEFAULT false,
  _peso_percentuale numeric DEFAULT NULL,
  _data_inizio_prevista date DEFAULT NULL,
  _clear_data_inizio_prevista boolean DEFAULT false,
  _data_fine_prevista date DEFAULT NULL,
  _clear_data_fine_prevista boolean DEFAULT false,
  _note text DEFAULT NULL,
  _clear_note boolean DEFAULT false
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f public.commessa_fasi;
  c public.commesse;
  _new_cantiere uuid;
  _new_resp uuid;
  _new_dip date;
  _new_dfp date;
  _new_upd timestamptz;
  _cant_commessa uuid;
BEGIN
  SELECT * INTO f FROM public.commessa_fasi WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fase non trovata' USING ERRCODE='P0002'; END IF;
  IF f.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Fase archiviata: sola lettura' USING ERRCODE='42501'; END IF;
  IF f.stato = 'annullata' THEN RAISE EXCEPTION 'Fase annullata: sola lettura' USING ERRCODE='42501'; END IF;

  c := public._assert_commessa_fase_editabile(f.commessa_id);

  IF _titolo IS NOT NULL AND length(trim(_titolo)) = 0 THEN
    RAISE EXCEPTION 'Titolo obbligatorio' USING ERRCODE='22023';
  END IF;
  IF _peso_percentuale IS NOT NULL AND (_peso_percentuale < 0 OR _peso_percentuale > 100) THEN
    RAISE EXCEPTION 'Peso fuori range (0-100)' USING ERRCODE='22023';
  END IF;

  _new_cantiere := CASE WHEN _clear_cantiere THEN NULL
                        WHEN _cantiere_id IS NOT NULL THEN _cantiere_id
                        ELSE f.cantiere_id END;
  _new_resp := CASE WHEN _clear_responsabile THEN NULL
                    WHEN _responsabile_id IS NOT NULL THEN _responsabile_id
                    ELSE f.responsabile_id END;
  _new_dip := CASE WHEN _clear_data_inizio_prevista THEN NULL
                   WHEN _data_inizio_prevista IS NOT NULL THEN _data_inizio_prevista
                   ELSE f.data_inizio_prevista END;
  _new_dfp := CASE WHEN _clear_data_fine_prevista THEN NULL
                   WHEN _data_fine_prevista IS NOT NULL THEN _data_fine_prevista
                   ELSE f.data_fine_prevista END;

  IF _new_dip IS NOT NULL AND _new_dfp IS NOT NULL AND _new_dfp < _new_dip THEN
    RAISE EXCEPTION 'La data di fine prevista non può essere antecedente alla data di inizio prevista' USING ERRCODE='22023';
  END IF;

  IF _new_cantiere IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE id = _new_cantiere;
    IF _cant_commessa IS DISTINCT FROM f.commessa_id THEN
      RAISE EXCEPTION 'Il cantiere selezionato non appartiene alla commessa' USING ERRCODE='22023';
    END IF;
  END IF;

  IF _new_resp IS NOT NULL THEN
    IF NOT public.is_valid_responsabile_fase(_new_resp, c.organization_id, f.commessa_id, _new_cantiere) THEN
      RAISE EXCEPTION 'Responsabile fase non valido' USING ERRCODE='22023';
    END IF;
  END IF;

  UPDATE public.commessa_fasi SET
    titolo = COALESCE(NULLIF(trim(COALESCE(_titolo, '')), ''), titolo),
    descrizione = CASE WHEN _descrizione IS NOT NULL THEN _descrizione ELSE descrizione END,
    cantiere_id = _new_cantiere,
    responsabile_id = _new_resp,
    peso_percentuale = COALESCE(_peso_percentuale, peso_percentuale),
    data_inizio_prevista = _new_dip,
    data_fine_prevista = _new_dfp,
    note = CASE WHEN _clear_note THEN NULL
                WHEN _note IS NOT NULL THEN _note
                ELSE note END,
    updated_at = now()
  WHERE id = _id AND updated_at = _expected_updated_at
  RETURNING updated_at INTO _new_upd;

  IF _new_upd IS NULL THEN
    RAISE EXCEPTION 'Conflitto di concorrenza: la fase è stata modificata. Ricarica e riprova.' USING ERRCODE='40001';
  END IF;

  PERFORM public._log_audit(c.organization_id, 'fase.updated', 'commessa_fasi', _id,
    jsonb_build_object('peso_changed', _peso_percentuale IS NOT NULL));

  IF _peso_percentuale IS NOT NULL THEN
    PERFORM public.recalculate_commessa_avanzamento(f.commessa_id);
  END IF;

  RETURN _new_upd;
END $$;

REVOKE ALL ON FUNCTION public.update_commessa_fase(uuid,timestamptz,text,text,uuid,boolean,uuid,boolean,numeric,date,boolean,date,boolean,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_commessa_fase(uuid,timestamptz,text,text,uuid,boolean,uuid,boolean,numeric,date,boolean,date,boolean,text,boolean) TO authenticated;

-- ============================================================
-- ARCHIVE
-- ============================================================
CREATE OR REPLACE FUNCTION public.archive_commessa_fase(
  _id uuid,
  _expected_updated_at timestamptz,
  _motivazione text DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f public.commessa_fasi;
  c public.commesse;
  _uid uuid := auth.uid();
  _new_upd timestamptz;
BEGIN
  SELECT * INTO f FROM public.commessa_fasi WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fase non trovata' USING ERRCODE='P0002'; END IF;
  IF f.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Fase già archiviata' USING ERRCODE='22023'; END IF;

  c := public._assert_commessa_fase_editabile(f.commessa_id);

  IF f.stato IN ('in_corso','completata')
     AND (_motivazione IS NULL OR length(trim(_motivazione)) = 0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per archiviare una fase in corso o completata' USING ERRCODE='22023';
  END IF;

  UPDATE public.commessa_fasi
     SET archived_at = now(), archived_by = _uid, updated_at = now()
   WHERE id = _id AND updated_at = _expected_updated_at
   RETURNING updated_at INTO _new_upd;

  IF _new_upd IS NULL THEN
    RAISE EXCEPTION 'Conflitto di concorrenza: la fase è stata modificata. Ricarica e riprova.' USING ERRCODE='40001';
  END IF;

  PERFORM public._log_audit(c.organization_id, 'fase.archived', 'commessa_fasi', _id,
    jsonb_build_object('motivazione', _motivazione, 'stato', f.stato));
  PERFORM public.recalculate_commessa_avanzamento(f.commessa_id);
  RETURN _new_upd;
END $$;

REVOKE ALL ON FUNCTION public.archive_commessa_fase(uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_commessa_fase(uuid,timestamptz,text) TO authenticated;

-- ============================================================
-- RESTORE
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_commessa_fase(
  _id uuid,
  _expected_updated_at timestamptz
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f public.commessa_fasi;
  c public.commesse;
  _new_upd timestamptz;
BEGIN
  SELECT * INTO f FROM public.commessa_fasi WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fase non trovata' USING ERRCODE='P0002'; END IF;
  IF f.archived_at IS NULL THEN RAISE EXCEPTION 'Fase non archiviata' USING ERRCODE='22023'; END IF;

  c := public._assert_commessa_fase_editabile(f.commessa_id);

  -- Il trigger tg_commessa_fasi_block_readonly consente il ripristino solo se
  -- archived_at passa da NOT NULL a NULL. Non modifichiamo stato o avanzamento.
  UPDATE public.commessa_fasi
     SET archived_at = NULL, archived_by = NULL, updated_at = now()
   WHERE id = _id AND updated_at = _expected_updated_at
   RETURNING updated_at INTO _new_upd;

  IF _new_upd IS NULL THEN
    RAISE EXCEPTION 'Conflitto di concorrenza: la fase è stata modificata. Ricarica e riprova.' USING ERRCODE='40001';
  END IF;

  PERFORM public._log_audit(c.organization_id, 'fase.restored', 'commessa_fasi', _id, '{}'::jsonb);
  PERFORM public.recalculate_commessa_avanzamento(f.commessa_id);
  RETURN _new_upd;
END $$;

REVOKE ALL ON FUNCTION public.restore_commessa_fase(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_commessa_fase(uuid,timestamptz) TO authenticated;

-- ============================================================
-- REVOKE mutazioni dirette su commessa_fasi
-- ============================================================
REVOKE INSERT, UPDATE, DELETE ON public.commessa_fasi FROM authenticated;
-- SELECT resta consentito (le policy RLS filtrano per organizzazione/accesso)
GRANT SELECT ON public.commessa_fasi TO authenticated;
-- service_role continua ad avere pieno accesso per operazioni server-side
GRANT ALL ON public.commessa_fasi TO service_role;
