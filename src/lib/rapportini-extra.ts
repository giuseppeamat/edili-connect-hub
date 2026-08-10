/**
 * Bolle, materiali e subappaltatori nei rapportini — regole pure.
 * Speculari alla logica SQL (save_rapportino_bolla / save_rapportino_subappalto).
 * L'autorità resta il database: qui solo calcoli e validazioni per la UI.
 */

export type ModalitaCompenso =
  | "a_corpo"
  | "a_giornata"
  | "a_quantita"
  | "a_sal"
  | "a_ore_ditta"
  | "altro";

export const MODALITA_COMPENSO_LABEL: Record<ModalitaCompenso, string> = {
  a_corpo: "A corpo",
  a_giornata: "A giornata",
  a_quantita: "A quantità",
  a_sal: "A SAL",
  a_ore_ditta: "A ore ditta",
  altro: "Altro",
};

export const STATO_BOLLA_LABEL: Record<string, string> = {
  registrata: "Registrata",
  da_verificare: "Da verificare",
  verificata: "Verificata",
  contabilizzata: "Contabilizzata",
  annullata: "Annullata",
};

export const STATO_SUBAPPALTO_LABEL: Record<string, string> = {
  da_contabilizzare: "Da contabilizzare",
  contabilizzato: "Contabilizzato",
  importo_mancante: "Importo mancante",
  annullato: "Annullato",
};

export const STATO_CONTRATTO_LABEL: Record<string, string> = {
  bozza: "Bozza",
  attivo: "Attivo",
  sospeso: "Sospeso",
  completato: "Completato",
  chiuso: "Chiuso",
  annullato: "Annullato",
};

export type RigaBollaInput = {
  descrizione: string;
  quantita: number | string;
  prezzo_unitario?: number | string | null;
  sconto_pct?: number | string | null;
  iva_pct?: number | string | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Totale riga = quantità × prezzo × (1 − sconto%), arrotondato al centesimo. */
export function totaleRiga(riga: RigaBollaInput): number | null {
  const q = num(riga.quantita);
  const p = num(riga.prezzo_unitario);
  const s = num(riga.sconto_pct) ?? 0;
  if (q === null || p === null) return null;
  return round2(q * p * (1 - s / 100));
}

export type TotaliBolla = { imponibile: number; iva: number; totale: number; righe: number };

/** Totali della bolla: imponibile dalle sole righe con prezzo, IVA per riga. */
export function totaliBolla(righe: RigaBollaInput[]): TotaliBolla {
  let imponibile = 0;
  let iva = 0;
  for (const r of righe ?? []) {
    const t = totaleRiga(r);
    if (t === null) continue;
    imponibile += t;
    const ivp = num(r.iva_pct);
    if (ivp !== null) iva += round2((t * ivp) / 100);
  }
  imponibile = round2(imponibile);
  iva = round2(iva);
  return { imponibile, iva, totale: round2(imponibile + iva), righe: (righe ?? []).length };
}

/** Validazione righe bolla, speculare ai vincoli del database. */
export function validaRigheBolla(righe: RigaBollaInput[]): string | null {
  if (!Array.isArray(righe) || righe.length === 0) return "Aggiungi almeno una riga materiale";
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i]!;
    if (!String(r.descrizione ?? "").trim()) return `Descrizione mancante alla riga ${i + 1}`;
    const q = num(r.quantita);
    if (q === null || q <= 0) return `Quantità non valida alla riga ${i + 1}`;
    const p = num(r.prezzo_unitario);
    if (p !== null && p < 0) return `Prezzo non valido alla riga ${i + 1}`;
    const s = num(r.sconto_pct);
    if (s !== null && (s < 0 || s > 100)) return `Sconto non valido alla riga ${i + 1}`;
  }
  return null;
}

export type BollaTestata = {
  fornitore_id?: string | null;
  numero_bolla?: string | null;
  data_bolla?: string | null;
};

export function validaTestataBolla(b: BollaTestata): string | null {
  if (!b.fornitore_id) return "Seleziona il fornitore";
  if (!String(b.numero_bolla ?? "").trim()) return "Numero bolla obbligatorio";
  if (!b.data_bolla) return "Data bolla obbligatoria";
  return null;
}

export type SubappaltoInput = {
  subappaltatore_id?: string | null;
  lavorazione?: string | null;
  modalita_compenso?: ModalitaCompenso | string | null;
  quantita?: number | string | null;
  importo_unitario?: number | string | null;
  importo_totale?: number | string | null;
};

/** Importo del subappalto: esplicito se presente, altrimenti quantità × unitario. */
export function importoSubappalto(r: SubappaltoInput): number | null {
  const tot = num(r.importo_totale);
  if (tot !== null) return round2(tot);
  const q = num(r.quantita);
  const iu = num(r.importo_unitario);
  if (q === null || iu === null) return null;
  return round2(q * iu);
}

export function validaSubappalto(r: SubappaltoInput): string | null {
  if (!r.subappaltatore_id) return "Seleziona la ditta subappaltatrice";
  if (!String(r.lavorazione ?? "").trim()) return "Lavorazione obbligatoria";
  const q = num(r.quantita);
  if (q !== null && q <= 0) return "Quantità non valida";
  const imp = importoSubappalto(r);
  if (imp !== null && imp < 0) return "Importo non valido";
  return null;
}

