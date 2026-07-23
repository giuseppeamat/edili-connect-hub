import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

const INTERNAL_ROLES: AppRole[] = [
  "proprietario",
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
  "operaio",
];

/**
 * Centralized hook to read the current user's role(s) in their organization.
 * The source of truth for authorization is the database (RLS). This hook is
 * ONLY used to hide/disable UI affordances — never to gate security.
 */
export function useCurrentRole() {
  const q = useQuery({
    queryKey: ["current-role"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { roles: [] as AppRole[], organizationId: null as string | null };
      const { data } = await supabase
        .from("user_roles")
        .select("role, organization_id")
        .eq("user_id", u.user.id);
      return {
        roles: (data ?? []).map((r) => r.role as AppRole),
        organizationId: data?.[0]?.organization_id ?? null,
      };
    },
  });

  const roles = q.data?.roles ?? [];
  const has = (...allowed: AppRole[]) => allowed.some((r) => roles.includes(r));

  return {
    roles,
    organizationId: q.data?.organizationId ?? null,
    isLoading: q.isLoading,
    has,
    isProprietario: has("proprietario"),
    isAdmin: has("proprietario", "amministratore"),
    canManageAnagrafiche: has("proprietario", "amministratore", "ufficio_tecnico", "amministrazione"),
    canEditPreventivi: has("proprietario", "amministratore", "ufficio_tecnico"),
    canDeleteBusinessData: has("proprietario", "amministratore"),
    canReadAudit: has("proprietario", "amministratore", "amministrazione"),
    isInternal: INTERNAL_ROLES.some((r) => roles.includes(r)),
  };
}
