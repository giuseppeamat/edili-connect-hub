/**
 * Fonte unica di verità (lato UI) per stabilire se una commessa è in sola
 * lettura. Deve restare allineata a public.can_manage_commessa_budget:
 * il DB blocca le mutazioni quando stato ∈ (completata, chiusa, archiviata).
 * Qui includiamo anche `annullata` e i flag closed_at / archived_at.
 *
 * L'autorità resta il database: questa funzione serve solo a non mostrare
 * comandi che poi fallirebbero lato RPC.
 */

export const STATI_COMMESSA_NON_OPERATIVI = [
  "completata",
  "chiusa",
  "annullata",
  "archiviata",
] as const;

export type CommessaLockInput = {
  stato?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
};

export function isCommessaBudgetLocked(c: CommessaLockInput | null | undefined): boolean {
  if (!c) return true;
  if (c.archived_at) return true;
  if (c.closed_at) return true;
  return STATI_COMMESSA_NON_OPERATIVI.includes((c.stato ?? "") as any);
}

/** Alias semantico: la commessa non è operativa ⇒ nessuna mutazione. */
export const isCommessaReadOnly = isCommessaBudgetLocked;

export function commessaLockReason(c: CommessaLockInput | null | undefined): string | null {
  if (!isCommessaBudgetLocked(c)) return null;
  if (c?.archived_at) return "Il Budget è in sola lettura perché la commessa è archiviata.";
  if (c?.closed_at) return "Il Budget è in sola lettura perché la commessa è chiusa.";
  return "Il Budget è in sola lettura perché la commessa è completata, chiusa, annullata o archiviata.";
}

export const BUDGET_MSG = {
  locked: "Non puoi modificare il Budget di una commessa non operativa.",
  manualMode: "Per gestire le singole voci, passa il Budget alla modalità analitica.",
  notAuthorized: "Non sei autorizzato a modificare il Budget.",
  conflict:
    "Il Budget è stato modificato da un altro utente. I dati sono stati aggiornati: controllali prima di riprovare.",
  invalidMode: "La modalità Budget selezionata non è valida.",
  emptyAnalytic: "Nessuna voce analitica presente.",
} as const;