/** Righe attive = non annullate. */
export function attive<T extends { annullato_at?: string | null; stato?: string | null }>(rows: T[]): T[] {
  return (rows ?? []).filter((r) => !r.annullato_at && r.stato !== "annullata");
}

export type RiepilogoCosti = {
  manodopera: number;
  materiali: number;
  subappalti: number;
  totale: number;
};

/** Riepilogo giornaliero: una sorgente per categoria, nessun doppio conteggio. */
export function riepilogoCosti(input: {
  manodopera?: number | null;
  bolle?: Array<{ imponibile?: number | null; stato?: string | null }>;
  subappalti?: Array<{ importo_congelato?: number | null; annullato_at?: string | null }>;
}): RiepilogoCosti {
  const manodopera = round2(Number(input.manodopera ?? 0));
  const materiali = round2(
    attive(input.bolle ?? []).reduce((s, b) => s + Number(b.imponibile ?? 0), 0),
  );
  const subappalti = round2(
    attive(input.subappalti ?? []).reduce((s, r) => s + Number(r.importo_congelato ?? 0), 0),
  );
  return { manodopera, materiali, subappalti, totale: round2(manodopera + materiali + subappalti) };
}

/** Statistiche di confronto prezzi per fornitore su uno stesso materiale. */
export function confrontoPrezzi(
  righe: Array<{ fornitore_id: string; fornitore_nome?: string | null; prezzo_unitario: number | string; data_prezzo: string }>,
): Array<{ fornitore_id: string; fornitore_nome: string; ultimo: number; minimo: number; massimo: number; medio: number; rilevazioni: number }> {
  const map = new Map<string, { nome: string; prezzi: Array<{ p: number; d: string }> }>();
  for (const r of righe ?? []) {
    const p = num(r.prezzo_unitario);
    if (p === null) continue;
    const e = map.get(r.fornitore_id) ?? { nome: r.fornitore_nome ?? "—", prezzi: [] };
    e.prezzi.push({ p, d: r.data_prezzo });
    map.set(r.fornitore_id, e);
  }
  return Array.from(map.entries()).map(([fornitore_id, e]) => {
    const ordinati = [...e.prezzi].sort((a, b) => (a.d < b.d ? 1 : -1));
    const valori = e.prezzi.map((x) => x.p);
    return {
      fornitore_id,
      fornitore_nome: e.nome,
      ultimo: round2(ordinati[0]!.p),
      minimo: round2(Math.min(...valori)),
      massimo: round2(Math.max(...valori)),
      medio: round2(valori.reduce((s, v) => s + v, 0) / valori.length),
      rilevazioni: valori.length,
    };
  }).sort((a, b) => a.ultimo - b.ultimo);
}

/** Un rapportino accetta nuove bolle/subappalti solo se aperto. */
export function rapportinoModificabile(r: { archived_at?: string | null; stato?: string | null } | null | undefined): boolean {
  if (!r) return false;
  if (r.archived_at) return false;
  return r.stato !== "approvato" && r.stato !== "annullato";
}

/** Ruoli abilitati a registrare bolle anche su rapportino già approvato. */
export const BOLLE_ROLES_EDIT_EXTRA = [
  "proprietario",
  "amministratore",
  "amministrazione",
  "ufficio_tecnico",
  "responsabile_commessa",
  "capocantiere",
] as const;

/** Le bolle sono registrabili anche su rapportino approvato, ma solo per ruoli operativi. */
export function bolleModificabili(
  r: { archived_at?: string | null; stato?: string | null } | null | undefined,
  ruoli?: string[] | null,
): boolean {
  if (!r) return false;
  if (r.archived_at) return false;
  if (r.stato === "annullato") return false;
  if (r.stato !== "approvato") return true;
  const ruoliSet = new Set(ruoli ?? []);
  return BOLLE_ROLES_EDIT_EXTRA.some((role) => ruoliSet.has(role));
}


/** Ultimo prezzo rilevato per ciascun materiale (per la colonna in anagrafica). */
export function ultimiPrezziPerMateriale(
  righe: Array<{
    materiale_id?: string | null;
    prezzo_unitario: number | string;
    data_prezzo: string;
    fornitore_nome?: string | null;
    unita_misura?: string | null;
  }>,
): Record<string, { prezzo: number; data: string; fornitore: string; unita_misura: string | null }> {
  const out: Record<string, { prezzo: number; data: string; fornitore: string; unita_misura: string | null }> = {};
  for (const r of righe ?? []) {
    if (!r.materiale_id) continue;
    const p = num(r.prezzo_unitario);
    if (p === null) continue;
    const prev = out[r.materiale_id];
    if (!prev || prev.data < r.data_prezzo) {
      out[r.materiale_id] = {
        prezzo: round2(p),
        data: r.data_prezzo,
        fornitore: r.fornitore_nome ?? "—",
        unita_misura: r.unita_misura ?? null,
      };
    }
  }
  return out;
}
