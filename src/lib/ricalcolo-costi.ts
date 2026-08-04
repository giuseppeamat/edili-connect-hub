/**
 * Regole pure del ricalcolo costi manodopera dei rapportini.
 * Specchio della logica SQL (ricalcola_costi_rapportini_mancanti): servono per
 * i test automatici e per l'anteprima lato UI. L'autorità resta il database.
 */

export type EsitoRicalcolo =
  | "contabilizzabile"
  | "contabilizzato"
  | "gia_contabilizzato"
  | "tariffa_mancante"
  | "conflitto_tariffa"
  | "escluso"
  | "annullato"
  | "errore";

export type TariffaMembro = {
  id: string;
  membro_id: string | null;
  user_id?: string | null;
  costo_orario: number;
  valido_dal: string;
  valido_al: string | null;
  archived_at?: string | null;
};

export type RapportinoRicalcolo = {
  id: string;
  data: string;
  ore: number;
  stato: string;
  membro_id: string | null;
  user_id: string | null;
  archived_at?: string | null;
  cancelled_at?: string | null;
  ha_costo_attivo?: boolean;
};

export const ESITO_LABEL: Record<EsitoRicalcolo, string> = {
  contabilizzabile: "Contabilizzabile",
  contabilizzato: "Contabilizzato",
  gia_contabilizzato: "Già contabilizzato",
  tariffa_mancante: "Tariffa mancante",
  conflitto_tariffa: "Conflitto tariffa",
  escluso: "Escluso",
  annullato: "Annullato",
  errore: "Errore",
};

/** Membro effettivo: quello del rapportino oppure il membro collegato all'account. */
export function membroEffettivo(
  rap: Pick<RapportinoRicalcolo, "membro_id" | "user_id">,
  membri: { id: string; user_id?: string | null; archived_at?: string | null }[],
): string | null {
  if (rap.membro_id) return rap.membro_id;
  if (!rap.user_id) return null;
  const m = membri.find((x) => x.user_id === rap.user_id && !x.archived_at);
  return m?.id ?? null;
}

/** Tariffe non archiviate valide alla data per il membro indicato. */
export function tariffeValide(
  tariffe: TariffaMembro[],
  membroId: string | null,
  data: string,
): TariffaMembro[] {
  if (!membroId) return [];
  return tariffe.filter(
    (t) =>
      !t.archived_at &&
      t.membro_id === membroId &&
      t.valido_dal <= data &&
      (t.valido_al === null || t.valido_al >= data),
  );
}

/** Costo congelato: ore × tariffa, arrotondato al centesimo. */
export function costoCongelato(ore: number, tariffa: number): number {
  return Math.round(ore * tariffa * 100) / 100;
}

export type RigaRicalcolo = {
  rapportino_id: string;
  membro_id: string | null;
  data: string;
  ore: number;
  tariffa: number | null;
  costo: number | null;
  esito: EsitoRicalcolo;
  motivo: string | null;
};

/** Valuta un singolo rapportino secondo le regole di eleggibilità. */
export function valutaRapportino(
  rap: RapportinoRicalcolo,
  membri: { id: string; user_id?: string | null; archived_at?: string | null }[],
  tariffe: TariffaMembro[],
): RigaRicalcolo {
  const membro = membroEffettivo(rap, membri);
  const base = { rapportino_id: rap.id, membro_id: membro, data: rap.data, ore: rap.ore };

  if (rap.cancelled_at || rap.stato === "annullato")
    return { ...base, tariffa: null, costo: null, esito: "annullato", motivo: "Rapportino annullato" };
  if (rap.archived_at)
    return { ...base, tariffa: null, costo: null, esito: "escluso", motivo: "Rapportino archiviato" };
  if (rap.ha_costo_attivo)
    return { ...base, tariffa: null, costo: null, esito: "gia_contabilizzato", motivo: "Costo già congelato: invariato" };
  if (rap.stato !== "approvato")
    return { ...base, tariffa: null, costo: null, esito: "escluso", motivo: "Rapportino non approvato" };
  if (!membro)
    return { ...base, tariffa: null, costo: null, esito: "tariffa_mancante", motivo: "Persona non collegata a un membro dell'organizzazione" };

  const valide = tariffeValide(tariffe, membro, rap.data);
  if (valide.length > 1)
    return { ...base, tariffa: null, costo: null, esito: "conflitto_tariffa", motivo: "Più tariffe valide sovrapposte alla data" };
  if (valide.length === 0)
    return { ...base, tariffa: null, costo: null, esito: "tariffa_mancante", motivo: "Nessuna tariffa valida alla data del rapportino" };

  const t = valide[0]!;
  return {
    ...base,
    tariffa: t.costo_orario,
    costo: costoCongelato(rap.ore, t.costo_orario),
    esito: "contabilizzabile",
    motivo: null,
  };
}

/** Riepilogo aggregato dell'anteprima o del ricalcolo reale. */
export function riepilogoRicalcolo(righe: RigaRicalcolo[]) {
  const conta = (e: EsitoRicalcolo) => righe.filter((r) => r.esito === e).length;
  const contabilizzabili = righe.filter(
    (r) => r.esito === "contabilizzabile" || r.esito === "contabilizzato",
  );
  return {
    analizzati: righe.length,
    contabilizzabili: contabilizzabili.length,
    senza_tariffa: conta("tariffa_mancante"),
    conflitti: conta("conflitto_tariffa"),
    gia_contabilizzati: conta("gia_contabilizzato"),
    esclusi: conta("escluso"),
    annullati: conta("annullato"),
    errori: conta("errore"),
    totale_costo:
      Math.round(contabilizzabili.reduce((s, r) => s + (r.costo ?? 0), 0) * 100) / 100,
  };
}
