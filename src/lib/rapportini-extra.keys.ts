/**
 * Query keys per bolle, materiali, prezzi e subappaltatori.
 * Nessuna invalidazione globale: usare sempre queste chiavi.
 */
export const extraKeys = {
  bolle: (rapportinoId: string) => ["rapportino", rapportinoId, "bolle"] as const,
  subappalti: (rapportinoId: string) => ["rapportino", rapportinoId, "subappalti"] as const,
  riepilogo: (rapportinoId: string) => ["rapportino", rapportinoId, "riepilogo-costi"] as const,
  materiali: () => ["materiali"] as const,
  prezzi: (f?: Record<string, unknown>) => ["materiali", "prezzi", f ?? {}] as const,
  fornitori: (tipo?: string | null) => ["fornitori", "scelta", tipo ?? "tutti"] as const,
  contratti: (f?: Record<string, unknown>) => ["subappalti", "contratti", f ?? {}] as const,
  costiExtraCommessa: (commessaId: string) => ["commessa-detail", commessaId, "costi-extra"] as const,
  /** Archivio bolle (Documenti → Bolle). */
  archivio: (f?: Record<string, unknown>) => ["bolle", "archivio", f ?? {}] as const,
  bolla: (id: string) => ["bolle", "detail", id] as const,
  opzioni: (commessaId?: string | null, cantiereId?: string | null) =>
    ["bolle", "opzioni", commessaId ?? null, cantiereId ?? null] as const,
};

/** Dopo una mutazione nell'archivio bolle: lista, dettaglio e viste collegate. */
export function invalidaArchivioBolle(
  qc: { invalidateQueries: (o: { queryKey: readonly unknown[] }) => unknown },
  opts: { id?: string | null; rapportinoId?: string | null } = {},
) {
  qc.invalidateQueries({ queryKey: ["bolle"] });
  if (opts.id) qc.invalidateQueries({ queryKey: extraKeys.bolla(opts.id) });
  if (opts.rapportinoId) invalidaCostiExtra(qc, opts.rapportinoId);
  qc.invalidateQueries({ queryKey: ["documenti"] });
  qc.invalidateQueries({ queryKey: ["materiali", "prezzi"] });
  qc.invalidateQueries({ queryKey: ["audit"] });
}

/** Un costo extra tocca rapportino, commessa, budget e dashboard. */
export function invalidaCostiExtra(
  qc: { invalidateQueries: (o: { queryKey: readonly unknown[] }) => unknown },
  rapportinoId: string,
) {
  qc.invalidateQueries({ queryKey: extraKeys.bolle(rapportinoId) });
  qc.invalidateQueries({ queryKey: extraKeys.subappalti(rapportinoId) });
  qc.invalidateQueries({ queryKey: extraKeys.riepilogo(rapportinoId) });
  qc.invalidateQueries({ queryKey: ["rapportini"] });
  qc.invalidateQueries({ queryKey: ["commesse-board"] });
  qc.invalidateQueries({ queryKey: ["commessa-detail"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  qc.invalidateQueries({ queryKey: ["commessa-budget-summary"] });
  qc.invalidateQueries({ queryKey: ["commessa-budget-voci"] });
  qc.invalidateQueries({ queryKey: ["materiali", "prezzi"] });
}
