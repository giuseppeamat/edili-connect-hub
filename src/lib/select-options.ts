/**
 * Helper condivisi per le Select (Radix vieta value="").
 * Sprint 5 · Blocco 4 — Fase 1: chiavi/valori univoci nelle option.
 */

/** Sentinel esplicito per "nessuna selezione". */
export const NONE_VALUE = "__none__";
/** Sentinel esplicito per il filtro "tutti". */
export const ALL_VALUE = "__all__";

/** Converte il sentinel (o stringa vuota) in null prima della mutation. */
export const toNullable = (v: string | null | undefined): string | null =>
  !v || v === NONE_VALUE ? null : v;

/** Rimuove opzioni senza value e duplicati: key/value univoci garantiti. */
export function uniqueOptions<T extends { value: string }>(opts: T[] | null | undefined): T[] {
  const seen = new Set<string>();
  return (opts ?? []).filter((o) => {
    const v = o?.value;
    if (!v || seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

/** Come uniqueOptions, ma per liste {id,label} provenienti dal server. */
export function uniqueEntities(list: any[] | null | undefined): { id: string; label: string }[] {
  return uniqueOptions(
    (list ?? []).map((x: any) => ({ value: x?.id ? String(x.id) : "", label: x?.label ?? "—" })),
  ).map((o) => ({ id: o.value, label: o.label }));
}
