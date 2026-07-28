-- Sprint 5 Blocco 3.4 — Hardening GRANT/RLS su tabelle costi

-- =========================================================================
-- personale_costi_orari
-- =========================================================================
REVOKE ALL ON public.personale_costi_orari FROM anon;
REVOKE ALL ON public.personale_costi_orari FROM authenticated;

-- Serve la SELECT diretta: listPersonaleCostiOrari legge via client authenticated
-- La RLS pco_select limita già alle sole role admin.
GRANT SELECT ON public.personale_costi_orari TO authenticated;

-- Ripristina/assicura privilegi service_role (bypassa RLS)
GRANT ALL ON public.personale_costi_orari TO service_role;

-- =========================================================================
-- rapportini_costi
-- =========================================================================
REVOKE ALL ON public.rapportini_costi FROM anon;
REVOKE ALL ON public.rapportini_costi FROM authenticated;

-- Nessuna GRANT ad authenticated: le letture avvengono via server function
-- con supabaseAdmin + gate di ruolo (proprietario/amministratore/amministrazione).
GRANT ALL ON public.rapportini_costi TO service_role;

-- Sostituzione policy rc_select: gate stretto sui soli ruoli economici admin
DROP POLICY IF EXISTS rc_select ON public.rapportini_costi;

CREATE POLICY rc_select_admin_only
  ON public.rapportini_costi
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_organization_id()
    AND public.has_any_role(
      organization_id,
      ARRAY['proprietario','amministratore','amministrazione']::public.app_role[]
    )
  );