/**
 * Personale multiplo nei rapportini — regole pure.
 * Speculari alla logica SQL (save_rapportino_personale /
 * _contabilizza_riga_personale). L'autorità resta il database.
 */

export type StatoContabilizzazione =
  | "da_contabilizzare"
  | "contabilizzato"
  | "tariffa_mancante"
  | "conflitto_tariffa"
  | "annullato";

export type RigaPersonaleInput = {
  membro_id: string;
  ore: number;
  nota?: string | null;
};

export type RigaPersonale = {
  id: string;
  membro_id: string;
  membro_nome: string;
  membro_qualifica?: string | null;
  ore: number;
  nota?: string | null;
  stato_contabilizzazione: StatoContabilizzazione;
  errore_contabilizzazione?: string | null;
  tariffa_oraria_congelata?: number | null;
  costo_congelato?: number | null;
  annullato_at?: string | null;
};

export type MembroSelezionabile = {
  id: string;
  nome?: string | null;
  cognome?: string | null;
  archived_at?: string | null;
  is_active?: boolean | null;
  organization_id?: string | null;
};

export const STATO_PERSONALE_LABEL: Record<StatoContabilizzazione, string> = {
  da_contabilizzare: "Da contabilizzare",
  contabilizzato: "Contabilizzato",
  tariffa_mancante: "Tariffa mancante",
  conflitto_tariffa: "Conflitto tariffa",
  annullato: "Annullato",
};

export const MAX_ORE_PERSONA = 24;

/** Costo di una riga: ore × tariffa arrotondato al centesimo. */
export function costoRiga(ore: number, tariffa: number | null | undefined): number | null {
  if (tariffa === null || tariffa === undefined) return null;
  return Math.round(ore * tariffa * 100) / 100;
}

/** Righe attive = non annullate. */
export function righeAttive<T extends { annullato_at?: string | null; stato_contabilizzazione?: string }>(
  righe: T[],
): T[] {
  return righe.filter((r) => !r.annullato_at && r.stato_contabilizzazione !== "annullato");
}

export type TotaliPersonale = {
  persone: number;
  ore_totali: number;
  costo_totale: number;
  contabilizzate: number;
  tariffa_mancante: number;
  conflitto_tariffa: number;
};

/** Totali del rapportino: righe annullate escluse, costo dalle sole contabilizzate. */
export function totaliPersonale(righe: RigaPersonale[]): TotaliPersonale {
  const attive = righeAttive(righe);
  const ore = attive.reduce((s, r) => s + Number(r.ore ?? 0), 0);
  const costo = attive
    .filter((r) => r.stato_contabilizzazione === "contabilizzato")
    .reduce((s, r) => s + Number(r.costo_congelato ?? 0), 0);
  return {
    persone: attive.length,
    ore_totali: Math.round(ore * 100) / 100,
    costo_totale: Math.round(costo * 100) / 100,
    contabilizzate: attive.filter((r) => r.stato_contabilizzazione === "contabilizzato").length,
    tariffa_mancante: attive.filter((r) => r.stato_contabilizzazione === "tariffa_mancante").length,
    conflitto_tariffa: attive.filter((r) => r.stato_contabilizzazione === "conflitto_tariffa").length,
  };
}

/** Un membro è selezionabile se appartiene alla org, è attivo e non archiviato. */
export function membroSelezionabile(m: MembroSelezionabile, organizationId?: string): boolean {
  if (!m?.id) return false;
  if (m.archived_at) return false;
  if (m.is_active === false) return false;
  if (organizationId && m.organization_id && m.organization_id !== organizationId) return false;
  return true;
}

/** Validazione client-side speculare a quella del database. */
export function validaRighe(righe: RigaPersonaleInput[]): string | null {
  if (!Array.isArray(righe) || righe.length === 0) return "Aggiungi almeno una persona";
  const visti = new Set<string>();
  for (const r of righe) {
    if (!r.membro_id) return "Persona non selezionata";
    if (visti.has(r.membro_id)) return "La stessa persona è stata inserita due volte";
    visti.add(r.membro_id);
    const ore = Number(r.ore);
    if (!Number.isFinite(ore) || ore <= 0) return "Ore non valide: devono essere maggiori di zero";
    if (ore > MAX_ORE_PERSONA) return `Ore non valide: massimo ${MAX_ORE_PERSONA} per persona`;
  }
  return null;
}

