/**
 * Sprint 5 — Blocco 1
 * Query keys centralizzate per il modulo Rapportini.
 * Usare sempre queste chiavi per garantire invalidazioni coerenti.
 */
export type RapportinoFilters = {
  from?: string | null;
  to?: string | null;
  commessa_id?: string | null;
  cantiere_id?: string | null;
  fase_id?: string | null;
  user_id?: string | null;
  stato?: string | null;
  includeArchived?: boolean | null;
};

export const rapportiniKeys = {
  all: ["rapportini"] as const,
  lists: () => [...rapportiniKeys.all, "list"] as const,
  list: (f?: RapportinoFilters) => [...rapportiniKeys.lists(), f ?? {}] as const,
  byCommessa: (commessaId: string, f?: RapportinoFilters) =>
    [...rapportiniKeys.all, "by-commessa", commessaId, f ?? {}] as const,
  byCantiere: (cantiereId: string, f?: RapportinoFilters) =>
    [...rapportiniKeys.all, "by-cantiere", cantiereId, f ?? {}] as const,
  detail: (id: string) => [...rapportiniKeys.all, "detail", id] as const,
  assignable: {
    commesse: () => [...rapportiniKeys.all, "assignable", "commesse"] as const,
    cantieri: (commessaId: string) =>
      [...rapportiniKeys.all, "assignable", "cantieri", commessaId] as const,
    fasi: (commessaId: string, cantiereId?: string | null) =>
      [...rapportiniKeys.all, "assignable", "fasi", commessaId, cantiereId ?? null] as const,
  },
};
