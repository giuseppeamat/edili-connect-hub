-- =====================================================================
-- FEATURE: Membri organizzazione senza accesso immediato
-- =====================================================================

-- 1. ENUM stato accesso ------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.member_access_state AS ENUM
    ('senza_accesso','invitato','attivo','invito_scaduto','disabilitato');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. TABELLA -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome text NOT NULL,
  cognome text,
  email text,
  telefono text,
  ruolo_organizzativo public.app_role NOT NULL DEFAULT 'operaio',
  qualifica text,
  stato_accesso public.member_access_state NOT NULL DEFAULT 'senza_accesso',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT organization_members_nome_ck CHECK (btrim(nome) <> ''),
  CONSTRAINT organization_members_id_org_uq UNIQUE (id, organization_id)
);

-- Normalizzazione email + updated_at
CREATE OR REPLACE FUNCTION public._om_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.email := NULLIF(lower(btrim(COALESCE(NEW.email,''))), '');
  NEW.nome := btrim(NEW.nome);
  NEW.cognome := NULLIF(btrim(COALESCE(NEW.cognome,'')), '');
  NEW.telefono := NULLIF(btrim(COALESCE(NEW.telefono,'')), '');
  NEW.qualifica := NULLIF(btrim(COALESCE(NEW.qualifica,'')), '');
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS organization_members_normalize ON public.organization_members;
CREATE TRIGGER organization_members_normalize
  BEFORE INSERT OR UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public._om_normalize();

-- Deduplicazione
CREATE UNIQUE INDEX IF NOT EXISTS organization_members_user_uq
  ON public.organization_members(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organization_members_org_email_uq
  ON public.organization_members(organization_id, email)
  WHERE email IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_members_org_idx
  ON public.organization_members(organization_id) WHERE archived_at IS NULL;

-- 3. BACKFILL da profiles + user_roles ---------------------------------
INSERT INTO public.organization_members
  (organization_id, user_id, nome, cognome, email, telefono,
   ruolo_organizzativo, stato_accesso, is_active, created_at)
SELECT p.organization_id,
       p.id,
       COALESCE(NULLIF(btrim(p.nome),''), split_part(COALESCE(p.email,'membro'),'@',1)),
       p.cognome,
       lower(btrim(p.email)),
       p.telefono,
       COALESCE((SELECT ur.role FROM public.user_roles ur
                 WHERE ur.user_id = p.id AND ur.organization_id = p.organization_id
                 LIMIT 1), 'operaio'::public.app_role),
       CASE WHEN COALESCE(p.is_active,true) THEN 'attivo'::public.member_access_state
            ELSE 'disabilitato'::public.member_access_state END,
       COALESCE(p.is_active, true),
       p.created_at
FROM public.profiles p
WHERE p.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = p.id);

-- 4. COLLEGAMENTO INVITI ------------------------------------------------
ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.organization_members(id) ON DELETE SET NULL;

-- Membri "invitati" per inviti pendenti senza persona corrispondente
INSERT INTO public.organization_members
  (organization_id, nome, email, ruolo_organizzativo, stato_accesso, created_at, created_by)
SELECT i.organization_id,
       split_part(i.email,'@',1),
       lower(btrim(i.email)),
       i.role,
       'invitato'::public.member_access_state,
       i.created_at,
       i.created_by
FROM public.invites i
WHERE i.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = i.organization_id AND m.email = lower(btrim(i.email))
  );

UPDATE public.invites i
SET member_id = m.id
FROM public.organization_members m
WHERE i.member_id IS NULL
  AND m.organization_id = i.organization_id
  AND m.email = lower(btrim(i.email));

-- 5. COLONNE membro_id sulle entità operative ---------------------------
ALTER TABLE public.rapportini ADD COLUMN IF NOT EXISTS membro_id uuid;
ALTER TABLE public.rapportini_costi ADD COLUMN IF NOT EXISTS membro_id uuid;
ALTER TABLE public.personale_costi_orari ADD COLUMN IF NOT EXISTS membro_id uuid;
ALTER TABLE public.commessa_membri ADD COLUMN IF NOT EXISTS membro_id uuid;
ALTER TABLE public.commesse ADD COLUMN IF NOT EXISTS responsabile_membro_id uuid;
ALTER TABLE public.cantieri ADD COLUMN IF NOT EXISTS responsabile_membro_id uuid;
ALTER TABLE public.cantieri ADD COLUMN IF NOT EXISTS capocantiere_membro_id uuid;

