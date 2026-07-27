
-- =========================================================================
-- Sprint 5 — Blocco 1: rapportini hardening
-- =========================================================================

-- Guardia iniziale conteggio
DO $$
DECLARE _n INT;
BEGIN
  SELECT COUNT(*) INTO _n FROM public.rapportini;
  IF _n <> 13 THEN
    RAISE NOTICE 'Rapportini count before migration: %', _n;
  END IF;
END$$;

-- ---------- Colonne nuove ----------
ALTER TABLE public.rapportini
  ADD COLUMN IF NOT EXISTS fase_id UUID,
  ADD COLUMN IF NOT EXISTS pausa_minuti INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descrizione_lavori TEXT,
  ADD COLUMN IF NOT EXISTS stato TEXT NOT NULL DEFAULT 'bozza',
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID;

-- ---------- Backfill storico (13 record) ----------
UPDATE public.rapportini SET
  descrizione_lavori = COALESCE(descrizione_lavori, NULLIF(TRIM(lavorazione), '')),
  created_by         = COALESCE(created_by, user_id),
  updated_at         = COALESCE(updated_at, created_at),
  stato              = CASE WHEN stato = 'bozza' THEN 'inviato' ELSE stato END,
  pausa_minuti       = COALESCE(pausa_minuti, 0);

-- Metadata di migrazione: nessuna colonna metadata dedicata; il fatto che
-- created_by = user_id e updated_at = created_at documenta il backfill.
-- Vedi commento tabella.
COMMENT ON COLUMN public.rapportini.stato IS
  'Stato workflow. I record storici anteriori a Sprint 5 sono stati impostati a "inviato" durante la migrazione tecnica per preservare la visibilità: non implica un invio esplicito da parte dell''utente.';
COMMENT ON COLUMN public.rapportini.created_by IS
  'Autore materiale dell''inserimento. Per i record storici migrati coincide con user_id (fallback tecnico).';
COMMENT ON COLUMN public.rapportini.descrizione_lavori IS
  'Campo canonico per la descrizione. Il campo "lavorazione" resta come legacy.';

