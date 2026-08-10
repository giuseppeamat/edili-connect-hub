ALTER TABLE public.materiali_prezzi_fornitori
  ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'bolla',
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$ BEGIN
  ALTER TABLE public.materiali_prezzi_fornitori
    ADD CONSTRAINT prezzi_origine_chk CHECK (origine IN ('bolla','manuale'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.save_prezzo_materiale(
  _materiale_id uuid,
  _fornitore_id uuid,
  _prezzo numeric,
  _data date,
  _unita_misura text DEFAULT NULL,
  _quantita_riferimento numeric DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; new_id uuid;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata'; END IF;
  IF NOT public.can_see_econ(org) THEN RAISE EXCEPTION 'Permessi insufficienti per i prezzi'; END IF;
  IF _prezzo IS NULL OR _prezzo < 0 THEN RAISE EXCEPTION 'Prezzo non valido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materiali m WHERE m.id = _materiale_id AND m.organization_id = org) THEN
    RAISE EXCEPTION 'Materiale non valido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fornitori f WHERE f.id = _fornitore_id AND f.organization_id = org) THEN
    RAISE EXCEPTION 'Fornitore non valido';
  END IF;

  INSERT INTO public.materiali_prezzi_fornitori (
    organization_id, materiale_id, fornitore_id, data_prezzo, prezzo_unitario,
    unita_misura, quantita_riferimento, note, origine, created_by
  ) VALUES (
    org, _materiale_id, _fornitore_id, COALESCE(_data, CURRENT_DATE), _prezzo,
    NULLIF(btrim(COALESCE(_unita_misura,'')),''), _quantita_riferimento,
    NULLIF(btrim(COALESCE(_note,'')),''), 'manuale', auth.uid()
  ) RETURNING id INTO new_id;

  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION public.save_prezzo_materiale(uuid, uuid, numeric, date, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_prezzo_materiale(uuid, uuid, numeric, date, text, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_materiali_prezzi(
  _materiale_id uuid, _fornitore_id uuid, _from date, _to date, _q text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; out jsonb;
BEGIN
  org := public.current_organization_id();
  IF org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata'; END IF;
  IF NOT public.can_see_econ(org) THEN RAISE EXCEPTION 'Permessi insufficienti per i prezzi'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'data_prezzo', p.data_prezzo, 'prezzo_unitario', p.prezzo_unitario,
    'unita_misura', p.unita_misura, 'quantita_riferimento', p.quantita_riferimento,
    'materiale_id', p.materiale_id, 'materiale_nome', m.nome, 'descrizione', p.descrizione,
    'fornitore_id', p.fornitore_id, 'fornitore_nome', f.ragione_sociale,
    'commessa_id', p.commessa_id, 'bolla_id', p.bolla_id,
    'origine', p.origine, 'note', p.note
  ) ORDER BY p.data_prezzo DESC), '[]'::jsonb) INTO out
  FROM public.materiali_prezzi_fornitori p
  LEFT JOIN public.materiali m ON m.id = p.materiale_id
  LEFT JOIN public.fornitori f ON f.id = p.fornitore_id
  WHERE p.organization_id = org
    AND (_materiale_id IS NULL OR p.materiale_id = _materiale_id)
    AND (_fornitore_id IS NULL OR p.fornitore_id = _fornitore_id)
    AND (_from IS NULL OR p.data_prezzo >= _from)
    AND (_to IS NULL OR p.data_prezzo <= _to)
    AND (_q IS NULL OR btrim(_q) = '' OR p.descrizione ILIKE '%'||btrim(_q)||'%' OR m.nome ILIKE '%'||btrim(_q)||'%');
  RETURN out;
END $$;