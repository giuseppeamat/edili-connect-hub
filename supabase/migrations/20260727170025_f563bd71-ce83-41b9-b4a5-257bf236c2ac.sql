-- Ensure only SELECT for authenticated users, nothing for anon, full for service_role.
REVOKE ALL ON public.rapportini FROM PUBLIC;
REVOKE ALL ON public.rapportini FROM anon;
REVOKE ALL ON public.rapportini FROM authenticated;
GRANT SELECT ON public.rapportini TO authenticated;
GRANT ALL ON public.rapportini TO service_role;