-- ---------- Constraint ----------
-- commessa_id obbligatorio (tutti i 13 storici ce l'hanno già)
ALTER TABLE public.rapportini ALTER COLUMN commessa_id SET NOT NULL;

-- CHECK stabili (no CURRENT_DATE)
ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_ore_valid;
ALTER TABLE public.rapportini
  ADD CONSTRAINT rapportini_ore_valid CHECK (ore > 0 AND ore <= 24);

ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_pausa_valid;
ALTER TABLE public.rapportini
  ADD CONSTRAINT rapportini_pausa_valid CHECK (pausa_minuti >= 0);

ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_stato_valid;
ALTER TABLE public.rapportini
  ADD CONSTRAINT rapportini_stato_valid CHECK (stato IN ('bozza','inviato','approvato','respinto','annullato'));

-- ---------- FK cleanup + nuove ----------
-- Rimuove FK duplicata single-col (composite anti cross-tenant resta)
ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_commessa_id_fkey;

-- Fase composite anti cross-tenant + coerenza commessa
ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_fase_fk;
ALTER TABLE public.rapportini
  ADD CONSTRAINT rapportini_fase_fk
  FOREIGN KEY (fase_id, organization_id)
  REFERENCES public.commessa_fasi(id, organization_id)
  ON DELETE SET NULL;

-- created_by / archived_by → auth.users
ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_created_by_fkey;
ALTER TABLE public.rapportini
  ADD CONSTRAINT rapportini_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.rapportini DROP CONSTRAINT IF EXISTS rapportini_archived_by_fkey;
ALTER TABLE public.rapportini
  ADD CONSTRAINT rapportini_archived_by_fkey
  FOREIGN KEY (archived_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------- Indici ----------
CREATE INDEX IF NOT EXISTS rapportini_stato_idx        ON public.rapportini(stato);
CREATE INDEX IF NOT EXISTS rapportini_archived_at_idx  ON public.rapportini(archived_at);
CREATE INDEX IF NOT EXISTS rapportini_fase_idx         ON public.rapportini(fase_id);
CREATE INDEX IF NOT EXISTS rapportini_updated_at_idx   ON public.rapportini(updated_at);
CREATE INDEX IF NOT EXISTS rapportini_commessa_data_idx ON public.rapportini(commessa_id, data DESC);
CREATE INDEX IF NOT EXISTS rapportini_cantiere_data_idx ON public.rapportini(cantiere_id, data DESC);
CREATE INDEX IF NOT EXISTS rapportini_user_data_idx     ON public.rapportini(user_id, data DESC);
CREATE INDEX IF NOT EXISTS rapportini_org_data_idx      ON public.rapportini(organization_id, data DESC);

-- ---------- Trigger updated_at + validazioni ----------
DROP TRIGGER IF EXISTS rapportini_set_updated_at ON public.rapportini;
CREATE TRIGGER rapportini_set_updated_at
  BEFORE UPDATE ON public.rapportini
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Estende validazione: fase coerente
CREATE OR REPLACE FUNCTION public.tg_rapportini_validate_cantiere()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  _cant_commessa UUID;
  _fase_commessa UUID;
  _fase_cantiere UUID;
  _fase_org      UUID;
BEGIN
  IF NEW.cantiere_id IS NOT NULL AND NEW.commessa_id IS NOT NULL THEN
    SELECT commessa_id INTO _cant_commessa FROM public.cantieri WHERE id = NEW.cantiere_id;
    IF _cant_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'Il cantiere non appartiene alla commessa del rapportino' USING ERRCODE='22023';
    END IF;
  END IF;
  IF NEW.fase_id IS NOT NULL THEN
    SELECT commessa_id, cantiere_id, organization_id
      INTO _fase_commessa, _fase_cantiere, _fase_org
      FROM public.commessa_fasi WHERE id = NEW.fase_id;
    IF _fase_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'La fase non appartiene alla stessa organizzazione' USING ERRCODE='22023';
    END IF;
    IF _fase_commessa IS DISTINCT FROM NEW.commessa_id THEN
      RAISE EXCEPTION 'La fase non appartiene alla commessa selezionata' USING ERRCODE='22023';
    END IF;
    IF _fase_cantiere IS NOT NULL AND NEW.cantiere_id IS NOT NULL
       AND _fase_cantiere IS DISTINCT FROM NEW.cantiere_id THEN
      RAISE EXCEPTION 'La fase non appartiene al cantiere selezionato' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- ---------- RLS: drop policy vecchie ----------
DROP POLICY IF EXISTS rapportini_del                ON public.rapportini;
DROP POLICY IF EXISTS rapportini_ins_ops            ON public.rapportini;
DROP POLICY IF EXISTS rapportini_ins_own_operaio    ON public.rapportini;
DROP POLICY IF EXISTS rapportini_sel_internal       ON public.rapportini;
DROP POLICY IF EXISTS rapportini_sel_own_operaio    ON public.rapportini;
DROP POLICY IF EXISTS rapportini_upd_ops            ON public.rapportini;
DROP POLICY IF EXISTS rapportini_upd_own_operaio    ON public.rapportini;

-- ---------- RLS: SELECT ----------
-- Un unica policy con matrice ruoli. is_org_member esclude utenti non membri
-- e utenti disattivati (via has_any_role che verifica profile is_active).
CREATE POLICY rapportini_sel ON public.rapportini
FOR SELECT TO authenticated
USING (
  public.is_org_member(organization_id)
  AND (
    public.has_any_role(organization_id,
      ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione']::app_role[])
    OR user_id = auth.uid()
    OR (
      public.has_any_role(organization_id, ARRAY['responsabile_commessa']::app_role[])
      AND public.can_access_commessa(commessa_id)
    )
    OR (
      public.has_any_role(organization_id, ARRAY['capocantiere']::app_role[])
      AND cantiere_id IS NOT NULL
      AND (public.is_capocantiere_di(cantiere_id) OR public.is_membro_cantiere(cantiere_id))
    )
  )
);

-- Nessuna policy INSERT/UPDATE/DELETE per authenticated:
-- tutte le mutazioni passano dalle RPC SECURITY DEFINER.

-- ---------- GRANT / REVOKE ----------
REVOKE ALL ON public.rapportini FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.rapportini FROM authenticated;
GRANT SELECT ON public.rapportini TO authenticated;
GRANT ALL ON public.rapportini TO service_role;

-- =========================================================================
-- RPC
-- =========================================================================

-- Helper: risolve profilo attivo dell'utente corrente
CREATE OR REPLACE FUNCTION public._rap_current_profile()
RETURNS TABLE(user_id UUID, organization_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid();
DECLARE _org UUID;
DECLARE _active BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Non autenticato' USING ERRCODE='42501'; END IF;
  SELECT p.organization_id, COALESCE(p.is_active, false)
    INTO _org, _active
    FROM public.profiles p WHERE p.id = _uid;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata' USING ERRCODE='42501'; END IF;
  IF _active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Utente disattivato' USING ERRCODE='42501'; END IF;
  user_id := _uid; organization_id := _org; RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public._rap_current_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._rap_current_profile() TO authenticated;

-- ---------- CREATE ----------
CREATE OR REPLACE FUNCTION public.create_rapportino(
  _commessa_id        UUID,
  _user_id            UUID,
  _data               DATE,
  _ore                NUMERIC,
  _descrizione_lavori TEXT,
  _cantiere_id        UUID DEFAULT NULL,
  _fase_id            UUID DEFAULT NULL,
  _ora_inizio         TIME DEFAULT NULL,
  _ora_fine           TIME DEFAULT NULL,
  _pausa_minuti       INTEGER DEFAULT 0,
  _note               TEXT DEFAULT NULL,
  _foto_urls          TEXT[] DEFAULT NULL,
  _override_ore       BOOLEAN DEFAULT FALSE,
  _override_motivo    TEXT DEFAULT NULL
) RETURNS TABLE(id UUID, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _me         UUID := auth.uid();
  _org        UUID;
  _c_org      UUID;
  _c_closed   TIMESTAMPTZ;
  _c_arch     TIMESTAMPTZ;
  _t_active   BOOLEAN;
  _t_org      UUID;
  _is_admin   BOOLEAN;
  _new_id     UUID;
  _new_upd    TIMESTAMPTZ;
BEGIN
  SELECT p.organization_id INTO _org
    FROM public._rap_current_profile() p;

  -- validazione utente riferito (user_id)
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Utente obbligatorio' USING ERRCODE='22023'; END IF;
  SELECT organization_id, COALESCE(is_active,false)
    INTO _t_org, _t_active FROM public.profiles WHERE id = _user_id;
  IF _t_org IS DISTINCT FROM _org THEN
    RAISE EXCEPTION 'Utente non appartiene all''organizzazione' USING ERRCODE='42501';
  END IF;
  IF _t_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Utente riferito non è attivo' USING ERRCODE='42501';
  END IF;

  -- operaio può creare solo per sé
  _is_admin := public.has_any_role(_org,
      ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione','responsabile_commessa','capocantiere']::app_role[]);
  IF _user_id <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non autorizzato a creare rapportini per altri utenti' USING ERRCODE='42501';
  END IF;

  -- commessa
  SELECT organization_id, closed_at, archived_at INTO _c_org, _c_closed, _c_arch
    FROM public.commesse WHERE id = _commessa_id;
  IF _c_org IS DISTINCT FROM _org THEN
    RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='42501';
  END IF;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_commessa(_commessa_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere alla commessa' USING ERRCODE='42501';
  END IF;
  IF _cantiere_id IS NOT NULL AND NOT public.can_access_cantiere(_cantiere_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere al cantiere' USING ERRCODE='42501';
  END IF;

  -- data
  IF _data IS NULL THEN RAISE EXCEPTION 'Data obbligatoria' USING ERRCODE='22023'; END IF;
  IF _data > (CURRENT_DATE + INTERVAL '1 day')::date THEN
    RAISE EXCEPTION 'Data futura oltre la soglia consentita (max domani)' USING ERRCODE='22023';
  END IF;

  -- descrizione
  IF _descrizione_lavori IS NULL OR btrim(_descrizione_lavori) = '' THEN
    RAISE EXCEPTION 'Descrizione lavori obbligatoria' USING ERRCODE='22023';
  END IF;

  -- ore
  IF _ore IS NULL OR _ore <= 0 OR _ore > 24 THEN
    RAISE EXCEPTION 'Ore non valide (0 < ore <= 24)' USING ERRCODE='22023';
  END IF;
  IF _ore > 16 THEN
    IF NOT _override_ore OR NOT public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]) THEN
      RAISE EXCEPTION 'Ore oltre il limite operativo di 16 (richiesto override amministratore)' USING ERRCODE='22023';
    END IF;
    IF _override_motivo IS NULL OR btrim(_override_motivo) = '' THEN
      RAISE EXCEPTION 'Motivazione override obbligatoria' USING ERRCODE='22023';
    END IF;
  END IF;

  -- orari coerenti
  IF _ora_inizio IS NOT NULL AND _ora_fine IS NOT NULL AND _ora_fine < _ora_inizio THEN
    RAISE EXCEPTION 'Ora fine antecedente all''ora inizio' USING ERRCODE='22023';
  END IF;
  IF _pausa_minuti IS NULL OR _pausa_minuti < 0 THEN
    RAISE EXCEPTION 'Pausa non valida' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.rapportini(
    organization_id, commessa_id, cantiere_id, fase_id, user_id,
    data, ora_inizio, ora_fine, pausa_minuti, ore,
    descrizione_lavori, lavorazione, note, foto_urls,
    stato, created_by, updated_at
  ) VALUES (
    _org, _commessa_id, _cantiere_id, _fase_id, _user_id,
    _data, _ora_inizio, _ora_fine, COALESCE(_pausa_minuti,0), _ore,
    btrim(_descrizione_lavori), btrim(_descrizione_lavori), _note, COALESCE(_foto_urls, '{}'::text[]),
    'bozza', _me, now()
  ) RETURNING rapportini.id, rapportini.updated_at INTO _new_id, _new_upd;

  PERFORM public._log_audit(_org, 'rapportino.created', 'rapportini', _new_id,
    jsonb_build_object('commessa_id', _commessa_id, 'user_id', _user_id, 'ore', _ore));

  id := _new_id; updated_at := _new_upd; RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.create_rapportino(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,TIME,TIME,INTEGER,TEXT,TEXT[],BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rapportino(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,TIME,TIME,INTEGER,TEXT,TEXT[],BOOLEAN,TEXT) TO authenticated;

-- ---------- UPDATE ----------
CREATE OR REPLACE FUNCTION public.update_rapportino(
  _id                   UUID,
  _expected_updated_at  TIMESTAMPTZ,
  _cantiere_id          UUID DEFAULT NULL,
  _clear_cantiere       BOOLEAN DEFAULT FALSE,
  _fase_id              UUID DEFAULT NULL,
  _clear_fase           BOOLEAN DEFAULT FALSE,
  _data                 DATE DEFAULT NULL,
  _ora_inizio           TIME DEFAULT NULL,
  _clear_ora_inizio     BOOLEAN DEFAULT FALSE,
  _ora_fine             TIME DEFAULT NULL,
  _clear_ora_fine       BOOLEAN DEFAULT FALSE,
  _pausa_minuti         INTEGER DEFAULT NULL,
  _ore                  NUMERIC DEFAULT NULL,
  _descrizione_lavori   TEXT DEFAULT NULL,
  _note                 TEXT DEFAULT NULL,
  _clear_note           BOOLEAN DEFAULT FALSE,
  _override_ore         BOOLEAN DEFAULT FALSE,
  _override_motivo      TEXT DEFAULT NULL
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _me     UUID := auth.uid();
  _org    UUID;
  _row    public.rapportini%ROWTYPE;
  _c_closed TIMESTAMPTZ;
  _c_arch   TIMESTAMPTZ;
  _is_admin BOOLEAN;
  _new_data DATE;
  _new_ore  NUMERIC;
  _new_pause INTEGER;
  _new_cant UUID;
  _new_fase UUID;
  _new_ini  TIME;
  _new_fin  TIME;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rapportino archiviato: ripristina prima di modificarlo' USING ERRCODE='22023';
  END IF;
  IF _row.stato = 'approvato' THEN
    IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore']::app_role[]) THEN
      RAISE EXCEPTION 'Rapportino approvato: modifica non consentita' USING ERRCODE='42501';
    END IF;
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;

  _is_admin := public.has_any_role(_org,
      ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa','capocantiere']::app_role[]);
  IF _row.user_id <> _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non autorizzato a modificare questo rapportino' USING ERRCODE='42501';
  END IF;

  -- commessa non chiusa/archiviata
  SELECT closed_at, archived_at INTO _c_closed, _c_arch
    FROM public.commesse WHERE id = _row.commessa_id;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa' USING ERRCODE='22023'; END IF;

  -- valori nuovi
  _new_cant := CASE WHEN _clear_cantiere THEN NULL WHEN _cantiere_id IS NOT NULL THEN _cantiere_id ELSE _row.cantiere_id END;
  _new_fase := CASE WHEN _clear_fase     THEN NULL WHEN _fase_id     IS NOT NULL THEN _fase_id     ELSE _row.fase_id     END;
  _new_data := COALESCE(_data, _row.data);
  _new_ore  := COALESCE(_ore,  _row.ore);
  _new_pause:= COALESCE(_pausa_minuti, _row.pausa_minuti);
  _new_ini  := CASE WHEN _clear_ora_inizio THEN NULL WHEN _ora_inizio IS NOT NULL THEN _ora_inizio ELSE _row.ora_inizio END;
  _new_fin  := CASE WHEN _clear_ora_fine   THEN NULL WHEN _ora_fine   IS NOT NULL THEN _ora_fine   ELSE _row.ora_fine   END;

  -- validazioni comuni con create
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
    RAISE EXCEPTION 'Non autorizzato ad accedere al cantiere' USING ERRCODE='42501';
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

  PERFORM public._log_audit(_org, 'rapportino.updated', 'rapportini', _id,
    jsonb_build_object('by', _me));

  SELECT updated_at INTO _row.updated_at FROM public.rapportini WHERE id = _id;
  RETURN _row.updated_at;
END; $$;
REVOKE ALL ON FUNCTION public.update_rapportino(UUID,TIMESTAMPTZ,UUID,BOOLEAN,UUID,BOOLEAN,DATE,TIME,BOOLEAN,TIME,BOOLEAN,INTEGER,NUMERIC,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_rapportino(UUID,TIMESTAMPTZ,UUID,BOOLEAN,UUID,BOOLEAN,DATE,TIME,BOOLEAN,TIME,BOOLEAN,INTEGER,NUMERIC,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT) TO authenticated;

-- ---------- ARCHIVE ----------
CREATE OR REPLACE FUNCTION public.archive_rapportino(
  _id UUID,
  _expected_updated_at TIMESTAMPTZ,
  _motivazione TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _new_upd TIMESTAMPTZ;
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
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa']::app_role[])
     AND _row.user_id <> _me THEN
    RAISE EXCEPTION 'Non autorizzato ad archiviare questo rapportino' USING ERRCODE='42501';
  END IF;
  UPDATE public.rapportini SET archived_at = now(), archived_by = _me
    WHERE id = _id RETURNING updated_at INTO _new_upd;
  PERFORM public._log_audit(_org, 'rapportino.archived', 'rapportini', _id,
    jsonb_build_object('motivazione', _motivazione, 'by', _me));
  RETURN _new_upd;
END; $$;
REVOKE ALL ON FUNCTION public.archive_rapportino(UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_rapportino(UUID,TIMESTAMPTZ,TEXT) TO authenticated;

-- ---------- RESTORE ----------
CREATE OR REPLACE FUNCTION public.restore_rapportino(
  _id UUID,
  _expected_updated_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _row public.rapportini%ROWTYPE;
  _new_upd TIMESTAMPTZ;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  SELECT * INTO _row FROM public.rapportini WHERE id = _id;
  IF NOT FOUND OR _row.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _row.archived_at IS NULL THEN
    RAISE EXCEPTION 'Rapportino non archiviato' USING ERRCODE='22023';
  END IF;
  IF _row.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il rapportino è stato modificato da un altro utente. Ricarica i dati prima di riprovare.' USING ERRCODE='40001';
  END IF;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','ufficio_tecnico','responsabile_commessa']::app_role[]) THEN
    RAISE EXCEPTION 'Non autorizzato a ripristinare rapportini' USING ERRCODE='42501';
  END IF;
  UPDATE public.rapportini SET archived_at = NULL, archived_by = NULL
    WHERE id = _id RETURNING updated_at INTO _new_upd;
  PERFORM public._log_audit(_org, 'rapportino.restored', 'rapportini', _id,
    jsonb_build_object('by', _me));
  RETURN _new_upd;
END; $$;
REVOKE ALL ON FUNCTION public.restore_rapportino(UUID,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_rapportino(UUID,TIMESTAMPTZ) TO authenticated;

-- Guardia finale
DO $$
DECLARE _n INT;
BEGIN
  SELECT COUNT(*) INTO _n FROM public.rapportini;
  IF _n <> 13 THEN
    RAISE EXCEPTION 'Post-migration count mismatch: expected 13, got %', _n;
  END IF;
END$$;
