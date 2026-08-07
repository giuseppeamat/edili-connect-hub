/**
 * FEATURE — Costi della struttura e costo orario aziendale.
 * Modulo puro: annualizzazione, ore produttive, costo orario struttura,
 * costo industriale e applicazione del costo struttura ai preventivi.
 * Nessuna dipendenza da rete/DB: interamente testabile.
 */

export type Periodicita =
  | "mensile"
  | "trimestrale"
  | "semestrale"
  | "annuale"
  | "una_tantum"
  | "ammortizzato";

export type TipoPersonale =
  | "non_applicabile"
  | "diretto"
  | "indiretto"
  | "amministrazione"
  | "titolari"
  | "tecnico";

export type CostoOrarioStato = "bozza" | "calcolato" | "approvato" | "archiviato";

export type CsModalita = "nessuno" | "orario" | "percentuale" | "manuale";

export const PERIODICITA_LABELS: Record<Periodicita, string> = {
  mensile: "Mensile",
  trimestrale: "Trimestrale",
  semestrale: "Semestrale",
  annuale: "Annuale",
  una_tantum: "Una tantum",
  ammortizzato: "Ammortizzato",
};

export const PERIODICITA_OPTIONS: Periodicita[] = [
  "mensile",
  "trimestrale",
  "semestrale",
  "annuale",
  "una_tantum",
  "ammortizzato",
];

export const TIPO_PERSONALE_LABELS: Record<TipoPersonale, string> = {
  non_applicabile: "Non applicabile",
  diretto: "Personale diretto",
  indiretto: "Personale indiretto",
  amministrazione: "Amministrazione",
  titolari: "Titolari",
  tecnico: "Personale tecnico",
};

export const GRUPPI_LABELS: Record<string, string> = {
  PERSONALE_INDIRETTO: "Personale indiretto",
  IMMOBILI: "Immobili",
  MEZZI_ATTREZZATURE: "Mezzi e attrezzature",
  SERVIZI: "Servizi",
  MARKETING: "Marketing",
  SICUREZZA: "Sicurezza",
  ASSICURAZIONI: "Assicurazioni",
  AMMINISTRAZIONE: "Amministrazione",
  ALTRO: "Altro",
};

export const GRUPPI_OPTIONS = Object.keys(GRUPPI_LABELS);

export const STATO_LABELS: Record<CostoOrarioStato, string> = {
  bozza: "Bozza",
  calcolato: "Calcolato",
  approvato: "Approvato",
  archiviato: "Archiviato",
};

export const MODALITA_LABELS: Record<CsModalita, string> = {
  nessuno: "Nessuno",
  orario: "€/ora",
  percentuale: "Percentuale",
  manuale: "Quota manuale",
};

/** Ruoli con accesso ai valori economici della struttura. */
export const CS_READ_ROLES = ["proprietario", "amministratore", "amministrazione"] as const;
export const CS_WRITE_ROLES = ["proprietario", "amministratore"] as const;

export function canReadCostiStruttura(roles: readonly string[]): boolean {
  return roles.some((r) => (CS_READ_ROLES as readonly string[]).includes(r));
}
export function canWriteCostiStruttura(roles: readonly string[]): boolean {
  return roles.some((r) => (CS_WRITE_ROLES as readonly string[]).includes(r));
}

export type CostoStrutturaInput = {
  id?: string;
  categoria_id?: string | null;
  importo: number;
  periodicita: Periodicita;
  data_inizio?: string | null;
  data_fine?: string | null;
  anno_riferimento: number;
  mese_riferimento?: number | null;
  tipo_personale?: TipoPersonale | null;
  anni_ammortamento?: number | null;
  data_inizio_ammortamento?: string | null;
  valore_residuo?: number | null;
  is_active?: boolean | null;
  archived_at?: string | null;
};

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function round2(v: number): number {
  return Math.round((n(v) + Number.EPSILON) * 100) / 100;
}
export function round4(v: number): number {
  return Math.round((n(v) + Number.EPSILON) * 10000) / 10000;
}

