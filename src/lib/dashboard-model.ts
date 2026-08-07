/**
 * Sprint 6 — Dashboard operativa.
 * Modulo puro (nessun accesso a rete/DB): logica di periodo, criticità e
 * ordinamento. Testabile in isolamento.
 */

export type PeriodoKey = "oggi" | "7" | "30" | "mese" | "custom";

export const PERIODO_LABEL: Record<PeriodoKey, string> = {
  oggi: "Oggi",
  "7": "Ultimi 7 giorni",
  "30": "Ultimi 30 giorni",
  mese: "Mese corrente",
  custom: "Personalizzato",
};

export function isPeriodo(v: unknown): v is PeriodoKey {
  return v === "oggi" || v === "7" || v === "30" || v === "mese" || v === "custom";
}

/** True se la stringa è una data valida in formato YYYY-MM-DD. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Intervallo [from, to] in formato YYYY-MM-DD per il periodo scelto. */
export function periodRange(
  periodo: PeriodoKey,
  today = new Date(),
  custom?: { from?: unknown; to?: unknown },
): { from: string; to: string } {
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const to = iso(base);
  if (periodo === "custom") {
    const cFrom = isIsoDate(custom?.from) ? custom!.from : null;
    const cTo = isIsoDate(custom?.to) ? custom!.to : null;
    if (cFrom && cTo) return cFrom <= cTo ? { from: cFrom, to: cTo } : { from: cTo, to: cFrom };
    if (cFrom) return { from: cFrom, to: cFrom > to ? cFrom : to };
    if (cTo) return { from: cTo, to: cTo };
    return { from: to, to };
  }
  if (periodo === "oggi") return { from: to, to };
  if (periodo === "mese") {
    return { from: iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1))), to };
  }
  const days = periodo === "7" ? 6 : 29;
  const from = new Date(base);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: iso(from), to };
}

/** Giorni di differenza (positivi = nel futuro) fra una data ISO e oggi. */
export function daysUntil(dateIso: string | null | undefined, today = new Date()): number | null {
  if (!dateIso) return null;
  const d = Date.parse(`${String(dateIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d)) return null;
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d - base) / 86_400_000);
}

export type Severity = "critico" | "attenzione" | "info";

export type CommessaAlert = { code: string; label: string; severity: Severity };

export type CommessaAlertInput = {
  stato?: string | null;
  data_fine_prevista?: string | null;
  avanzamento_pct?: number | string | null;
  responsabile_id?: string | null;
  costi_sostenuti?: number | string | null;
  costi_previsti?: number | string | null;
  budget_costi?: number | string | null;
};

const ATTIVE = new Set(["pianificata", "in_corso", "sospesa"]);

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Regole di criticità di una commessa (pure, riusabili lato server e client). */
export function commessaAlerts(c: CommessaAlertInput, today = new Date()): CommessaAlert[] {
  const out: CommessaAlert[] = [];
  const stato = c.stato ?? "";
  if (!ATTIVE.has(stato)) return out;

  const gg = daysUntil(c.data_fine_prevista, today);
  const avanz = n(c.avanzamento_pct);
  if (gg !== null && gg < 0) {
    out.push({ code: "scaduta", label: `In ritardo di ${Math.abs(gg)} gg`, severity: "critico" });
  } else if (gg !== null && gg <= 14) {
    out.push({ code: "in_scadenza", label: `Consegna fra ${gg} gg`, severity: "attenzione" });
  }
  if (gg !== null && gg >= 0 && gg <= 30 && avanz < 70) {
    out.push({
      code: "avanzamento_basso",
      label: `Avanzamento ${avanz.toFixed(0)}%`,
      severity: "attenzione",
    });
  }
  if (stato === "sospesa") {
    out.push({ code: "sospesa", label: "Commessa sospesa", severity: "attenzione" });
  }
  if (!c.responsabile_id) {
    out.push({ code: "senza_responsabile", label: "Responsabile non assegnato", severity: "info" });
  }

  const previsti = n(c.costi_previsti) || n(c.budget_costi);
  const sostenuti = n(c.costi_sostenuti);
  if (previsti > 0) {
    const ratio = sostenuti / previsti;
    if (ratio > 1) {
      out.push({
        code: "budget_superato",
        label: `Costi oltre budget (${(ratio * 100).toFixed(0)}%)`,
        severity: "critico",
      });
    } else if (ratio >= 0.9) {
      out.push({
        code: "budget_vicino",
        label: `Budget al ${(ratio * 100).toFixed(0)}%`,
        severity: "attenzione",
      });
    }
  }
  return out;
}

const SEV_RANK: Record<Severity, number> = { critico: 0, attenzione: 1, info: 2 };

export function worstSeverity(alerts: CommessaAlert[]): Severity | null {
  if (!alerts.length) return null;
  return alerts.slice().sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])[0].severity;
}

/** Ordina le commesse per gravità (critiche prima) e poi per numero di alert. */
export function sortByCriticita<T extends { alerts: CommessaAlert[] }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const sa = worstSeverity(a.alerts);
    const sb = worstSeverity(b.alerts);
    const ra = sa ? SEV_RANK[sa] : 99;
    const rb = sb ? SEV_RANK[sb] : 99;
    if (ra !== rb) return ra - rb;
    return b.alerts.length - a.alerts.length;
  });
}

/** Etichette leggibili per gli eventi di audit mostrati nel feed attività. */
export function auditLabel(action: string): string {
  const map: Record<string, string> = {
    "rapportino.created": "Rapportino creato",
    "rapportino.submitted": "Rapportino inviato",
    "rapportino.approved": "Rapportino approvato",
    "rapportino.rejected": "Rapportino respinto",
    "rapportino.cancelled": "Rapportino annullato",
    "rapportino.archived": "Rapportino archiviato",
    "rapportino.labor_cost_posted": "Manodopera contabilizzata",
    "rapportino.labor_cost_reversed": "Manodopera stornata",
    "commessa.state_changed": "Stato commessa aggiornato",
    "commessa.closed": "Commessa chiusa",
    "commessa.reopened": "Commessa riaperta",
    "commessa.responsabile_changed": "Responsabile commessa aggiornato",
    "commessa.budget_voce_created": "Voce di budget creata",
    change_stato: "Stato preventivo aggiornato",
    create_preventivo: "Preventivo creato",
    convert_to_commessa: "Preventivo convertito in commessa",
    "cliente.created": "Cliente creato",
    "cliente.updated": "Cliente aggiornato",
    "cantiere.created": "Cantiere creato",
    "fase.created": "Fase creata",
    "attivita.created": "Attività CRM creata",
  };
  return map[action] ?? action.replace(/[._]/g, " ");
}

/** True se la data (YYYY-MM-DD) ricade nell'intervallo inclusivo del periodo. */
export function inPeriodo(
  dateIso: string | null | undefined,
  range: { from: string; to: string },
): boolean {
  if (!dateIso) return false;
  const d = String(dateIso).slice(0, 10);
  return d >= range.from && d <= range.to;
}

/** Conta i rapportini in stato "inviato" (in attesa di approvazione). */
export function countDaApprovare(rows: Array<{ stato?: string | null }>): number {
  return rows.filter((r) => r.stato === "inviato").length;
}

/** Classifica un documento con scadenza rispetto a oggi. */
export function docScadenzaStato(
  dataScadenza: string | null | undefined,
  today = new Date(),
): "scaduto" | "in_scadenza" | "ok" | null {
  const gg = daysUntil(dataScadenza, today);
  if (gg === null) return null;
  if (gg < 0) return "scaduto";
  if (gg <= 30) return "in_scadenza";
  return "ok";
}
