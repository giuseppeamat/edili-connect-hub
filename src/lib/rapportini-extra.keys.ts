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
};

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
