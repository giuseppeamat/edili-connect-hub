-- =========================================================
-- BLOCCO 5.1a — DB HARDENING + RPC per commessa_fasi
-- =========================================================

-- ---------- A. RLS: rimuove capocantiere dagli UPDATE diretti ----------
DROP POLICY IF EXISTS "commessa_fasi_upd" ON public.commessa_fasi;
CREATE POLICY "commessa_fasi_upd" ON public.commessa_fasi
  FOR UPDATE TO authenticated
  USING (
    has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (SELECT 1 FROM commesse c WHERE c.id = commessa_fasi.commessa_id AND c.responsabile_id = auth.uid())
    )
  )
  WITH CHECK (
    has_any_role(organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
    OR (
      has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND EXISTS (SELECT 1 FROM commesse c WHERE c.id = commessa_fasi.commessa_id AND c.responsabile_id = auth.uid())
    )
  );

-- Il capocantiere aggiorna l'avanzamento SOLO tramite RPC SECURITY DEFINER (sotto).

-- ---------- B. VALIDATORE RESPONSABILE FASE ----------
CREATE OR REPLACE FUNCTION public.is_valid_responsabile_fase(
  _user uuid, _org uuid, _commessa_id uuid, _cantiere_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _is_manage boolean;
  _ok_role boolean;
  _assigned boolean;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user
      AND p.organization_id = _org
      AND COALESCE(p.is_active, true) = true
  ) THEN
    RETURN false;
  END IF;

  -- Ruoli mai ammessi come responsabile fase
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user AND ur.organization_id = _org
      AND ur.role IN ('cliente','fornitore','operaio')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user AND ur.organization_id = _org
      AND ur.role IN ('proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere')
  ) THEN
    RETURN false;
  END IF;

  -- Ruolo compatibile
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user AND ur.organization_id = _org
      AND ur.role IN ('proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere')
  ) INTO _ok_role;
  IF NOT _ok_role THEN RETURN false; END IF;

  -- Proprietario/amm/tecnico bypassano il check di assegnazione
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user AND ur.organization_id = _org
      AND ur.role IN ('proprietario','amministratore','ufficio_tecnico')
  ) INTO _is_manage;
  IF _is_manage THEN RETURN true; END IF;

  -- Deve essere responsabile della commessa, capocantiere del cantiere, o membro
  SELECT
    EXISTS (SELECT 1 FROM public.commesse c WHERE c.id = _commessa_id AND c.responsabile_id = _user)
    OR (_cantiere_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.cantieri k WHERE k.id = _cantiere_id AND k.capocantiere_id = _user
    ))
    OR EXISTS (
      SELECT 1 FROM public.commessa_membri m
      WHERE m.user_id = _user AND m.is_active = true AND m.archived_at IS NULL
        AND (m.commessa_id = _commessa_id
             OR (_cantiere_id IS NOT NULL AND m.cantiere_id = _cantiere_id))
    )
  INTO _assigned;

  RETURN _assigned;
END $$;