/** Una riga già contabilizzata non cambia costo senza ricalcolo esplicito. */
export function richiedeRicalcolo(
  precedente: Pick<RigaPersonale, "stato_contabilizzazione" | "ore">,
  nuoveOre: number,
): boolean {
  return precedente.stato_contabilizzazione === "contabilizzato" && Number(precedente.ore) !== Number(nuoveOre);
}

/** Righe candidate al ricalcolo successivo (tariffa inserita dopo). */
export function righeRicalcolabili(righe: RigaPersonale[]): RigaPersonale[] {
  return righeAttive(righe).filter(
    (r) =>
      r.stato_contabilizzazione === "tariffa_mancante" ||
      r.stato_contabilizzazione === "conflitto_tariffa" ||
      r.stato_contabilizzazione === "da_contabilizzare",
  );
}

/** Vista senza dati economici per i ruoli non autorizzati. */
export function mascheraCosti(righe: RigaPersonale[]): RigaPersonale[] {
  return righe.map((r) => ({ ...r, tariffa_oraria_congelata: null, costo_congelato: null }));
}

/** Aggregazione dei costi (per persona, giornata, cantiere, commessa, fase). */
export function aggregaCosti<T extends Record<string, any>>(
  righe: T[],
  chiave: (r: T) => string,
  importo: (r: T) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of righe) {
    const k = chiave(r);
    out[k] = Math.round(((out[k] ?? 0) + Number(importo(r) ?? 0)) * 100) / 100;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ore anomale (per persona, non sul totale del rapportino)
// ─────────────────────────────────────────────────────────────────────────────

/** Soglia operativa giornaliera per singola persona. */
export const LIMITE_ORE_PERSONA = 16;

export type OreRapportino = {
  ore?: number | null;
  persone?: number | null;
  ore_max_persona?: number | null;
};

/**
 * Un rapportino è anomalo solo se una singola persona supera le 16 ore.
 * Con più operai il totale di testata (es. 24h per 3 persone) è normale.
 */
export function oreAnomale(r: OreRapportino): boolean {
  const persone = Number(r.persone ?? 0);
  if (persone > 0) {
    const max = r.ore_max_persona != null ? Number(r.ore_max_persona) : Number(r.ore ?? 0) / persone;
    return max > LIMITE_ORE_PERSONA;
  }
  return Number(r.ore ?? 0) > LIMITE_ORE_PERSONA;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot temporali da 30 minuti
// ─────────────────────────────────────────────────────────────────────────────

/** Elenco degli orari selezionabili (00:00 → 23:30) a passi di 30 minuti. */
export function slotOrari(stepMinuti = 30): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinuti) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/** Pause selezionabili, in minuti, a passi di 30. */
export function slotPause(maxMinuti = 240, stepMinuti = 30): number[] {
  const out: number[] = [];
  for (let m = 0; m <= maxMinuti; m += stepMinuti) out.push(m);
  return out;
}

/** Arrotonda un orario "HH:MM" allo slot da 30 minuti più vicino. */
export function arrotondaSlot(hhmm: string, stepMinuti = 30): string {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const tot = Math.min(24 * 60 - stepMinuti, Math.round((h * 60 + m) / stepMinuti) * stepMinuti);
  return `${String(Math.floor(tot / 60)).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
}

/** Ore nette fra due slot, al netto della pausa; null se non calcolabile. */
export function oreDaSlot(inizio?: string | null, fine?: string | null, pausaMinuti = 0): number | null {
  if (!inizio || !fine) return null;
  const [hi, mi] = inizio.split(":").map(Number);
  const [hf, mf] = fine.split(":").map(Number);
  if ([hi, mi, hf, mf].some((n) => Number.isNaN(n))) return null;
  const diff = hf * 60 + mf - (hi * 60 + mi) - Math.max(0, pausaMinuti);
  if (diff <= 0) return null;
  return Math.round((diff / 60) * 100) / 100;
}
