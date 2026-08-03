import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isAccessAllowed } from "@/lib/access-guard";


export type AppRole = Database["public"]["Enums"]["app_role"];

export type CurrentUserData = {
  userId: string;
  email: string | null;
  profile: {
    id: string;
    organization_id: string | null;
    nome: string | null;
    cognome: string | null;
    email: string | null;
    telefono: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  organization: { id: string; nome: string | null } | null;
  roles: AppRole[];
  accessAllowed: boolean;
  memberId: string | null;
  statoAccesso: string | null;
};


const ROLE_PRIORITY: AppRole[] = [
  "proprietario",
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
  "operaio",
  "cliente",
  "fornitore",
];

const INTERNAL: AppRole[] = [
  "proprietario",
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
  "operaio",
];

/**
 * Centralized loader for current auth user + profile + organization + roles.
 * Cached under a single query key so pages don't refetch it independently.
 */
export function useCurrentUser() {
  const q = useQuery<CurrentUserData | null>({
    queryKey: ["current-user"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;

      // 1) profilo → 2) organizzazione corrente → 3) ruoli di QUELLA organizzazione
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, organization_id, nome, cognome, email, telefono, is_active, created_at, updated_at, organizations(id, nome)")
        .eq("id", u.user.id)
        .maybeSingle();

      const orgId = profile?.organization_id ?? null;
      const isActive = (profile as any)?.is_active !== false;

      // Sorgente autorevole dello stato accesso: organization_members.
      let member: { id: string; stato_accesso: string | null; archived_at: string | null } | null = null;
      if (orgId) {
        const { data: m } = await supabase
          .from("organization_members")
          .select("id, stato_accesso, archived_at")
          .eq("organization_id", orgId)
          .eq("user_id", u.user.id)
          .maybeSingle();
        member = (m as any) ?? null;
      }
      const accessAllowed = isAccessAllowed({
        profileActive: (profile as any)?.is_active,
        statoAccesso: member?.stato_accesso ?? null,
        archivedAt: member?.archived_at ?? null,
      });

      let roles: AppRole[] = [];
      if (orgId && isActive && accessAllowed) {
        const { data: rolesRows } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", u.user.id)
          .eq("organization_id", orgId);
        roles = ((rolesRows ?? []) as { role: AppRole }[]).map((r) => r.role);
      }


      const organization = (profile as any)?.organizations
        ? { id: (profile as any).organizations.id, nome: (profile as any).organizations.nome }
        : null;

      return {
        userId: u.user.id,
        email: u.user.email ?? null,
        profile: profile
          ? {
              id: profile.id,
              organization_id: profile.organization_id,
              nome: profile.nome,
              cognome: profile.cognome,
              email: profile.email,
              telefono: profile.telefono,
              created_at: profile.created_at,
              updated_at: profile.updated_at,
            }
          : null,
        organization,
        roles,
        accessAllowed,
        memberId: member?.id ?? null,
        statoAccesso: (member?.stato_accesso as any) ?? null,
      };

    },

  });

  const data = q.data ?? null;
  const roles = data?.roles ?? [];
  const primaryRole = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
  const has = (...allowed: AppRole[]) => allowed.some((r) => roles.includes(r));

  return {
    isLoading: q.isLoading,
    error: q.error as Error | null,
    data,
    userId: data?.userId ?? null,
    email: data?.email ?? null,
    profile: data?.profile ?? null,
    organization: data?.organization ?? null,
    organizationId: data?.profile?.organization_id ?? null,
    roles,
    accessAllowed: data ? data.accessAllowed : true,
    accessDisabled: data ? !data.accessAllowed : false,
    statoAccesso: data?.statoAccesso ?? null,
    memberId: data?.memberId ?? null,
    primaryRole,
    has,


    isProprietario: has("proprietario"),
    isAdmin: has("proprietario", "amministratore"),
    canManageAnagrafiche: has("proprietario", "amministratore", "ufficio_tecnico", "amministrazione"),
    canEditPreventivi: has("proprietario", "amministratore", "ufficio_tecnico"),
    canDeleteBusinessData: has("proprietario", "amministratore"),
    canReadAudit: has("proprietario", "amministratore", "amministrazione"),
    isInternal: INTERNAL.some((r) => roles.includes(r)),
    // ===== Commesse (Sprint 4 Blocco 3) =====
    canViewCommesse: INTERNAL.some((r) => roles.includes(r)),
    canCreateCommesse: has("proprietario", "amministratore", "ufficio_tecnico"),
    canEditCommesse: has("proprietario", "amministratore", "ufficio_tecnico", "responsabile_commessa"),
    canManageCommessaState: has("proprietario", "amministratore", "ufficio_tecnico", "responsabile_commessa"),
    canCloseCommesse: has("proprietario", "amministratore"),
    canReopenCommesse: has("proprietario", "amministratore"),
    canArchiveCommesse: has("proprietario", "amministratore"),
    canAssignResponsabile: has("proprietario", "amministratore", "ufficio_tecnico"),
    canViewCommessaEconomics: has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico"),
    // ===== Budget (Sprint 4 Blocco 6c) =====
    canViewCommessaBudget: has(
      "proprietario", "amministratore", "ufficio_tecnico", "amministrazione", "responsabile_commessa",
    ),
    canEditCommessaBudget: has(
      "proprietario", "amministratore", "ufficio_tecnico", "amministrazione", "responsabile_commessa",
    ),
    canImportCommessaBudget: has("proprietario", "amministratore", "ufficio_tecnico"),
    canManageCommessaBaseline: has("proprietario", "amministratore"),
    canEditManualCommessaBudget: has(
      "proprietario", "amministratore", "amministrazione", "ufficio_tecnico",
    ),
    canChangeCommessaBudgetMode: has("proprietario", "amministratore", "ufficio_tecnico"),
    // ===== Personale / Rapportini =====
    canViewPersonnelHourlyCost: has("proprietario", "amministratore", "amministrazione"),
    canApproveRapportino: has(
      "proprietario", "amministratore", "ufficio_tecnico", "responsabile_commessa", "capocantiere",
    ),

  };
}

export const ROLE_LABELS: Record<AppRole, string> = {
  proprietario: "Proprietario",
  amministratore: "Amministratore",
  ufficio_tecnico: "Ufficio Tecnico",
  amministrazione: "Amministrazione",
  responsabile_commessa: "Responsabile Commessa",
  capocantiere: "Capocantiere",
  operaio: "Operaio",
  cliente: "Cliente",
  fornitore: "Fornitore",
};