UPDATE public.rapportini r SET membro_id = m.id
  FROM public.organization_members m
  WHERE r.membro_id IS NULL AND m.user_id = r.user_id AND m.organization_id = r.organization_id;
UPDATE public.rapportini_costi rc SET membro_id = m.id
  FROM public.organization_members m
  WHERE rc.membro_id IS NULL AND m.user_id = rc.user_id AND m.organization_id = rc.organization_id;
UPDATE public.personale_costi_orari p SET membro_id = m.id
  FROM public.organization_members m
  WHERE p.membro_id IS NULL AND m.user_id = p.user_id AND m.organization_id = p.organization_id;
UPDATE public.commessa_membri cm SET membro_id = m.id
  FROM public.organization_members m
  WHERE cm.membro_id IS NULL AND m.user_id = cm.user_id AND m.organization_id = cm.organization_id;
UPDATE public.commesse c SET responsabile_membro_id = m.id
  FROM public.organization_members m
  WHERE c.responsabile_membro_id IS NULL AND m.user_id = c.responsabile_id AND m.organization_id = c.organization_id;
UPDATE public.cantieri ca SET responsabile_membro_id = m.id
  FROM public.organization_members m
  WHERE ca.responsabile_membro_id IS NULL AND m.user_id = ca.responsabile_id AND m.organization_id = ca.organization_id;
UPDATE public.cantieri ca SET capocantiere_membro_id = m.id
  FROM public.organization_members m
  WHERE ca.capocantiere_membro_id IS NULL AND m.user_id = ca.capocantiere_id AND m.organization_id = ca.organization_id;