REVOKE ALL ON FUNCTION public.is_valid_responsabile_fase(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_responsabile_fase(uuid,uuid,uuid,uuid) TO authenticated;

-- ---------- C. HELPER AUDIT ----------
CREATE OR REPLACE FUNCTION public._log_audit(
  _org uuid, _action text, _entity text, _entity_id uuid, _meta jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.audit_log(organization_id, user_id, action, entity, entity_id, metadata)
  VALUES (_org, auth.uid(), _action, _entity, _entity_id, COALESCE(_meta, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public._log_audit(uuid,text,text,uuid,jsonb) FROM PUBLIC;

-- ---------- D. RPC: CAMBIO STATO FASE ----------
CREATE OR REPLACE FUNCTION public.change_fase_stato(
  _fase_id uuid,
  _nuovo_stato text,
  _expected_updated_at timestamptz,
  _motivazione text DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  f RECORD; c RECORD;
  _uid uuid := auth.uid();
  _is_manage boolean; _is_resp boolean;
  _ok boolean := false; _cur text; _new text := _nuovo_stato;
  _today date := CURRENT_DATE;
  _new_updated timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;

  SELECT * INTO f FROM public.commessa_fasi WHERE id = _fase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fase non trovata' USING ERRCODE='P0002'; END IF;

  SELECT * INTO c FROM public.commesse WHERE id = f.commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;

  IF c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa: riaprila prima di modificare le fasi'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata: ripristinala prima di modificare le fasi'; END IF;
  IF f.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Fase archiviata: sola lettura'; END IF;
  IF f.stato = 'annullata' THEN RAISE EXCEPTION 'Fase annullata: sola lettura'; END IF;

  _is_manage := has_any_role(c.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]);
  _is_resp := has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]) AND c.responsabile_id = _uid;
  IF NOT (_is_manage OR _is_resp) THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;

  _cur := f.stato;
  IF _cur = _new THEN RETURN f.updated_at; END IF;

  _ok := CASE
    WHEN _cur='non_iniziata' AND _new IN ('in_corso','sospesa','annullata') THEN true
    WHEN _cur='in_corso'     AND _new IN ('sospesa','completata','annullata') THEN true
    WHEN _cur='sospesa'      AND _new IN ('in_corso','annullata') THEN true
    WHEN _cur='completata'   AND _new = 'in_corso' THEN true
    ELSE false
  END;
  IF NOT _ok THEN RAISE EXCEPTION 'Transizione stato non consentita: % -> %', _cur, _new USING ERRCODE='22023'; END IF;

  IF _new = 'annullata' AND (_motivazione IS NULL OR length(trim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per annullare la fase' USING ERRCODE='22023';
  END IF;
  IF _cur = 'completata' AND _new = 'in_corso' AND (_motivazione IS NULL OR length(trim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per riaprire una fase completata' USING ERRCODE='22023';
  END IF;

  UPDATE public.commessa_fasi SET
    stato = _new,
    avanzamento_percentuale = CASE WHEN _new='completata' THEN 100
                                   WHEN _new='in_corso' AND _cur='completata' THEN LEAST(avanzamento_percentuale,99)
                                   ELSE avanzamento_percentuale END,
    data_inizio_effettiva = CASE WHEN _new='in_corso' AND data_inizio_effettiva IS NULL THEN _today ELSE data_inizio_effettiva END,
    data_fine_effettiva = CASE WHEN _new='completata' AND data_fine_effettiva IS NULL THEN _today
                               WHEN _new='in_corso' AND _cur='completata' THEN NULL
                               ELSE data_fine_effettiva END,
    updated_at = now()
  WHERE id = _fase_id AND updated_at = _expected_updated_at
  RETURNING updated_at INTO _new_updated;

  IF _new_updated IS NULL THEN
    RAISE EXCEPTION 'Conflitto di concorrenza: la fase è stata modificata da un altro utente. Ricarica e riprova.' USING ERRCODE='40001';
  END IF;

  PERFORM public._log_audit(c.organization_id, 'fase.state_changed', 'commessa_fasi', _fase_id,
    jsonb_build_object('from', _cur, 'to', _new, 'motivazione', _motivazione));

  RETURN _new_updated;
END $$;

REVOKE ALL ON FUNCTION public.change_fase_stato(uuid,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_fase_stato(uuid,text,timestamptz,text) TO authenticated;

-- ---------- E. RPC: AVANZAMENTO FASE ----------
CREATE OR REPLACE FUNCTION public.update_fase_avanzamento(
  _fase_id uuid,
  _nuovo_avanzamento numeric,
  _expected_updated_at timestamptz,
  _motivazione text DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  f RECORD; c RECORD;
  _uid uuid := auth.uid();
  _is_manage boolean; _is_resp boolean; _is_capo boolean := false;
  _today date := CURRENT_DATE;
  _new_updated timestamptz;
  _new_stato text;
  _new_dfe date;
  _new_die date;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  IF _nuovo_avanzamento < 0 OR _nuovo_avanzamento > 100 THEN
    RAISE EXCEPTION 'Avanzamento fuori range (0-100)' USING ERRCODE='22023';
  END IF;

  SELECT * INTO f FROM public.commessa_fasi WHERE id = _fase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fase non trovata' USING ERRCODE='P0002'; END IF;
  SELECT * INTO c FROM public.commesse WHERE id = f.commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;

  IF c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata'; END IF;
  IF f.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Fase archiviata: sola lettura'; END IF;
  IF f.stato = 'annullata' THEN RAISE EXCEPTION 'Fase annullata: sola lettura'; END IF;

  _is_manage := has_any_role(c.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]);
  _is_resp := has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]) AND c.responsabile_id = _uid;
  IF NOT _is_manage AND NOT _is_resp AND f.cantiere_id IS NOT NULL
     AND has_any_role(c.organization_id, ARRAY['capocantiere']::app_role[]) THEN
    _is_capo := is_capocantiere_di(f.cantiere_id);
  END IF;
  IF NOT (_is_manage OR _is_resp OR _is_capo) THEN
    RAISE EXCEPTION 'Non autorizzato ad aggiornare l''avanzamento' USING ERRCODE='42501';
  END IF;

  IF _nuovo_avanzamento < f.avanzamento_percentuale
     AND (_motivazione IS NULL OR length(trim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per ridurre l''avanzamento' USING ERRCODE='22023';
  END IF;

  -- Stato risultante
  IF _nuovo_avanzamento = 100 THEN
    _new_stato := 'completata';
    _new_dfe := COALESCE(f.data_fine_effettiva, _today);
    _new_die := COALESCE(f.data_inizio_effettiva, _today);
  ELSIF _nuovo_avanzamento = 0 THEN
    -- 0 non riapre automaticamente una fase completata
    _new_stato := CASE WHEN f.stato = 'completata' THEN f.stato ELSE f.stato END;
    _new_dfe := f.data_fine_effettiva;
    _new_die := f.data_inizio_effettiva;
  ELSE
    _new_stato := CASE WHEN f.stato IN ('sospesa','completata') THEN f.stato ELSE 'in_corso' END;
    _new_die := COALESCE(f.data_inizio_effettiva, CASE WHEN _new_stato='in_corso' THEN _today ELSE NULL END);
    _new_dfe := f.data_fine_effettiva;
  END IF;

  UPDATE public.commessa_fasi SET
    avanzamento_percentuale = _nuovo_avanzamento,
    stato = _new_stato,
    data_inizio_effettiva = _new_die,
    data_fine_effettiva = _new_dfe,
    updated_at = now()
  WHERE id = _fase_id AND updated_at = _expected_updated_at
  RETURNING updated_at INTO _new_updated;

  IF _new_updated IS NULL THEN
    RAISE EXCEPTION 'Conflitto di concorrenza: la fase è stata modificata. Ricarica e riprova.' USING ERRCODE='40001';
  END IF;

  PERFORM public._log_audit(c.organization_id, 'fase.progress_updated', 'commessa_fasi', _fase_id,
    jsonb_build_object('from', f.avanzamento_percentuale, 'to', _nuovo_avanzamento,
                       'stato', _new_stato, 'motivazione', _motivazione));
  RETURN _new_updated;
END $$;

REVOKE ALL ON FUNCTION public.update_fase_avanzamento(uuid,numeric,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_fase_avanzamento(uuid,numeric,timestamptz,text) TO authenticated;

-- ---------- F. RPC: AVANZAMENTO MANUALE COMMESSA ----------
CREATE OR REPLACE FUNCTION public.update_manual_commessa_progress(
  _commessa_id uuid,
  _nuovo_avanzamento numeric,
  _expected_updated_at timestamptz,
  _motivazione text DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c RECORD;
  _uid uuid := auth.uid();
  _is_manage boolean; _is_resp boolean;
  _new_updated timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  IF _nuovo_avanzamento < 0 OR _nuovo_avanzamento > 100 THEN
    RAISE EXCEPTION 'Avanzamento fuori range (0-100)' USING ERRCODE='22023';
  END IF;

  SELECT * INTO c FROM public.commesse WHERE id = _commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;

  IF c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata'; END IF;
  IF COALESCE(c.avanzamento_modalita,'manuale') <> 'manuale' THEN
    RAISE EXCEPTION 'Modalità avanzamento non manuale: usare le fasi' USING ERRCODE='22023';
  END IF;

  _is_manage := has_any_role(c.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]);
  _is_resp := has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]) AND c.responsabile_id = _uid;
  IF NOT (_is_manage OR _is_resp) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  IF _nuovo_avanzamento < COALESCE(c.avanzamento_pct,0)
     AND (_motivazione IS NULL OR length(trim(_motivazione))=0) THEN
    RAISE EXCEPTION 'Motivazione obbligatoria per ridurre l''avanzamento' USING ERRCODE='22023';
  END IF;

  UPDATE public.commesse SET
    avanzamento_pct = _nuovo_avanzamento,
    avanzamento_calcolato_at = now(),
    updated_at = now()
  WHERE id = _commessa_id AND updated_at = _expected_updated_at
  RETURNING updated_at INTO _new_updated;

  IF _new_updated IS NULL THEN
    RAISE EXCEPTION 'Conflitto di concorrenza: la commessa è stata modificata. Ricarica e riprova.' USING ERRCODE='40001';
  END IF;

  PERFORM public._log_audit(c.organization_id, 'commessa.manual_progress_updated', 'commesse', _commessa_id,
    jsonb_build_object('from', c.avanzamento_pct, 'to', _nuovo_avanzamento, 'motivazione', _motivazione));

  RETURN _new_updated;
END $$;

REVOKE ALL ON FUNCTION public.update_manual_commessa_progress(uuid,numeric,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_manual_commessa_progress(uuid,numeric,timestamptz,text) TO authenticated;

-- ---------- G. RPC: CAMBIO MODALITÀ ----------
CREATE OR REPLACE FUNCTION public.set_commessa_progress_mode(
  _commessa_id uuid,
  _modalita text,
  _expected_updated_at timestamptz,
  _motivazione text DEFAULT NULL,
  _conferma_peso_zero boolean DEFAULT false
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c RECORD;
  _uid uuid := auth.uid();
  _is_manage boolean;
  _new_updated timestamptz;
  _fasi_valide int;
  _peso_tot numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  IF _modalita NOT IN ('manuale','fasi') THEN
    RAISE EXCEPTION 'Modalità non valida' USING ERRCODE='22023';
  END IF;

  SELECT * INTO c FROM public.commesse WHERE id = _commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;
  IF c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata'; END IF;

  _is_manage := has_any_role(c.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[])
             OR (has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]) AND c.responsabile_id = _uid);
  IF NOT _is_manage THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;

  IF _modalita = 'fasi' THEN
    SELECT COUNT(*), COALESCE(SUM(peso_percentuale),0)
      INTO _fasi_valide, _peso_tot
      FROM public.commessa_fasi
      WHERE commessa_id = _commessa_id AND archived_at IS NULL AND stato <> 'annullata';
    IF _fasi_valide = 0 THEN
      RAISE EXCEPTION 'Nessuna fase valida presente: impossibile passare a modalità fasi' USING ERRCODE='22023';
    END IF;
    IF _peso_tot = 0 AND NOT _conferma_peso_zero THEN
      RAISE EXCEPTION 'Peso totale fasi = 0: conferma esplicita richiesta' USING ERRCODE='22023';
    END IF;
  ELSE
    IF _motivazione IS NULL OR length(trim(_motivazione))=0 THEN
      RAISE EXCEPTION 'Motivazione obbligatoria per passare a modalità manuale' USING ERRCODE='22023';
    END IF;
  END IF;

  UPDATE public.commesse SET
    avanzamento_modalita = _modalita,
    updated_at = now()
  WHERE id = _commessa_id AND updated_at = _expected_updated_at
  RETURNING updated_at INTO _new_updated;

  IF _new_updated IS NULL THEN
    RAISE EXCEPTION 'Conflitto di concorrenza. Ricarica e riprova.' USING ERRCODE='40001';
  END IF;

  IF _modalita = 'fasi' AND _peso_tot > 0 THEN
    PERFORM public.recalculate_commessa_avanzamento(_commessa_id);
  END IF;

  PERFORM public._log_audit(c.organization_id, 'commessa.progress_mode_changed', 'commesse', _commessa_id,
    jsonb_build_object('from', c.avanzamento_modalita, 'to', _modalita, 'motivazione', _motivazione));

  RETURN _new_updated;
END $$;

REVOKE ALL ON FUNCTION public.set_commessa_progress_mode(uuid,text,timestamptz,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_commessa_progress_mode(uuid,text,timestamptz,text,boolean) TO authenticated;

-- ---------- H. RPC: RIORDINO TRANSAZIONALE ----------
CREATE OR REPLACE FUNCTION public.reorder_commessa_fasi(
  _commessa_id uuid,
  _ordered_ids uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c RECORD;
  _uid uuid := auth.uid();
  _is_manage boolean; _is_resp boolean;
  _valid_count int; _input_count int := array_length(_ordered_ids, 1);
  _dup_count int;
  i int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  IF _input_count IS NULL OR _input_count = 0 THEN RETURN; END IF;

  SELECT * INTO c FROM public.commesse WHERE id = _commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;
  IF c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata'; END IF;

  _is_manage := has_any_role(c.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]);
  _is_resp := has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]) AND c.responsabile_id = _uid;
  IF NOT (_is_manage OR _is_resp) THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;

  SELECT COUNT(DISTINCT x) INTO _dup_count FROM unnest(_ordered_ids) x;
  IF _dup_count <> _input_count THEN
    RAISE EXCEPTION 'ID duplicati nel riordino' USING ERRCODE='22023';
  END IF;

  SELECT COUNT(*) INTO _valid_count
    FROM public.commessa_fasi
   WHERE id = ANY(_ordered_ids)
     AND commessa_id = _commessa_id
     AND organization_id = c.organization_id
     AND archived_at IS NULL
     AND stato <> 'annullata';
  IF _valid_count <> _input_count THEN
    RAISE EXCEPTION 'Elenco fasi non valido: alcune non appartengono alla commessa o sono archiviate/annullate' USING ERRCODE='22023';
  END IF;

  FOR i IN 1.._input_count LOOP
    UPDATE public.commessa_fasi
      SET posizione = i - 1, updated_at = now()
      WHERE id = _ordered_ids[i]
        AND commessa_id = _commessa_id
        AND organization_id = c.organization_id;
  END LOOP;

  PERFORM public._log_audit(c.organization_id, 'commessa.fasi_reordered', 'commesse', _commessa_id,
    jsonb_build_object('count', _input_count));
END $$;

REVOKE ALL ON FUNCTION public.reorder_commessa_fasi(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_commessa_fasi(uuid,uuid[]) TO authenticated;

-- ---------- I. RPC: DISTRIBUZIONE PESI ----------
CREATE OR REPLACE FUNCTION public.distribuisci_pesi_equamente(
  _commessa_id uuid
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c RECORD;
  _uid uuid := auth.uid();
  _is_manage boolean; _is_resp boolean;
  _ids uuid[]; _n int; _base numeric(6,2); _rem numeric(6,2); _last_extra numeric(6,2);
  i int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.commesse WHERE id = _commessa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='P0002'; END IF;
  IF c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata'; END IF;

  _is_manage := has_any_role(c.organization_id, ARRAY['proprietario','amministratore','ufficio_tecnico']::app_role[]);
  _is_resp := has_any_role(c.organization_id, ARRAY['responsabile_commessa']::app_role[]) AND c.responsabile_id = _uid;
  IF NOT (_is_manage OR _is_resp) THEN RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501'; END IF;

  SELECT array_agg(id ORDER BY posizione, created_at) INTO _ids
    FROM public.commessa_fasi
   WHERE commessa_id = _commessa_id AND organization_id = c.organization_id
     AND archived_at IS NULL AND stato <> 'annullata';

  _n := COALESCE(array_length(_ids,1), 0);
  IF _n = 0 THEN RETURN 0; END IF;

  _base := ROUND(100::numeric / _n, 2);
  _rem  := 100::numeric - (_base * _n);
  -- residuo deterministico: aggiunto all'ultima fase
  _last_extra := _base + _rem;

  FOR i IN 1.._n LOOP
    UPDATE public.commessa_fasi
      SET peso_percentuale = CASE WHEN i = _n THEN _last_extra ELSE _base END,
          updated_at = now()
      WHERE id = _ids[i] AND organization_id = c.organization_id;
  END LOOP;

  PERFORM public._log_audit(c.organization_id, 'fase.weights_distributed', 'commesse', _commessa_id,
    jsonb_build_object('count', _n, 'peso_base', _base, 'peso_ultimo', _last_extra));

  RETURN _base;
END $$;

REVOKE ALL ON FUNCTION public.distribuisci_pesi_equamente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.distribuisci_pesi_equamente(uuid) TO authenticated;

-- ---------- J. VIEW: RITARDI SERVER-SIDE ----------
CREATE OR REPLACE VIEW public.commessa_fasi_ritardi AS
SELECT
  f.id AS fase_id,
  f.commessa_id,
  f.organization_id,
  CASE
    WHEN f.stato IN ('completata','annullata') OR f.archived_at IS NOT NULL THEN false
    WHEN f.stato = 'non_iniziata' AND f.data_inizio_prevista IS NOT NULL AND f.data_inizio_prevista < CURRENT_DATE THEN true
    WHEN f.stato IN ('in_corso','sospesa') AND f.data_fine_prevista IS NOT NULL AND f.data_fine_prevista < CURRENT_DATE THEN true
    ELSE false
  END AS is_late,
  CASE
    WHEN f.stato IN ('completata','annullata') OR f.archived_at IS NOT NULL THEN NULL
    WHEN f.stato = 'non_iniziata' AND f.data_inizio_prevista IS NOT NULL AND f.data_inizio_prevista < CURRENT_DATE THEN 'start_delay'
    WHEN f.stato IN ('in_corso','sospesa') AND f.data_fine_prevista IS NOT NULL AND f.data_fine_prevista < CURRENT_DATE THEN 'execution_delay'
    ELSE NULL
  END AS late_type,
  CASE
    WHEN f.stato IN ('completata','annullata') OR f.archived_at IS NOT NULL THEN 0
    WHEN f.stato = 'non_iniziata' AND f.data_inizio_prevista IS NOT NULL AND f.data_inizio_prevista < CURRENT_DATE
      THEN (CURRENT_DATE - f.data_inizio_prevista)
    WHEN f.stato IN ('in_corso','sospesa') AND f.data_fine_prevista IS NOT NULL AND f.data_fine_prevista < CURRENT_DATE
      THEN (CURRENT_DATE - f.data_fine_prevista)
    ELSE 0
  END AS days_late
FROM public.commessa_fasi f;

GRANT SELECT ON public.commessa_fasi_ritardi TO authenticated;

-- ---------- K. TRIGGER: blocca modifiche a fasi annullate/archiviate ----------
CREATE OR REPLACE FUNCTION public.tg_commessa_fasi_block_readonly()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Eccezione: ripristino da archived_at -> NULL è consentito (unica modifica ammessa)
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fase archiviata: sola lettura' USING ERRCODE='42501';
  END IF;
  IF OLD.stato = 'annullata' AND NEW.stato = 'annullata' THEN
    -- Ammesso solo archiviazione (archived_at da NULL a valore) su annullata
    IF (OLD.titolo IS DISTINCT FROM NEW.titolo)
       OR (OLD.descrizione IS DISTINCT FROM NEW.descrizione)
       OR (OLD.peso_percentuale IS DISTINCT FROM NEW.peso_percentuale)
       OR (OLD.avanzamento_percentuale IS DISTINCT FROM NEW.avanzamento_percentuale)
       OR (OLD.responsabile_id IS DISTINCT FROM NEW.responsabile_id)
       OR (OLD.cantiere_id IS DISTINCT FROM NEW.cantiere_id)
       OR (OLD.posizione IS DISTINCT FROM NEW.posizione)
       OR (OLD.data_inizio_prevista IS DISTINCT FROM NEW.data_inizio_prevista)
       OR (OLD.data_fine_prevista IS DISTINCT FROM NEW.data_fine_prevista)
       OR (OLD.data_inizio_effettiva IS DISTINCT FROM NEW.data_inizio_effettiva)
       OR (OLD.data_fine_effettiva IS DISTINCT FROM NEW.data_fine_effettiva)
    THEN
      RAISE EXCEPTION 'Fase annullata: sola lettura' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_commessa_fasi_block_readonly ON public.commessa_fasi;
CREATE TRIGGER tg_commessa_fasi_block_readonly
  BEFORE UPDATE ON public.commessa_fasi
  FOR EACH ROW EXECUTE FUNCTION public.tg_commessa_fasi_block_readonly();

-- ---------- L. TRIGGER: valida responsabile fase ----------
CREATE OR REPLACE FUNCTION public.tg_commessa_fasi_validate_responsabile()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.responsabile_id IS NOT NULL THEN
    IF NOT public.is_valid_responsabile_fase(
      NEW.responsabile_id, NEW.organization_id, NEW.commessa_id, NEW.cantiere_id
    ) THEN
      RAISE EXCEPTION 'Responsabile fase non valido: deve essere un utente attivo dell''organizzazione con ruolo compatibile e assegnato alla commessa/cantiere' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_commessa_fasi_validate_responsabile ON public.commessa_fasi;
CREATE TRIGGER tg_commessa_fasi_validate_responsabile
  BEFORE INSERT OR UPDATE OF responsabile_id ON public.commessa_fasi
  FOR EACH ROW EXECUTE FUNCTION public.tg_commessa_fasi_validate_responsabile();
