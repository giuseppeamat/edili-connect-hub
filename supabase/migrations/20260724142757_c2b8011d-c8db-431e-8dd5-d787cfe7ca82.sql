REVOKE ALL ON public.commessa_budget_voci FROM anon;
REVOKE ALL ON public.commessa_budget_voci FROM PUBLIC;
GRANT SELECT ON public.commessa_budget_voci TO authenticated;
GRANT ALL ON public.commessa_budget_voci TO service_role;