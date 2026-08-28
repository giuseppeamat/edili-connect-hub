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
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, is_active")
        .eq("id", u.user.id)
        .maybeSingle();
      const orgId = profile?.organization_id ?? null;
      if (!orgId || (profile as any)?.is_active === false) {
        return { roles: [] as AppRole[], organizationId: orgId };
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("organization_id", orgId);
      return {
        roles: (data ?? []).map((r) => r.role as AppRole),
        organizationId: orgId,
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
    isAdmin: has("proprietario", "amministratore", "amministrazione"),
    canManageAnagrafiche: has("proprietario", "amministratore", "ufficio_tecnico", "amministrazione"),
    canEditPreventivi: has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico"),
    canDeleteBusinessData: has("proprietario", "amministratore", "amministrazione"),
    canReadAudit: has("proprietario", "amministratore", "amministrazione"),
    isInternal: INTERNAL_ROLES.some((r) => roles.includes(r)),
    // ===== Commesse (Sprint 4 Blocco 3) =====
    canViewCommesse: INTERNAL_ROLES.some((r) => roles.includes(r)),
    canCreateCommesse: has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico", "responsabile_commessa", "capocantiere"),
    canEditCommesse: has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico", "responsabile_commessa", "capocantiere"),
    canManageCommessaState: has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico", "responsabile_commessa", "capocantiere"),
    canCloseCommesse: has("proprietario", "amministratore", "amministrazione"),
    canReopenCommesse: has("proprietario", "amministratore", "amministrazione"),
    canArchiveCommesse: has("proprietario", "amministratore", "amministrazione"),
    canAssignResponsabile: has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico"),
    canViewCommessaEconomics: has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico"),
  };
}

