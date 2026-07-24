-- BLOCCO 6b.1 — Hotfix idempotenza import preventivo

DO $$
DECLARE _dups INT;
BEGIN
  SELECT COUNT(*) INTO _dups FROM (
    SELECT commessa_id, preventivo_voce_id, tipo
    FROM public.commessa_budget_voci
    WHERE preventivo_voce_id IS NOT NULL
      AND archived_at IS NULL
      AND fonte = 'preventivo'
    GROUP BY commessa_id, preventivo_voce_id, tipo
    HAVING COUNT(*) > 1
  ) d;
  IF _dups > 0 THEN
    RAISE EXCEPTION 'Duplicati incompatibili trovati (%): abortito.', _dups;
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_cbv_prev_voce_active;

CREATE UNIQUE INDEX uq_cbv_prev_voce_tipo_active
  ON public.commessa_budget_voci (commessa_id, preventivo_voce_id, tipo)
  WHERE fonte = 'preventivo'
    AND preventivo_voce_id IS NOT NULL
    AND archived_at IS NULL;

-- Ricreo la RPC con conteggi separati ricavo/costo e is_locked=true sulle voci importate
CREATE OR REPLACE FUNCTION public.import_budget_from_preventivo(
  _commessa_id uuid,
  _expected_updated_at timestamp with time zone,
  _strategy text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org UUID; v_upd TIMESTAMPTZ; v_mod TEXT; v_prev UUID;
  v_ricavi_creati   INT := 0;
  v_costi_creati    INT := 0;
  v_ricavi_ignorati INT := 0;
  v_costi_ignorati  INT := 0;
  v_no_costo        INT := 0;
  v_pos INT; v_exists BOOLEAN; v_has_voci BOOLEAN;
  r RECORD; v_categoria_costo TEXT;
BEGIN
  IF _strategy NOT IN ('init_if_empty','add_missing') THEN
    RAISE EXCEPTION 'Strategia non valida';
  END IF;
  IF NOT public.can_manage_commessa_budget(_commessa_id, 'import_preventivo') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE='42501';
  END IF;

  SELECT organization_id, updated_at, budget_modalita, preventivo_id
    INTO v_org, v_upd, v_mod, v_prev
    FROM public.commesse WHERE id=_commessa_id FOR UPDATE;
  IF v_upd <> _expected_updated_at THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  IF v_prev IS NULL THEN RAISE EXCEPTION 'Nessun preventivo collegato'; END IF;
  IF v_mod <> 'analitico' THEN RAISE EXCEPTION 'Attivare prima la modalità analitico'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
    WHERE commessa_id=_commessa_id AND archived_at IS NULL) INTO v_has_voci;
  IF _strategy='init_if_empty' AND v_has_voci THEN
    RAISE EXCEPTION 'Budget non vuoto: usare strategia add_missing';
  END IF;

  SELECT COALESCE(MAX(posizione),0) INTO v_pos FROM public.commessa_budget_voci
    WHERE commessa_id=_commessa_id AND archived_at IS NULL;

  FOR r IN
    SELECT id, codice, descrizione, unita_misura, quantita, costo_unitario, costo_totale,
           prezzo_unitario, importo_netto, categoria
    FROM public.preventivo_voci
    WHERE preventivo_id = v_prev AND organization_id = v_org
    ORDER BY ordine
  LOOP
    -- RICAVO (indipendente dal costo)
    SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
      WHERE commessa_id=_commessa_id AND preventivo_voce_id=r.id
        AND archived_at IS NULL AND fonte='preventivo' AND tipo='ricavo') INTO v_exists;
    IF v_exists THEN
      v_ricavi_ignorati := v_ricavi_ignorati + 1;
    ELSE
      v_pos := v_pos + 1;
      INSERT INTO public.commessa_budget_voci(
        organization_id, commessa_id, tipo, categoria, descrizione, codice,
        unita_misura, quantita, prezzo_unitario, importo_previsto,
        importo_impegnato, importo_sostenuto, costo_residuo_stimato,
        fonte, preventivo_voce_id, posizione, is_locked, created_by
      ) VALUES (
        v_org, _commessa_id, 'ricavo', 'contratto',
        COALESCE(NULLIF(r.descrizione,''), '(voce senza descrizione)'), r.codice,
        r.unita_misura, r.quantita, r.prezzo_unitario, COALESCE(r.importo_netto,0),
        0, 0, 0, 'preventivo', r.id, v_pos, true, auth.uid()
      );
      v_ricavi_creati := v_ricavi_creati + 1;
    END IF;

    -- COSTO (indipendente dal ricavo)
    IF COALESCE(r.costo_totale, r.costo_unitario * r.quantita, 0) > 0 THEN
      v_categoria_costo := CASE
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%manodop%' THEN 'manodopera'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%materia%' THEN 'materiali'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%subapp%' THEN 'subappalti'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%noleg%' THEN 'noleggi'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%mezz%' THEN 'mezzi'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%trasp%' THEN 'trasporti'
        WHEN lower(COALESCE(r.categoria,'')) LIKE '%sicur%' THEN 'sicurezza'
        ELSE 'altro'
      END;
      SELECT EXISTS(SELECT 1 FROM public.commessa_budget_voci
        WHERE commessa_id=_commessa_id AND preventivo_voce_id=r.id
          AND archived_at IS NULL AND fonte='preventivo' AND tipo='costo') INTO v_exists;
      IF v_exists THEN
        v_costi_ignorati := v_costi_ignorati + 1;
      ELSE
        v_pos := v_pos + 1;
        INSERT INTO public.commessa_budget_voci(
          organization_id, commessa_id, tipo, categoria, descrizione, codice,
          unita_misura, quantita, prezzo_unitario, importo_previsto,
          importo_impegnato, importo_sostenuto, costo_residuo_stimato,
          fonte, preventivo_voce_id, posizione, is_locked, created_by
        ) VALUES (
          v_org, _commessa_id, 'costo', v_categoria_costo,
          COALESCE(NULLIF(r.descrizione,''), '(voce senza descrizione)'), r.codice,
          r.unita_misura, r.quantita, r.costo_unitario,
          COALESCE(r.costo_totale, r.costo_unitario * r.quantita, 0),
          0, 0, 0, 'preventivo', r.id, v_pos, true, auth.uid()
        );
        v_costi_creati := v_costi_creati + 1;
      END IF;
    ELSE
      v_no_costo := v_no_costo + 1;
    END IF;
  END LOOP;

  PERFORM public.recalculate_commessa_budget(_commessa_id);
  PERFORM public._cbv_audit(v_org, _commessa_id, 'commessa.budget_imported_from_preventivo',
    jsonb_build_object(
      'strategy', _strategy,
      'ricavi_creati', v_ricavi_creati,
      'costi_creati', v_costi_creati,
      'ricavi_ignorati', v_ricavi_ignorati,
      'costi_ignorati', v_costi_ignorati,
      'senza_costo', v_no_costo
    ));

  RETURN jsonb_build_object(
    'ricavi_creati',   v_ricavi_creati,
    'costi_creati',    v_costi_creati,
    'ricavi_ignorati', v_ricavi_ignorati,
    'costi_ignorati',  v_costi_ignorati,
    'ignorati',        v_ricavi_ignorati + v_costi_ignorati,  -- retrocompat
    'senza_costo',     v_no_costo,
    'commessa_updated_at', (SELECT updated_at FROM public.commesse WHERE id=_commessa_id)
  );
END $function$;