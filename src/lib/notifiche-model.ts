/**
 * Sprint 8 — Modello puro delle Notifiche operative.
 * Nessun accesso a rete o Supabase: solo regole pure e testabili.
 */

export type Severita = "info" | "attenzione" | "critica";

export type NotificaDTO = {
  id: string;
  tipo: string;
  severita: Severita;
  titolo: string;
  messaggio: string | null;
  entity_type: string | null;
  entity_id: string | null;
  route: string | null;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};

export const SEVERITA_ORDER: Record<Severita, number> = {
  critica: 0,
  attenzione: 1,
  info: 2,
};

export const SEVERITA_LABELS: Record<Severita, string> = {
  info: "Informazione",
  attenzione: "Attenzione",
  critica: "Critica",
};

/** Classi token-based (mai colore hardcoded). */
export const SEVERITA_BADGE_VARIANT: Record<Severita, "secondary" | "outline" | "destructive"> = {
  info: "secondary",
  attenzione: "outline",
  critica: "destructive",
};

export function isSeverita(v: unknown): v is Severita {
  return v === "info" || v === "attenzione" || v === "critica";
}

export function normalizeSeverita(v: unknown): Severita {
  return isSeverita(v) ? v : "info";
}

export const TIPI_NOTIFICA = [
  "rapportino_inviato_da_approvare",
  "rapportino_respinto",
  "rapportino_approvato",
  "rapportino_annullato",
  "rapportino_senza_tariffa",
  "documento_scaduto",
  "documento_in_scadenza_7",
  "documento_in_scadenza_30",
  "documento_versione_caricata",
  "commessa_sospesa",
  "commessa_scadenza_superata",
  "budget_superato",
  "margine_negativo",
  "preventivo_inviato_da_seguire",
  "preventivo_in_scadenza",
  "preventivo_accettato_non_convertito",
  "attivita_assegnata",
  "attivita_in_scadenza",
  "attivita_scaduta",
] as const;

export type TipoNotifica = (typeof TIPI_NOTIFICA)[number];

export const TIPO_LABELS: Record<string, string> = {
  rapportino_inviato_da_approvare: "Rapportino da approvare",
  rapportino_respinto: "Rapportino respinto",
  rapportino_approvato: "Rapportino approvato",
  rapportino_annullato: "Rapportino annullato",
  rapportino_senza_tariffa: "Tariffa oraria mancante",
  documento_scaduto: "Documento scaduto",
  documento_in_scadenza_7: "Documento in scadenza (7 gg)",
  documento_in_scadenza_30: "Documento in scadenza (30 gg)",
  documento_versione_caricata: "Nuova versione documento",
  commessa_sospesa: "Commessa sospesa",
  commessa_scadenza_superata: "Scadenza commessa superata",
  budget_superato: "Budget superato",
  margine_negativo: "Margine negativo",
  preventivo_inviato_da_seguire: "Preventivo da seguire",
  preventivo_in_scadenza: "Preventivo in scadenza",
  preventivo_accettato_non_convertito: "Preventivo da convertire",
  attivita_assegnata: "Attività assegnata",
  attivita_in_scadenza: "Attività in scadenza",
  attivita_scaduta: "Attività scaduta",
};

export function tipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] ?? tipo;
}

export const ENTITY_LABELS: Record<string, string> = {
  rapportino: "Rapportino",
  documento: "Documento",
  commessa: "Commessa",
  preventivo: "Preventivo",
  crm_attivita: "Attività",
};

export function entityLabel(entity?: string | null): string {
  if (!entity) return "—";
  return ENTITY_LABELS[entity] ?? entity;
}

/** Route ammesse: prefissi realmente esistenti nell'app. */
const ROUTE_PREFIXES = [
  "/rapportini",
  "/commesse",
  "/documenti",
  "/preventivi",
  "/clienti",
  "/costi-personale",
  "/scadenziario",
];

/** Una route è valida solo se interna e su un prefisso noto. */
export function isRouteValida(route?: string | null): boolean {
  if (!route) return false;
  if (!route.startsWith("/")) return false;
  if (route.startsWith("//")) return false;
  return ROUTE_PREFIXES.some((p) => route === p || route.startsWith(p + "/"));
}

export function safeRoute(route?: string | null): string | null {
  return isRouteValida(route) ? (route as string) : null;
}

export function isUnread(n: Pick<NotificaDTO, "read_at">): boolean {
  return n.read_at === null;
}

/** Badge: massimo "99+". */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.trunc(count));
}

/** Tempo relativo in italiano. */
export function tempoRelativo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${h === 1 ? "ora" : "ore"} fa`;
  const g = Math.floor(h / 24);
  if (g < 30) return `${g} ${g === 1 ? "giorno" : "giorni"} fa`;
  const m = Math.floor(g / 30);
  if (m < 12) return `${m} ${m === 1 ? "mese" : "mesi"} fa`;
  const a = Math.floor(m / 12);
  return `${a} ${a === 1 ? "anno" : "anni"} fa`;
}

/** Chiave dedupe canonica (mirror della regola SQL). */
export function dedupeKey(tipo: string, scope: string, destinatario: string): string {
  return `${tipo}:${scope}:${destinatario}`;
}

/** Ordinamento di default: non lette prima, poi severità, poi più recenti. */
export function sortNotifiche<T extends NotificaDTO>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ua = isUnread(a) ? 0 : 1;
    const ub = isUnread(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const sa = SEVERITA_ORDER[normalizeSeverita(a.severita)];
    const sb = SEVERITA_ORDER[normalizeSeverita(b.severita)];
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// Messaggi UX (Fase 19)
export const ERR_LOAD = "Non è stato possibile caricare le notifiche.";
export const ERR_UPDATE = "Non è stato possibile aggiornare la notifica.";
export const ERR_ENTITY_GONE = "L'elemento collegato non è più disponibile.";
export const ERR_FORBIDDEN = "Non sei autorizzato a visualizzare questa notifica.";
export const ERR_CONFLICT = "La notifica è già stata aggiornata.";