-- FK composite tenant-safe
DO $$ BEGIN
  ALTER TABLE public.rapportini ADD CONSTRAINT rapportini_membro_fk
    FOREIGN KEY (membro_id, organization_id) REFERENCES public.organization_members(id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.rapportini_costi ADD CONSTRAINT rapportini_costi_membro_fk
    FOREIGN KEY (membro_id, organization_id) REFERENCES public.organization_members(id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.personale_costi_orari ADD CONSTRAINT pco_membro_fk
    FOREIGN KEY (membro_id, organization_id) REFERENCES public.organization_members(id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.commessa_membri ADD CONSTRAINT commessa_membri_membro_fk
    FOREIGN KEY (membro_id, organization_id) REFERENCES public.organization_members(id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.commesse ADD CONSTRAINT commesse_resp_membro_fk
    FOREIGN KEY (responsabile_membro_id, organization_id) REFERENCES public.organization_members(id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cantieri ADD CONSTRAINT cantieri_resp_membro_fk
    FOREIGN KEY (responsabile_membro_id, organization_id) REFERENCES public.organization_members(id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cantieri ADD CONSTRAINT cantieri_capo_membro_fk
    FOREIGN KEY (capocantiere_membro_id, organization_id) REFERENCES public.organization_members(id, organization_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- user_id diventa opzionale dove la persona può non avere accesso
ALTER TABLE public.rapportini ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.rapportini_costi ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.personale_costi_orari ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.commessa_membri ALTER COLUMN user_id DROP NOT NULL;

-- Tariffe: nessuna sovrapposizione per membro
DO $$ BEGIN
  ALTER TABLE public.personale_costi_orari ADD CONSTRAINT pco_no_overlap_membro
    EXCLUDE USING gist (
      membro_id WITH =, organization_id WITH =,
      daterange(valido_dal, COALESCE(valido_al,'9999-12-31'::date), '[]') WITH &&
    ) WHERE (archived_at IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS rapportini_membro_idx ON public.rapportini(membro_id);
CREATE INDEX IF NOT EXISTS pco_membro_idx ON public.personale_costi_orari(membro_id);
CREATE INDEX IF NOT EXISTS commessa_membri_membro_idx ON public.commessa_membri(membro_id);

-- 6. GRANT + RLS --------------------------------------------------------
REVOKE ALL ON public.organization_members FROM anon;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_members_select ON public.organization_members;
CREATE POLICY organization_members_select ON public.organization_members
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_organization_id()
    AND (
      user_id = auth.uid()
      OR public.has_any_role(organization_id, ARRAY['proprietario','amministratore','amministrazione',
           'ufficio_tecnico','responsabile_commessa','capocantiere']::public.app_role[])
    )
  );
-- Nessuna policy INSERT/UPDATE/DELETE: scrittura solo via RPC SECURITY DEFINER.

-- 7. HELPER -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._om_assert_manager(_org uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore']::public.app_role[]) THEN
    RAISE EXCEPTION 'Non sei autorizzato a gestire i membri dell''organizzazione' USING ERRCODE='42501';
  END IF;
END $$;

-- 8. RPC CRUD -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization_member(
  _nome text, _cognome text DEFAULT NULL, _email text DEFAULT NULL,
  _telefono text DEFAULT NULL, _ruolo public.app_role DEFAULT 'operaio',
  _qualifica text DEFAULT NULL)
RETURNS TABLE(id uuid, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _new_id uuid; _upd timestamptz;
        _mail text := NULLIF(lower(btrim(COALESCE(_email,''))),'');
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  PERFORM public._om_assert_manager(_org);
  IF _nome IS NULL OR btrim(_nome) = '' THEN
    RAISE EXCEPTION 'Il nome è obbligatorio' USING ERRCODE='22023';
  END IF;
  IF _ruolo = 'proprietario' THEN
    RAISE EXCEPTION 'Il ruolo Proprietario non è assegnabile' USING ERRCODE='42501';
  END IF;
  IF _ruolo = 'amministratore'
     AND NOT public.has_any_role(_org, ARRAY['proprietario']::public.app_role[]) THEN
    RAISE EXCEPTION 'Solo il proprietario può assegnare il ruolo Amministratore' USING ERRCODE='42501';
  END IF;
  IF _mail IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = _org AND m.email = _mail AND m.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Esiste già un membro con questa email nell''organizzazione' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.organization_members
    (organization_id, nome, cognome, email, telefono, ruolo_organizzativo,
     qualifica, stato_accesso, is_active, created_by, updated_by)
  VALUES (_org, _nome, _cognome, _mail, _telefono, _ruolo, _qualifica,
          'senza_accesso', true, _me, _me)
  RETURNING organization_members.id, organization_members.updated_at INTO _new_id, _upd;

  PERFORM public._log_audit(_org, 'membro_creato_senza_accesso', 'organization_members', _new_id,
    jsonb_build_object('ruolo', _ruolo, 'ha_email', _mail IS NOT NULL));
  id := _new_id; updated_at := _upd; RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.update_organization_member(
  _id uuid, _expected_updated_at timestamptz, _nome text, _cognome text DEFAULT NULL,
  _email text DEFAULT NULL, _telefono text DEFAULT NULL,
  _ruolo public.app_role DEFAULT NULL, _qualifica text DEFAULT NULL)
RETURNS TABLE(id uuid, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE; _upd timestamptz;
        _mail text := NULLIF(lower(btrim(COALESCE(_email,''))),'');
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  PERFORM public._om_assert_manager(_org);
  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Il membro è stato modificato da un altro utente. Ricarica i dati.' USING ERRCODE='40001';
  END IF;
  IF _ruolo IS NOT NULL AND _ruolo = 'proprietario' THEN
    RAISE EXCEPTION 'Il ruolo Proprietario non è assegnabile' USING ERRCODE='42501';
  END IF;
  IF _mail IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.organization_members m2
      WHERE m2.organization_id = _org AND m2.email = _mail
        AND m2.archived_at IS NULL AND m2.id <> _id) THEN
    RAISE EXCEPTION 'Esiste già un membro con questa email nell''organizzazione' USING ERRCODE='23505';
  END IF;

  UPDATE public.organization_members SET
    nome = COALESCE(_nome, nome),
    cognome = _cognome,
    email = COALESCE(_mail, email),
    telefono = _telefono,
    ruolo_organizzativo = COALESCE(_ruolo, ruolo_organizzativo),
    qualifica = _qualifica,
    updated_by = _me
  WHERE organization_members.id = _id
  RETURNING organization_members.updated_at INTO _upd;

  PERFORM public._log_audit(_org, 'membro_modificato', 'organization_members', _id, '{}'::jsonb);
  id := _id; updated_at := _upd; RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.archive_organization_member(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  PERFORM public._om_assert_manager(_org);
  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.ruolo_organizzativo = 'proprietario' THEN
    RAISE EXCEPTION 'Il proprietario non può essere archiviato' USING ERRCODE='42501';
  END IF;
  UPDATE public.organization_members
    SET archived_at = now(), archived_by = _me, is_active = false, updated_by = _me
    WHERE organization_members.id = _id AND archived_at IS NULL;
  PERFORM public._log_audit(_org, 'membro_archiviato', 'organization_members', _id, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.restore_organization_member(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  PERFORM public._om_assert_manager(_org);
  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  UPDATE public.organization_members
    SET archived_at = NULL, archived_by = NULL, is_active = true, updated_by = _me
    WHERE organization_members.id = _id;
  PERFORM public._log_audit(_org, 'membro_ripristinato', 'organization_members', _id, '{}'::jsonb);
END $$;

-- Collega un account Auth a un membro esistente (usato in accettazione invito)
CREATE OR REPLACE FUNCTION public.link_member_to_user(
  _member_id uuid, _user_id uuid, _org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.organization_members%ROWTYPE;
BEGIN
  SELECT * INTO _m FROM public.organization_members WHERE id = _member_id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.user_id IS NOT NULL AND _m.user_id <> _user_id THEN
    RAISE EXCEPTION 'Questo membro dispone già di un accesso al gestionale' USING ERRCODE='23505';
  END IF;
  UPDATE public.organization_members
    SET user_id = _user_id, stato_accesso = 'attivo', is_active = true, updated_at = now()
    WHERE id = _member_id;
  PERFORM public._log_audit(_org, 'membro_collegato_account', 'organization_members', _member_id, '{}'::jsonb);
  PERFORM public._log_audit(_org, 'accesso_attivato', 'organization_members', _member_id, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.set_organization_member_access(
  _id uuid, _stato public.member_access_state)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  PERFORM public._om_assert_manager(_org);
  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.ruolo_organizzativo = 'proprietario' THEN
    RAISE EXCEPTION 'Il proprietario non può essere modificato' USING ERRCODE='42501';
  END IF;
  UPDATE public.organization_members
    SET stato_accesso = _stato, updated_by = _me WHERE organization_members.id = _id;
  PERFORM public._log_audit(_org,
    CASE _stato WHEN 'disabilitato' THEN 'accesso_disabilitato'
                WHEN 'attivo' THEN 'accesso_riattivato'
                WHEN 'invitato' THEN 'membro_invitato'
                ELSE 'membro_modificato' END,
    'organization_members', _id, jsonb_build_object('stato_accesso', _stato));
END $$;

REVOKE ALL ON FUNCTION public.create_organization_member(text,text,text,text,public.app_role,text) FROM anon, public;
REVOKE ALL ON FUNCTION public.update_organization_member(uuid,timestamptz,text,text,text,text,public.app_role,text) FROM anon, public;
REVOKE ALL ON FUNCTION public.archive_organization_member(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.restore_organization_member(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.set_organization_member_access(uuid, public.member_access_state) FROM anon, public;
REVOKE ALL ON FUNCTION public.link_member_to_user(uuid,uuid,uuid) FROM anon, public, authenticated;

GRANT EXECUTE ON FUNCTION public.create_organization_member(text,text,text,text,public.app_role,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_member(uuid,timestamptz,text,text,text,text,public.app_role,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_organization_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_organization_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_member_access(uuid, public.member_access_state) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_member_to_user(uuid,uuid,uuid) TO service_role;

-- 9. RAPPORTINI / TARIFFE su identità membro ----------------------------
CREATE OR REPLACE FUNCTION public.get_costo_orario_membro_at_date(
  _membro_id uuid, _org uuid, _data date)
RETURNS public.personale_costi_orari
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.personale_costi_orari
  WHERE membro_id = _membro_id AND organization_id = _org AND archived_at IS NULL
    AND valido_dal <= _data AND (valido_al IS NULL OR valido_al >= _data)
  ORDER BY valido_dal DESC LIMIT 1
$$;

-- Tariffa per membro (anche senza accesso)
CREATE OR REPLACE FUNCTION public.create_costo_orario_membro(
  _membro_id uuid, _costo_orario numeric, _valido_dal date,
  _valido_al date DEFAULT NULL, _note text DEFAULT NULL)
RETURNS TABLE(id uuid, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE;
        _new_id uuid; _upd timestamptz;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF NOT public.has_any_role(_org, ARRAY['proprietario','amministratore','amministrazione']::public.app_role[]) THEN
    RAISE EXCEPTION 'Non sei autorizzato a gestire i costi orari' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _membro_id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Il membro deve essere ripristinato prima di poter essere utilizzato' USING ERRCODE='22023';
  END IF;
  IF _costo_orario < 0 THEN RAISE EXCEPTION 'Costo orario negativo non ammesso' USING ERRCODE='22023'; END IF;
  IF _valido_al IS NOT NULL AND _valido_al < _valido_dal THEN
    RAISE EXCEPTION 'Data fine antecedente alla data inizio' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.personale_costi_orari
    (organization_id, user_id, membro_id, costo_orario, valido_dal, valido_al, note, created_by)
  VALUES (_org, _m.user_id, _membro_id, _costo_orario, _valido_dal, _valido_al,
          NULLIF(btrim(_note),''), _me)
  RETURNING personale_costi_orari.id, personale_costi_orari.updated_at INTO _new_id, _upd;

  PERFORM public._log_audit(_org, 'personale.costo_orario.created', 'personale_costi_orari', _new_id,
    jsonb_build_object('membro_id', _membro_id, 'costo_orario', _costo_orario, 'valido_dal', _valido_dal));
  id := _new_id; updated_at := _upd; RETURN NEXT;
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION 'Esiste già un periodo di validità sovrapposto per questo membro' USING ERRCODE='23P01';
END $$;

REVOKE ALL ON FUNCTION public.create_costo_orario_membro(uuid,numeric,date,date,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_costo_orario_membro(uuid,numeric,date,date,text) TO authenticated;

-- Rapportino attribuito a un membro (autore = auth.uid())
CREATE OR REPLACE FUNCTION public.create_rapportino_membro(
  _commessa_id uuid, _membro_id uuid, _data date, _ore numeric, _descrizione_lavori text,
  _cantiere_id uuid DEFAULT NULL, _fase_id uuid DEFAULT NULL,
  _ora_inizio time DEFAULT NULL, _ora_fine time DEFAULT NULL,
  _pausa_minuti integer DEFAULT 0, _note text DEFAULT NULL,
  _foto_urls text[] DEFAULT NULL, _override_ore boolean DEFAULT false,
  _override_motivo text DEFAULT NULL)
RETURNS TABLE(id uuid, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _m public.organization_members%ROWTYPE;
        _c_org uuid; _c_closed timestamptz; _c_arch timestamptz;
        _is_admin boolean; _new_id uuid; _upd timestamptz;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;

  SELECT * INTO _m FROM public.organization_members WHERE organization_members.id = _membro_id;
  IF NOT FOUND OR _m.organization_id <> _org THEN
    RAISE EXCEPTION 'Elemento non trovato' USING ERRCODE='42501';
  END IF;
  IF _m.archived_at IS NOT NULL OR _m.is_active = false THEN
    RAISE EXCEPTION 'Il membro non è attivo' USING ERRCODE='42501';
  END IF;

  _is_admin := public.has_any_role(_org,
    ARRAY['proprietario','amministratore','ufficio_tecnico','amministrazione',
          'responsabile_commessa','capocantiere']::public.app_role[]);
  IF _m.user_id IS DISTINCT FROM _me AND NOT _is_admin THEN
    RAISE EXCEPTION 'Non autorizzato a creare rapportini per altre persone' USING ERRCODE='42501';
  END IF;

  SELECT organization_id, closed_at, archived_at INTO _c_org, _c_closed, _c_arch
    FROM public.commesse WHERE commesse.id = _commessa_id;
  IF _c_org IS DISTINCT FROM _org THEN RAISE EXCEPTION 'Commessa non trovata' USING ERRCODE='42501'; END IF;
  IF _c_arch IS NOT NULL THEN RAISE EXCEPTION 'Commessa archiviata' USING ERRCODE='22023'; END IF;
  IF _c_closed IS NOT NULL THEN RAISE EXCEPTION 'Commessa chiusa' USING ERRCODE='22023'; END IF;
  IF NOT public.can_access_commessa(_commessa_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere alla commessa' USING ERRCODE='42501';
  END IF;
  IF _cantiere_id IS NOT NULL AND NOT public.can_access_cantiere(_cantiere_id) THEN
    RAISE EXCEPTION 'Non autorizzato ad accedere al cantiere' USING ERRCODE='42501';
  END IF;

  IF _data IS NULL THEN RAISE EXCEPTION 'Data obbligatoria' USING ERRCODE='22023'; END IF;
  IF _data > (CURRENT_DATE + INTERVAL '1 day')::date THEN
    RAISE EXCEPTION 'Data futura oltre la soglia consentita (max domani)' USING ERRCODE='22023';
  END IF;
  IF _descrizione_lavori IS NULL OR btrim(_descrizione_lavori) = '' THEN
    RAISE EXCEPTION 'Descrizione lavori obbligatoria' USING ERRCODE='22023';
  END IF;
  IF _ore IS NULL OR _ore <= 0 OR _ore > 24 THEN
    RAISE EXCEPTION 'Ore non valide (0 < ore <= 24)' USING ERRCODE='22023';
  END IF;
  IF _ore > 16 THEN
    IF NOT _override_ore OR NOT public.has_any_role(_org, ARRAY['proprietario','amministratore']::public.app_role[]) THEN
      RAISE EXCEPTION 'Ore oltre il limite operativo di 16 (richiesto override amministratore)' USING ERRCODE='22023';
    END IF;
    IF _override_motivo IS NULL OR btrim(_override_motivo) = '' THEN
      RAISE EXCEPTION 'Motivazione override obbligatoria' USING ERRCODE='22023';
    END IF;
  END IF;
  IF _ora_inizio IS NOT NULL AND _ora_fine IS NOT NULL AND _ora_fine < _ora_inizio THEN
    RAISE EXCEPTION 'Ora fine antecedente all''ora inizio' USING ERRCODE='22023';
  END IF;
  IF _pausa_minuti IS NULL OR _pausa_minuti < 0 THEN
    RAISE EXCEPTION 'Pausa non valida' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.rapportini(
    organization_id, commessa_id, cantiere_id, fase_id, user_id, membro_id,
    data, ora_inizio, ora_fine, pausa_minuti, ore,
    descrizione_lavori, lavorazione, note, foto_urls, stato, created_by, updated_at
  ) VALUES (
    _org, _commessa_id, _cantiere_id, _fase_id, _m.user_id, _membro_id,
    _data, _ora_inizio, _ora_fine, COALESCE(_pausa_minuti,0), _ore,
    btrim(_descrizione_lavori), btrim(_descrizione_lavori), _note,
    COALESCE(_foto_urls,'{}'::text[]), 'bozza', _me, now()
  ) RETURNING rapportini.id, rapportini.updated_at INTO _new_id, _upd;

  PERFORM public._log_audit(_org, 'rapportino.created', 'rapportini', _new_id,
    jsonb_build_object('commessa_id', _commessa_id, 'membro_id', _membro_id, 'ore', _ore));
  id := _new_id; updated_at := _upd; RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.create_rapportino_membro(uuid,uuid,date,numeric,text,uuid,uuid,time,time,integer,text,text[],boolean,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_rapportino_membro(uuid,uuid,date,numeric,text,uuid,uuid,time,time,integer,text,text[],boolean,text) TO authenticated;

-- 10. CONTABILIZZAZIONE su membro --------------------------------------
CREATE OR REPLACE FUNCTION public.contabilizza_rapportino_manodopera(_rapportino_id uuid)
RETURNS TABLE(rapportino_costo_id uuid, stato text, warning text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  _me UUID := auth.uid();
  _org UUID;
  _rap public.rapportini%ROWTYPE;
  _tariffa public.personale_costi_orari%ROWTYPE;
  _existing public.rapportini_costi%ROWTYPE;
  _costo_tot NUMERIC(14,2);
  _periodo DATE;
  _modalita TEXT;
  _new_id UUID;
  _warn TEXT := NULL;
BEGIN
  SELECT p.organization_id INTO _org FROM public._rap_current_profile() p;
  IF _org IS NULL THEN RAISE EXCEPTION 'Organizzazione non trovata' USING ERRCODE='42501'; END IF;

  SELECT * INTO _rap FROM public.rapportini WHERE rapportini.id = _rapportino_id;
  IF NOT FOUND OR _rap.organization_id <> _org THEN
    RAISE EXCEPTION 'Rapportino non trovato' USING ERRCODE='42501';
  END IF;
  IF _rap.stato <> 'approvato' THEN
    RAISE EXCEPTION 'Solo rapportini approvati possono essere contabilizzati' USING ERRCODE='22023';
  END IF;

  SELECT * INTO _existing FROM public.rapportini_costi
  WHERE rapportino_id = _rapportino_id AND stato = 'contabilizzato' AND stornato_at IS NULL
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT _existing.id, _existing.stato, 'Già contabilizzato'::TEXT;
    RETURN;
  END IF;

  DELETE FROM public.rapportini_costi
  WHERE rapportino_id = _rapportino_id AND stato = 'non_contabilizzato';

  _periodo := date_trunc('month', _rap.data)::date;

  IF _rap.membro_id IS NOT NULL THEN
    SELECT * INTO _tariffa FROM public.get_costo_orario_membro_at_date(_rap.membro_id, _org, _rap.data);
  END IF;
  IF _tariffa.id IS NULL AND _rap.user_id IS NOT NULL THEN
    SELECT * INTO _tariffa FROM public.get_personale_costo_orario_at_date(_rap.user_id, _org, _rap.data);
  END IF;

  SELECT budget_modalita INTO _modalita FROM public.commesse WHERE id = _rap.commessa_id;

  IF _tariffa.id IS NULL THEN
    INSERT INTO public.rapportini_costi (
      organization_id, rapportino_id, commessa_id, cantiere_id, fase_id, user_id, membro_id,
      ore, costo_orario_applicato, costo_totale, costo_orario_id,
      stato, periodo_riferimento, contabilizzato_by
    ) VALUES (
      _org, _rapportino_id, _rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _rap.user_id, _rap.membro_id,
      _rap.ore, 0, 0, NULL, 'non_contabilizzato', _periodo, _me
    ) RETURNING id INTO _new_id;

    PERFORM public._log_audit(_org, 'rapportino.labor_cost_pending', 'rapportini_costi', _new_id,
      jsonb_build_object('rapportino_id', _rapportino_id, 'motivo', 'tariffa_mancante'));
    RETURN QUERY SELECT _new_id, 'non_contabilizzato'::TEXT,
      'Costo orario non configurato per la persona alla data del rapportino'::TEXT;
    RETURN;
  END IF;

  _costo_tot := ROUND(_rap.ore * _tariffa.costo_orario, 2);

  INSERT INTO public.rapportini_costi (
    organization_id, rapportino_id, commessa_id, cantiere_id, fase_id, user_id, membro_id,
    ore, costo_orario_applicato, costo_totale, costo_orario_id,
    stato, periodo_riferimento, contabilizzato_by
  ) VALUES (
    _org, _rapportino_id, _rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _rap.user_id, _rap.membro_id,
    _rap.ore, _tariffa.costo_orario, _costo_tot, _tariffa.id,
    'contabilizzato', _periodo, _me
  ) RETURNING id INTO _new_id;

  PERFORM public._log_audit(_org, 'rapportino.labor_cost_calculated', 'rapportini_costi', _new_id,
    jsonb_build_object('rapportino_id', _rapportino_id, 'ore', _rap.ore,
      'costo_orario', _tariffa.costo_orario, 'costo_totale', _costo_tot, 'tariffa_id', _tariffa.id));

  IF _modalita = 'analitico' THEN
    PERFORM public._recalculate_labor_budget_voce(_rap.commessa_id, _rap.cantiere_id, _rap.fase_id, _periodo);
    PERFORM public._log_audit(_org, 'rapportino.labor_cost_posted', 'rapportini_costi', _new_id,
      jsonb_build_object('rapportino_id', _rapportino_id));
  ELSE
    _warn := 'Commessa in modalità Budget manuale: costo calcolato non incluso automaticamente';
  END IF;

  RETURN QUERY SELECT _new_id, 'contabilizzato'::TEXT, _warn;
END $$;