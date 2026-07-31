/**
 * Sprint 6 — Hardening dashboard.
 * Livello di autorizzazione della Dashboard, isolato e testabile:
 * risoluzione del contesto tenant (organization_id SEMPRE derivato dal profilo,
 * mai dal client) e calcolo delle capability per ruolo.
 */

export const ECON_ROLES = [
  "proprietario",
  "amministratore",
  "amministrazione",
  "ufficio_tecnico",
  "responsabile_commessa",
];
export const APPROVER_ROLES = [
  "proprietario",
  "amministratore",
  "ufficio_tecnico",
  "responsabile_commessa",
  "capocantiere",
];
export const AUDIT_ROLES = ["proprietario", "amministratore", "amministrazione"];
export const COSTI_ROLES = ["proprietario", "amministratore", "amministrazione"];

export const hasAnyRole = (roles: string[], allowed: string[]) =>
  roles.some((r) => allowed.includes(r));

export type DashboardCapabilities = {
  canViewEconomics: boolean;
  canApprove: boolean;
  canReadAudit: boolean;
  canReadCosti: boolean;
};

export function capabilitiesFor(roles: string[]): DashboardCapabilities {
  return {
    canViewEconomics: hasAnyRole(roles, ECON_ROLES),
    canApprove: hasAnyRole(roles, APPROVER_ROLES),
    canReadAudit: hasAnyRole(roles, AUDIT_ROLES),
    canReadCosti: hasAnyRole(roles, COSTI_ROLES),
  };
}

/** Colonne selezionate sulle commesse: mai colonne economiche senza permesso. */
export function commesseSelect(canEcon: boolean): string {
  const base =
    "id, codice, denominazione, stato, avanzamento_pct, data_fine_prevista, responsabile_id, archived_at";
  return canEcon
    ? "id, codice, denominazione, stato, avanzamento_pct, data_fine_prevista, responsabile_id, costi_sostenuti, costi_previsti, budget_costi, ricavi_previsti, importo, margine_previsto, archived_at"
    : base;
}

export type DashboardContext = { organizationId: string; roles: string[] };

/**
 * Deriva tenant e ruoli dell'utente autenticato. Nessun input dal client.
 * Il client `supabase` è quello RLS-scoped della middleware.
 */
export async function resolveDashboardContext(
  supabase: any,
  userId: string,
): Promise<DashboardContext> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("organization_id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  if (prof.is_active === false) throw new Error("Utente disattivato");
  const { data: rr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", prof.organization_id);
  return {
    organizationId: prof.organization_id as string,
    roles: (rr ?? []).map((r: any) => String(r.role)),
  };
}
