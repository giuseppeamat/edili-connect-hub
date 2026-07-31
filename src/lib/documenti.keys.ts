/**
 * Sprint 7 — Query keys centralizzate del modulo Documenti.
 * Nessuna invalidazione globale: usare sempre queste chiavi.
 */
export type DocumentiFilters = {
  q?: string | null;
  categoria?: string | null;
  stato_scadenza?: string | null;
  cliente_id?: string | null;
  fornitore_id?: string | null;
  commessa_id?: string | null;
  cantiere_id?: string | null;
  includeArchived?: boolean | null;
  upload_stato?: string | null;
  sort?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export type ScadenziarioFilters = {
  filtro?: string | null;
  categoria?: string | null;
  commessa_id?: string | null;
  includeArchived?: boolean | null;
};

export const documentiKeys = {
  all: ["documenti"] as const,
  lists: () => [...documentiKeys.all, "list"] as const,
  list: (f?: DocumentiFilters) => [...documentiKeys.lists(), f ?? {}] as const,
  detail: (id: string) => [...documentiKeys.all, "detail", id] as const,
  versions: (id: string) => [...documentiKeys.all, "versions", id] as const,
  byCommessa: (id: string) => [...documentiKeys.all, "by-commessa", id] as const,
  byCantiere: (id: string) => [...documentiKeys.all, "by-cantiere", id] as const,
  byCliente: (id: string) => [...documentiKeys.all, "by-cliente", id] as const,
  byFornitore: (id: string) => [...documentiKeys.all, "by-fornitore", id] as const,
  scadenziario: (f?: ScadenziarioFilters) =>
    [...documentiKeys.all, "scadenziario", f ?? {}] as const,
};

/** Invalidazioni mirate dopo una mutazione documenti. */
export function invalidateDocumenti(
  qc: { invalidateQueries: (o: { queryKey: readonly unknown[] }) => unknown },
  opts: { id?: string | null; commessaId?: string | null; cantiereId?: string | null; clienteId?: string | null; fornitoreId?: string | null } = {},
) {
  qc.invalidateQueries({ queryKey: documentiKeys.lists() });
  qc.invalidateQueries({ queryKey: [...documentiKeys.all, "scadenziario"] });
  if (opts.id) {
    qc.invalidateQueries({ queryKey: documentiKeys.detail(opts.id) });
    qc.invalidateQueries({ queryKey: documentiKeys.versions(opts.id) });
  }
  if (opts.commessaId) qc.invalidateQueries({ queryKey: documentiKeys.byCommessa(opts.commessaId) });
  if (opts.cantiereId) qc.invalidateQueries({ queryKey: documentiKeys.byCantiere(opts.cantiereId) });
  if (opts.clienteId) qc.invalidateQueries({ queryKey: documentiKeys.byCliente(opts.clienteId) });
  if (opts.fornitoreId) qc.invalidateQueries({ queryKey: documentiKeys.byFornitore(opts.fornitoreId) });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  qc.invalidateQueries({ queryKey: ["audit"] });
}