/** Quota annualizzata di un singolo costo (FASE 5). */
export function quotaAnnua(c: CostoStrutturaInput): number {
  const importo = n(c.importo);
  switch (c.periodicita) {
    case "mensile":
      return round2(importo * 12);
    case "trimestrale":
      return round2(importo * 4);
    case "semestrale":
      return round2(importo * 2);
    case "annuale":
      return round2(importo);
    case "una_tantum":
      return round2(importo);
    case "ammortizzato": {
      const anni = n(c.anni_ammortamento);
      if (anni <= 0) return 0;
      const residuo = n(c.valore_residuo);
      const base = Math.max(importo - residuo, 0);
      return round2(base / anni);
    }
    default:
      return 0;
  }
}

const yearOf = (iso?: string | null): number | null => {
  if (!iso) return null;
  const y = Number(String(iso).slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
};

/** Il costo concorre al totale dell'anno indicato? Evita duplicazioni. */
export function costoAttivoNellAnno(c: CostoStrutturaInput, anno: number): boolean {
  if (c.archived_at) return false;
  if (c.is_active === false) return false;

  if (c.periodicita === "una_tantum") {
    return c.anno_riferimento === anno;
  }
  if (c.periodicita === "ammortizzato") {
    const start = yearOf(c.data_inizio_ammortamento) ?? c.anno_riferimento;
    const anni = n(c.anni_ammortamento);
    if (anni <= 0) return false;
    return anno >= start && anno <= start + anni - 1;
  }
  // ricorrenti: finestra di validità
  const from = yearOf(c.data_inizio) ?? c.anno_riferimento;
  const to = yearOf(c.data_fine);
  if (anno < from) return false;
  if (to !== null && anno > to) return false;
  return true;
}

export type TotaliOptions = { includiPersonaleDiretto?: boolean };

/** Il costo va escluso perché già contabilizzato altrove (rapportini)? FASE 6. */
export function isDoppioConteggio(c: CostoStrutturaInput, opts: TotaliOptions = {}): boolean {
  if (opts.includiPersonaleDiretto) return false;
  return (c.tipo_personale ?? "non_applicabile") === "diretto";
}

export function costiRilevanti<T extends CostoStrutturaInput>(
  costi: readonly T[],
  anno: number,
  opts: TotaliOptions = {},
): T[] {
  return costi.filter((c) => costoAttivoNellAnno(c, anno) && !isDoppioConteggio(c, opts));
}

/** Totale annualizzato dei costi di struttura per l'anno (FASE 5 + FASE 6). */
export function totaleAnnualizzato(
  costi: readonly CostoStrutturaInput[],
  anno: number,
  opts: TotaliOptions = {},
): number {
  return round2(
    costiRilevanti(costi, anno, opts).reduce((s, c) => s + quotaAnnua(c), 0),
  );
}

export type TotaleCategoria = {
  categoria_id: string;
  totale: number;
  percentuale: number;
};

export function totaliPerCategoria(
  costi: readonly CostoStrutturaInput[],
  anno: number,
  opts: TotaliOptions = {},
): TotaleCategoria[] {
  const rilevanti = costiRilevanti(costi, anno, opts);
  const map = new Map<string, number>();
  for (const c of rilevanti) {
    const k = c.categoria_id ?? "—";
    map.set(k, round2((map.get(k) ?? 0) + quotaAnnua(c)));
  }
  const tot = round2([...map.values()].reduce((s, v) => s + v, 0));
  return [...map.entries()]
    .map(([categoria_id, totale]) => ({
      categoria_id,
      totale,
      percentuale: tot > 0 ? round2((totale / tot) * 100) : 0,
    }))
    .sort((a, b) => b.totale - a.totale);
}

// ───────────────────────── ORE PRODUTTIVE (FASE 7) ─────────────────────────

export type OreProduttiveConfig = {
  dipendenti_produttivi: number;
  ore_teoriche_persona: number;
  ore_ferie: number;
  ore_permessi: number;
  ore_festivita: number;
  ore_malattia: number;
  ore_formazione: number;
  ore_amministrative: number;
  ore_non_produttive_altre: number;
  ore_produttive_manuali?: number | null;
  usa_manuale?: boolean | null;
};

export const ORE_CONFIG_DEFAULT: OreProduttiveConfig = {
  dipendenti_produttivi: 0,
  ore_teoriche_persona: 2080,
  ore_ferie: 0,
  ore_permessi: 0,
  ore_festivita: 0,
  ore_malattia: 0,
  ore_formazione: 0,
  ore_amministrative: 0,
  ore_non_produttive_altre: 0,
  ore_produttive_manuali: null,
  usa_manuale: false,
};

/** Ore non produttive per persona/anno. */
export function oreNonProduttivePerPersona(cfg: OreProduttiveConfig): number {
  return round2(
    n(cfg.ore_ferie) +
      n(cfg.ore_permessi) +
      n(cfg.ore_festivita) +
      n(cfg.ore_malattia) +
      n(cfg.ore_formazione) +
      n(cfg.ore_amministrative) +
      n(cfg.ore_non_produttive_altre),
  );
}

/** Ore produttive annue totali dell'organizzazione. */
export function oreProduttiveAnnue(cfg: OreProduttiveConfig): number {
  if (cfg.usa_manuale) return round2(Math.max(n(cfg.ore_produttive_manuali), 0));
  const perPersona = Math.max(n(cfg.ore_teoriche_persona) - oreNonProduttivePerPersona(cfg), 0);
  return round2(Math.max(perPersona * n(cfg.dipendenti_produttivi), 0));
}

// ───────────────────── COSTO ORARIO STRUTTURA (FASE 8) ─────────────────────

/** Costo struttura €/h. Divisione per zero → 0 (mai Infinity/NaN). */
export function costoOrarioStruttura(totaleAnnuo: number, oreProduttive: number): number {
  const ore = n(oreProduttive);
  if (ore <= 0) return 0;
  return round4(n(totaleAnnuo) / ore);
}

// ───────────────────── COSTO INDUSTRIALE (FASE 9) ─────────────────────

export type ComponentiConfig = {
  includi_costo_personale_in_industriale: boolean;
  includi_costo_struttura_in_industriale: boolean;
  includi_costo_mezzi_in_industriale: boolean;
};

export type ComponentiOrarie = {
  costoPersonaleMedio: number;
  costoStruttura: number;
  costoMezzi: number;
  altriOverhead: number;
};

export const CONFIG_DEFAULT: ComponentiConfig = {
  includi_costo_personale_in_industriale: true,
  includi_costo_struttura_in_industriale: true,
  includi_costo_mezzi_in_industriale: false,
};

/** Somma solo le componenti esplicitamente abilitate: nessuna somma implicita. */
export function costoIndustrialeOrario(
  comp: ComponentiOrarie,
  cfg: ComponentiConfig = CONFIG_DEFAULT,
): number {
  let tot = 0;
  if (cfg.includi_costo_personale_in_industriale) tot += n(comp.costoPersonaleMedio);
  if (cfg.includi_costo_struttura_in_industriale) tot += n(comp.costoStruttura);
  if (cfg.includi_costo_mezzi_in_industriale) tot += n(comp.costoMezzi);
  tot += n(comp.altriOverhead);
  return round4(tot);
}

/** Media semplice dei costi orari del personale diretto. */
export function costoPersonaleMedio(tariffe: readonly { costo_orario: number }[]): number {
  const valide = tariffe.map((t) => n(t.costo_orario)).filter((v) => v > 0);
  if (valide.length === 0) return 0;
  return round4(valide.reduce((s, v) => s + v, 0) / valide.length);
}

// ───────────────────── PREVENTIVI (FASE 10 / 12) ─────────────────────

export type CostoStrutturaPreventivo = {
  modalita: CsModalita;
  ore?: number | null;
  tariffa?: number | null;
  percentuale?: number | null;
  importo_manuale?: number | null;
  base_imponibile?: number | null;
};

/** Importo del costo struttura da imputare al preventivo. */
export function calcolaCostoStrutturaPreventivo(p: CostoStrutturaPreventivo): number {
  switch (p.modalita) {
    case "orario":
      return round2(Math.max(n(p.ore), 0) * Math.max(n(p.tariffa), 0));
    case "percentuale":
      return round2((Math.max(n(p.base_imponibile), 0) * Math.max(n(p.percentuale), 0)) / 100);
    case "manuale":
      return round2(Math.max(n(p.importo_manuale), 0));
    case "nessuno":
    default:
      return 0;
  }
}

export type RiepilogoPreventivo = {
  manodopera: number;
  materiali: number;
  mezzi: number;
  subappalti: number;
  altri: number;
  costoStruttura: number;
  ricavo: number;
};

/** Ripartizione preventivo con costo struttura SEMPRE separato dalla manodopera. */
export function riepilogoPreventivo(r: RiepilogoPreventivo) {
  const costoTotale = round2(
    n(r.manodopera) + n(r.materiali) + n(r.mezzi) + n(r.subappalti) + n(r.altri) + n(r.costoStruttura),
  );
  const margine = round2(n(r.ricavo) - costoTotale);
  const marginePct = n(r.ricavo) > 0 ? round2((margine / n(r.ricavo)) * 100) : 0;
  return { costoTotale, margine, marginePct, prezzoFinale: round2(n(r.ricavo)) };
}

// ───────────────────── VERSIONAMENTO (FASE 11) ─────────────────────

export type VersioneCostoOrario = {
  id?: string;
  anno: number;
  versione: number;
  stato: CostoOrarioStato;
  costo_orario_struttura: number;
};

export function prossimaVersione(
  versioni: readonly { anno: number; versione: number }[],
  anno: number,
): number {
  const max = versioni.filter((v) => v.anno === anno).reduce((m, v) => Math.max(m, v.versione), 0);
  return max + 1;
}

/** Versione applicabile ai nuovi preventivi: ultima approvata dell'anno. */
export function versioneApplicabile<T extends VersioneCostoOrario>(
  versioni: readonly T[],
  anno: number,
): T | null {
  const approvate = versioni
    .filter((v) => v.anno === anno && v.stato === "approvato")
    .sort((a, b) => b.versione - a.versione);
  return approvate[0] ?? null;
}

export function versioneLabel(v: { anno: number; versione: number }): string {
  return `${v.anno} · v${v.versione}`;
}

export function isVersioneModificabile(v: { stato: CostoOrarioStato }): boolean {
  return v.stato === "bozza" || v.stato === "calcolato";
}

// ───────────────────── SIMULATORE (FASE 14) ─────────────────────

export type SimulazioneInput = {
  costi: readonly CostoStrutturaInput[];
  anno: number;
  includiPersonaleDiretto?: boolean;
  /** delta assoluti da sommare al totale annualizzato */
  costiAggiuntivi?: number;
  /** override della configurazione ore */
  oreConfig: OreProduttiveConfig;
  /** percentuale assenteismo aggiuntiva applicata alle ore produttive (0-100) */
  assenteismoPct?: number;
};

export type SimulazioneResult = {
  totaleAnnualizzato: number;
  oreProduttive: number;
  costoOrarioStruttura: number;
};

export function simulaCostoOrario(input: SimulazioneInput): SimulazioneResult {
  const base = totaleAnnualizzato(input.costi, input.anno, {
    includiPersonaleDiretto: input.includiPersonaleDiretto ?? false,
  });
  const totale = round2(base + n(input.costiAggiuntivi));
  const oreBase = oreProduttiveAnnue(input.oreConfig);
  const pct = Math.min(Math.max(n(input.assenteismoPct), 0), 100);
  const ore = round2(oreBase * (1 - pct / 100));
  return {
    totaleAnnualizzato: totale,
    oreProduttive: ore,
    costoOrarioStruttura: costoOrarioStruttura(totale, ore),
  };
}

// ───────────────────── DASHBOARD (FASE 13) ─────────────────────

export function variazionePct(corrente: number, precedente: number): number | null {
  if (n(precedente) === 0) return null;
  return round2(((n(corrente) - n(precedente)) / Math.abs(n(precedente))) * 100);
}

/** Andamento mensile: la quota annua è ripartita in dodicesimi salvo mese di riferimento. */
export function andamentoMensile(
  costi: readonly (CostoStrutturaInput & { mese_riferimento?: number | null })[],
  anno: number,
  opts: TotaliOptions = {},
): number[] {
  const out = new Array(12).fill(0) as number[];
  for (const c of costiRilevanti(costi, anno, opts)) {
    const quota = quotaAnnua(c);
    if (c.periodicita === "una_tantum" && c.mese_riferimento) {
      const idx = Math.min(Math.max(c.mese_riferimento, 1), 12) - 1;
      out[idx] = round2((out[idx] ?? 0) + quota);
    } else {
      for (let i = 0; i < 12; i++) out[i] = round2((out[i] ?? 0) + quota / 12);
    }
  }
  return out.map(round2);
}
