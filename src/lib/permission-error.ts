/**
 * Detects RLS / permission-denied errors from Supabase / PostgREST and returns
 * a friendly Italian message, hiding SQL details, policy names and stack traces.
 * The technical detail is logged to the dev console only.
 */
export function friendlyPermissionError(err: unknown): string {
  const e = err as { code?: string; message?: string; status?: number } | null;
  const code = e?.code ?? "";
  const status = e?.status ?? 0;
  const msg = (e?.message ?? "").toLowerCase();

  const isPermission =
    code === "42501" ||
    code === "PGRST301" ||
    status === 401 ||
    status === 403 ||
    msg.includes("row-level security") ||
    msg.includes("permission denied") ||
    msg.includes("violates row-level security");

  if (import.meta.env.DEV) {
    // Keep technical detail for developers only.
    // eslint-disable-next-line no-console
    console.debug("[permission]", err);
  }

  if (isPermission) {
    return "Non hai i permessi necessari per completare questa operazione.";
  }
  return e?.message || "Si è verificato un errore imprevisto.";
}
