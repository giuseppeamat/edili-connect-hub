-- 1) Riattiva le righe costo per persona stornate per errore
UPDATE public.rapportini_costi c
SET stato = 'contabilizzato',
    stornato_at = NULL,
    stornato_by = NULL,
    motivo_storno = NULL,
    ore = p.ore,
    costo_orario_applicato = p.tariffa_oraria_congelata,
    costo_totale = p.costo_congelato,
    rapportino_personale_id = p.id,
    updated_at = now()
FROM public.rapportini_personale p
WHERE c.rapportino_id = p.rapportino_id
  AND c.membro_id = p.membro_id
  AND p.annullato_at IS NULL
  AND p.stato_contabilizzazione = 'contabilizzato'
  AND p.costo_congelato IS NOT NULL
  AND (c.stato <> 'contabilizzato' OR c.stornato_at IS NOT NULL);

-- 2) Crea le righe costo mancanti per le persone contabilizzate
INSERT INTO public.rapportini_costi (
  organization_id, rapportino_id, rapportino_personale_id, membro_id, user_id,
  commessa_id, cantiere_id, fase_id,
  ore, costo_orario_applicato, costo_totale, costo_orario_id,
  stato, periodo_riferimento, contabilizzato_at, contabilizzato_by
)
SELECT r.organization_id, r.id, p.id, p.membro_id, r.user_id,
       r.commessa_id, r.cantiere_id, r.fase_id,
       p.ore, p.tariffa_oraria_congelata, p.costo_congelato, p.tariffa_id,
       'contabilizzato', date_trunc('month', r.data)::date, now(), r.created_by
FROM public.rapportini_personale p
JOIN public.rapportini r ON r.id = p.rapportino_id
WHERE p.annullato_at IS NULL
  AND p.stato_contabilizzazione = 'contabilizzato'
  AND p.costo_congelato IS NOT NULL
  AND r.archived_at IS NULL
  AND r.stato <> 'annullato'
  AND NOT EXISTS (
    SELECT 1 FROM public.rapportini_costi c
    WHERE c.rapportino_id = p.rapportino_id AND c.membro_id = p.membro_id
  );

-- 3) Storna le vecchie righe di testata sui rapportini che hanno righe personale
UPDATE public.rapportini_costi c
SET stato = 'stornato',
    stornato_at = COALESCE(c.stornato_at, now()),
    motivo_storno = COALESCE(c.motivo_storno, 'Migrazione: costo per singola persona'),
    updated_at = now()
WHERE c.stato <> 'stornato'
  AND EXISTS (
    SELECT 1 FROM public.rapportini_personale p
    WHERE p.rapportino_id = c.rapportino_id AND p.annullato_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.rapportini_personale p2
    WHERE p2.rapportino_id = c.rapportino_id
      AND p2.membro_id = c.membro_id
      AND p2.annullato_at IS NULL
  );

-- 4) Ricalcolo delle voci di budget manodopera interessate
DO $$
DECLARE k record;
BEGIN
  FOR k IN
    SELECT DISTINCT commessa_id, cantiere_id, fase_id, periodo_riferimento
    FROM public.rapportini_costi
  LOOP
    BEGIN
      PERFORM public._recalculate_labor_budget_voce(k.commessa_id, k.cantiere_id, k.fase_id, k.periodo_riferimento);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;