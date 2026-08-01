/**
 * Modello puro "Membro dell'organizzazione".
 *
 * Un MEMBRO è la persona che lavora per l'impresa: esiste in anagrafica
 * anche se non ha (ancora) un account di accesso al gestionale.
 * Un UTENTE è un account Auth. Il collegamento membro → utente è opzionale
 * e avviene solo quando l'invito viene accettato.
 *
 * Nessun accesso a rete/DB in questo modulo: è testabile in isolamento.
 */

export type AppRole =
  | "proprietario"
  | "amministratore"
  | "ufficio_tecnico"
  | "amministrazione"
  | "responsabile_commessa"
  | "capocantiere"
  | "operaio"
  | "cliente"
  | "fornitore";

export type MemberAccessState =
  | "senza_accesso"
  | "invitato"
  | "attivo"
  | "invito_scaduto"
  | "disabilitato";

export const ACCESS_STATE_LABELS: Record<MemberAccessState, string> = {
  senza_accesso: "Senza accesso",
  invitato: "Invitato",
  attivo: "Accesso attivo",
  invito_scaduto: "Invito scaduto",
  disabilitato: "Accesso disabilitato",
};

/** Ruoli assegnabili a un membro (mai "proprietario"). */
export const ASSIGNABLE_MEMBER_ROLES: AppRole[] = [
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
  "operaio",
  "cliente",
  "fornitore",
];

/** Ruoli che possono gestire l'anagrafica membri. */
export const MEMBER_MANAGER_ROLES: AppRole[] = ["proprietario", "amministratore"];

export function canManageMembers(roles: readonly AppRole[]): boolean {
  return roles.some((r) => MEMBER_MANAGER_ROLES.includes(r));
}

export function canAssignRole(role: AppRole, callerRoles: readonly AppRole[]): boolean {
  if (!ASSIGNABLE_MEMBER_ROLES.includes(role)) return false;
  if (role === "amministratore") return callerRoles.includes("proprietario");
  return canManageMembers(callerRoles);
}

export type MemberLike = {
  nome: string | null;
  cognome?: string | null;
  email?: string | null;
  user_id?: string | null;
  is_active?: boolean | null;
  archived_at?: string | null;
  stato_accesso?: MemberAccessState | null;
};

export function memberFullName(m: MemberLike): string {
  const full = [m.nome, m.cognome].filter((v) => v && String(v).trim()).join(" ").trim();
  return full || m.email || "Senza nome";
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v === "" ? null : v;
}

export type MemberInput = {
  nome: string;
  cognome?: string | null;
  email?: string | null;
  telefono?: string | null;
  ruolo_organizzativo: AppRole;
  qualifica?: string | null;
};

export type ValidationResult = { ok: true; value: MemberInput } | { ok: false; errors: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateMemberInput(
  input: Partial<MemberInput>,
  callerRoles: readonly AppRole[],
): ValidationResult {
  const errors: string[] = [];
  const nome = (input.nome ?? "").trim();
  if (!nome) errors.push("Il nome è obbligatorio");
  if (nome.length > 80) errors.push("Il nome non può superare 80 caratteri");

  const email = normalizeEmail(input.email);
  if (email && !EMAIL_RE.test(email)) errors.push("Email non valida");

  const ruolo = input.ruolo_organizzativo;
  if (!ruolo) {
    errors.push("Il ruolo è obbligatorio");
  } else if (ruolo === "proprietario") {
    errors.push("Il ruolo Proprietario non è assegnabile");
  } else if (!canAssignRole(ruolo, callerRoles)) {
    errors.push("Non sei autorizzato ad assegnare questo ruolo");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      nome,
      cognome: (input.cognome ?? "").trim() || null,
      email,
      telefono: (input.telefono ?? "").trim() || null,
      ruolo_organizzativo: ruolo as AppRole,
      qualifica: (input.qualifica ?? "").trim() || null,
    },
  };
}

/** Un membro può essere invitato solo se ha un'email e non ha già accesso attivo. */
export function canInviteMember(m: MemberLike): boolean {
  if (m.archived_at) return false;
  if (!normalizeEmail(m.email ?? null)) return false;
  return m.stato_accesso !== "attivo" && !m.user_id;
}

/** Un membro senza accesso resta assegnabile finché è attivo e non archiviato. */
export function isAssignableMember(m: MemberLike): boolean {
  return !m.archived_at && m.is_active !== false;
}

/** Stato di accesso derivato, tenendo conto della scadenza dell'invito. */
export function deriveAccessState(
  m: MemberLike,
  invite?: { status: string; expires_at: string } | null,
  now: Date = new Date(),
): MemberAccessState {
  if (m.user_id) return m.is_active === false ? "disabilitato" : "attivo";
  if (invite && invite.status === "pending") {
    return new Date(invite.expires_at).getTime() < now.getTime() ? "invito_scaduto" : "invitato";
  }
  if (m.stato_accesso === "invito_scaduto") return "invito_scaduto";
  return "senza_accesso";
}
