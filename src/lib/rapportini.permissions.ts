/**
 * Sprint 5 · Blocco 2 — Permessi semantici UI per rapportini.
 * NB: la UI usa questi helper solo per mostrare/nascondere azioni.
 * La sicurezza autorevole è nelle RPC SECURITY DEFINER.
 */
import type { AppRole } from "@/hooks/use-current-user";

export type RapportinoRow = {
  id: string;
  stato: string;
  user_id: string | null;
  created_by: string | null;
  cantiere_id: string | null;
  archived_at: string | null;
};

export type PermCtx = {
  userId: string | null;
  roles: AppRole[];
  /** true se l'utente ha accesso alla commessa del rapportino */
  canAccessCommessa?: boolean;
  /** true se l'utente è capocantiere del cantiere del rapportino */
  isCapocantiereDi?: boolean;
};

const has = (roles: AppRole[], ...want: AppRole[]) => want.some((r) => roles.includes(r));

function isAuthor(r: RapportinoRow, userId: string | null) {
  return !!userId && (r.user_id === userId || r.created_by === userId);
}

function isAdminExt(roles: AppRole[]) {
  return has(roles, "proprietario", "amministratore", "amministrazione", "ufficio_tecnico", "responsabile_commessa", "capocantiere");
}

/** BOZZA → INVIATO */
export function canSubmitRapportino(r: RapportinoRow, ctx: PermCtx): boolean {
  if (r.archived_at) return false;
  if (r.stato !== "bozza") return false;
  return isAuthor(r, ctx.userId) || isAdminExt(ctx.roles);
}

/** INVIATO → APPROVATO */
export function canApproveRapportino(r: RapportinoRow, ctx: PermCtx): boolean {
  if (r.archived_at) return false;
  if (r.stato !== "inviato") return false;
  const isPropAdmin = has(ctx.roles, "proprietario", "amministratore", "amministrazione");
  // separazione autore/approvatore (salvo prop/admin)
  if (!isPropAdmin && isAuthor(r, ctx.userId)) return false;
  if (isPropAdmin) return true;
  if (has(ctx.roles, "ufficio_tecnico")) return true;
  if (has(ctx.roles, "responsabile_commessa") && ctx.canAccessCommessa) return true;
  if (has(ctx.roles, "capocantiere") && ctx.isCapocantiereDi) return true;
  return false;
}

/** INVIATO → RESPINTO (stessa matrice di approve) */
export function canRejectRapportino(r: RapportinoRow, ctx: PermCtx): boolean {
  if (r.archived_at) return false;
  if (r.stato !== "inviato") return false;
  if (has(ctx.roles, "proprietario", "amministratore", "amministrazione", "ufficio_tecnico")) return true;
  if (has(ctx.roles, "responsabile_commessa") && ctx.canAccessCommessa) return true;
  if (has(ctx.roles, "capocantiere") && ctx.isCapocantiereDi) return true;
  return false;
}

/** RESPINTO → BOZZA */
export function canReopenRejectedRapportino(r: RapportinoRow, ctx: PermCtx): boolean {
  if (r.archived_at) return false;
  if (r.stato !== "respinto") return false;
  return isAuthor(r, ctx.userId) || isAdminExt(ctx.roles);
}

/** Annulla: BOZZA (autore/prop/admin), INVIATO/APPROVATO (solo prop/admin) */
export function canCancelRapportino(r: RapportinoRow, ctx: PermCtx): boolean {
  if (r.archived_at) return false;
  const propAdmin = has(ctx.roles, "proprietario", "amministratore", "amministrazione");
  if (r.stato === "bozza") return isAuthor(r, ctx.userId) || propAdmin;
  if (r.stato === "inviato" || r.stato === "approvato") return propAdmin;
  return false;
}

/** Modificabile via update_rapportino: solo bozza */
export function canEditRapportinoByState(r: RapportinoRow, ctx: PermCtx): boolean {
  if (r.archived_at) return false;
  if (r.stato !== "bozza") return false;
  return isAuthor(r, ctx.userId) || isAdminExt(ctx.roles);
}

/** Archiviabile: bozza/respinto (autore o admin ext); annullato solo prop/admin; inviato/approvato mai */
export function canArchiveRapportinoByState(r: RapportinoRow, ctx: PermCtx): boolean {
  if (r.archived_at) return false;
  const propAdmin = has(ctx.roles, "proprietario", "amministratore", "amministrazione");
  if (r.stato === "inviato" || r.stato === "approvato") return false;
  if (r.stato === "annullato") return propAdmin;
  // bozza | respinto
  return isAuthor(r, ctx.userId) || has(ctx.roles, "proprietario", "amministratore", "amministrazione", "ufficio_tecnico", "responsabile_commessa");
}

export const STATO_LABEL: Record<string, string> = {
  bozza: "Bozza",
  inviato: "Inviato",
  approvato: "Approvato",
  respinto: "Respinto",
  annullato: "Annullato",
};

export const STATO_BADGE_CLASS: Record<string, string> = {
  bozza: "bg-slate-100 text-slate-700 border-slate-300",
  inviato: "bg-blue-100 text-blue-800 border-blue-300",
  approvato: "bg-emerald-100 text-emerald-800 border-emerald-300",
  respinto: "bg-rose-100 text-rose-800 border-rose-300",
  annullato: "bg-zinc-200 text-zinc-700 border-zinc-400",
};
