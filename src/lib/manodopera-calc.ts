/**
 * Sprint 5 · Blocco 4 — regole pure di calcolo manodopera.
 * Speculari alla logica SQL (contabilizza_rapportino_manodopera /
 * _recalculate_labor_budget_voce): servono per i test automatici e per
 * eventuali anteprime lato UI. L'autorità resta il database.
 */

export type RapportinoCosto = {
  id: string;
  ore: number;
  costo_orario_applicato: number;
  costo_totale: number;
  stato: "contabilizzato" | "non_contabilizzato" | "stornato";
};

/** Costo di una contabilizzazione: ore × tariffa, arrotondato al centesimo. */
export function costoManodopera(ore: number, tariffa: number): number {
  return Math.round(ore * tariffa * 100) / 100;
}

/**
 * Chiave di aggregazione della voce di Budget generata dai rapportini:
 * commessa + cantiere + fase + mese di competenza.
 */
export function chiaveAggregazione(r: {
  commessa_id: string;
  cantiere_id?: string | null;
  fase_id?: string | null;
  data: string;
}): string {
  const periodo = `${r.data.slice(0, 7)}-01`;
  return [r.commessa_id, r.cantiere_id ?? "-", r.fase_id ?? "-", periodo].join("|");
}

/** Importo sostenuto della voce: somma delle sole righe attive (non stornate). */
export function importoSostenuto(costi: RapportinoCosto[]): number {
  const tot = costi
    .filter((c) => c.stato === "contabilizzato")
    .reduce((s, c) => s + Number(c.costo_totale ?? 0), 0);
  return Math.round(tot * 100) / 100;
}

/** Storno idempotente: una riga già stornata non viene sottratta due volte. */
export function applicaStorno(costi: RapportinoCosto[], rigaId: string): RapportinoCosto[] {
  return costi.map((c) =>
    c.id === rigaId && c.stato === "contabilizzato" ? { ...c, stato: "stornato" as const } : c,
  );
}

/** La contabilizzazione è possibile solo con una tariffa valida alla data. */
export function esitoContabilizzazione(tariffa: number | null | undefined) {
  return tariffa === null || tariffa === undefined
    ? { stato: "non_contabilizzato" as const, warning: "Non è presente una tariffa valida per la data del rapportino." }
    : { stato: "contabilizzato" as const, warning: null };
}
