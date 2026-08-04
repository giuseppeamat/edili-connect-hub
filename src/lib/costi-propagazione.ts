/**
 * Propagazione dei costi del personale (manodopera) agli aggregati economici.
 *
 * Sorgente autorevole unica: il ledger `rapportini_costi` (una riga per ogni
 * riga di `rapportini_personale` contabilizzata, collegata da
 * `rapportino_personale_id`). Le righe stornate/annullate sono escluse a monte
 * dalla RPC `get_costi_manodopera`.
 *
 * Regola anti-doppio-conteggio: quando la commessa è in modalità budget
 * "analitico" il costo di manodopera è già confluito nella voce di budget
 * "Manodopera interna" e quindi in `commesse.costi_sostenuti`
 * (`gia_nel_budget = true`): in quel caso NON va sommato di nuovo.
 */

export type CostoManodoperaRow = {
  commessa_id: string;
  cantiere_id: string | null;
  costo: number | string | null;
  righe?: number | null;
  rapportini?: number | null;
  persone?: number | null;
  gia_nel_budget?: boolean | null;
};

export type ManodoperaPendente = { righe: number; rapportini: number; persone: number };

const n = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Totale manodopera contabilizzata per commessa (indipendente dal budget). */
export function manodoperaPerCommessa(rows: CostoManodoperaRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows ?? []) {
    if (!r?.commessa_id) continue;
    out[r.commessa_id] = round2((out[r.commessa_id] ?? 0) + n(r.costo));
  }
  return out;
}

/** Totale manodopera per cantiere di una commessa (null = senza cantiere). */
export function manodoperaPerCantiere(
  rows: CostoManodoperaRow[],
  commessaId?: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows ?? []) {
    if (commessaId && r.commessa_id !== commessaId) continue;
    const k = r.cantiere_id ?? "__senza_cantiere__";
    out[k] = round2((out[k] ?? 0) + n(r.costo));
  }
  return out;
}

/**
 * Quota di manodopera da aggiungere agli aggregati: solo le righe non già
 * incluse nel budget analitico. Se `commessaIds` è passato, filtra su quelle.
 */
export function manodoperaDaSommare(
  rows: CostoManodoperaRow[],
  commessaIds?: readonly string[],
): number {
  const set = commessaIds ? new Set(commessaIds) : null;
  let tot = 0;
  for (const r of rows ?? []) {
    if (r?.gia_nel_budget) continue;
    if (set && !set.has(r.commessa_id)) continue;
    tot += n(r.costo);
  }
  return round2(tot);
}

/** Costi sostenuti totali = colonna commessa + manodopera non ancora inclusa. */
export function costiSostenutiTotali(
  commesse: { id: string; costi_sostenuti?: number | string | null }[],
  rows: CostoManodoperaRow[],
): number {
  const base = (commesse ?? []).reduce((s, c) => s + n(c.costi_sostenuti), 0);
  return round2(base + manodoperaDaSommare(rows, (commesse ?? []).map((c) => c.id)));
}

/** Costi sostenuti di una singola commessa, manodopera inclusa una sola volta. */
export function costiSostenutiCommessa(
  commessa: { id: string; costi_sostenuti?: number | string | null },
  rows: CostoManodoperaRow[],
): number {
  return costiSostenutiTotali([commessa], rows);
}

/** KPI "manodopera da contabilizzare" normalizzato. */
export function normalizzaPendente(row: unknown): ManodoperaPendente {
  const r = (Array.isArray(row) ? row[0] : row) as Record<string, unknown> | null;
  return {
    righe: n(r?.["righe"]),
    rapportini: n(r?.["rapportini"]),
    persone: n(r?.["persone"]),
  };
}
