/**
 * Archivio bolle (Documenti → Bolle) — regole pure.
 * Una bolla può esistere senza rapportino: qui vivono badge, permessi UI
 * e rilevamento duplicati. L'autorità resta il database.
 */
import { BOLLE_ROLES_EDIT_EXTRA, STATO_BOLLA_LABEL } from "@/lib/rapportini-extra";

export type BollaRow = {
  id: string;
  numero_bolla: string;
  data_bolla: string;
  fornitore_id: string;
  fornitore_nome?: string | null;
  commessa_id?: string | null;
  cantiere_id?: string | null;
  rapportino_id?: string | null;
  documento_id?: string | null;
  stato?: string | null;
  archived_at?: string | null;
};

export type BadgeInfo = { label: string; variant: "default" | "secondary" | "outline" | "destructive" };

/** Stato di collegamento con il rapportino, derivato (nessuna colonna dedicata). */
export function collegamentoStato(b: Pick<BollaRow, "rapportino_id">): "collegata" | "non_collegata" {
  return b.rapportino_id ? "collegata" : "non_collegata";
}

export function collegamentoBadge(b: Pick<BollaRow, "rapportino_id">): BadgeInfo {
  return b.rapportino_id
    ? { label: "Collegata a rapportino", variant: "default" }
    : { label: "Non collegata", variant: "outline" };
}

/** Badge di stato: archiviata prevale sullo stato operativo. */
export function statoBadge(b: Pick<BollaRow, "stato" | "archived_at">): BadgeInfo {
  if (b.archived_at) return { label: "Archiviata", variant: "secondary" };
  const stato = b.stato ?? "registrata";
  if (stato === "annullata") return { label: "Annullata", variant: "destructive" };
  if (stato === "contabilizzata") return { label: "Contabilizzata", variant: "default" };
  if (stato === "verificata") return { label: "Verificata", variant: "default" };
  if (stato === "da_verificare") return { label: "Da verificare", variant: "outline" };
  return { label: STATO_BOLLA_LABEL[stato] ?? "Registrata", variant: "secondary" };
}

/** Chi può creare/modificare bolle dall'archivio documentale. */
export function bolleCapabilities(ruoli?: string[] | null) {
  const set = new Set(ruoli ?? []);
  const canManage = BOLLE_ROLES_EDIT_EXTRA.some((r) => set.has(r));
  const canSeeEcon = ["proprietario", "amministratore", "amministrazione"].some((r) => set.has(r));
  return { canManage, canSeeEcon };
}

/** Una bolla è modificabile se non annullata e non archiviata. */
export function bollaModificabile(b: Pick<BollaRow, "stato" | "archived_at">): boolean {
  return !b.archived_at && b.stato !== "annullata";
}

/** Duplicati: stesso fornitore e stesso numero; la stessa data alza la certezza. */
export function classificaDuplicati(
  candidati: Array<Pick<BollaRow, "id" | "numero_bolla" | "data_bolla">>,
  dataBolla: string,
): { certi: typeof candidati; possibili: typeof candidati } {
  const certi = (candidati ?? []).filter((c) => c.data_bolla === dataBolla);
  const possibili = (candidati ?? []).filter((c) => c.data_bolla !== dataBolla);
  return { certi, possibili };
}

export const MSG_DUPLICATO =
  "Potrebbe esistere già una bolla con questo numero per il fornitore selezionato.";

/** Validazione testata lato UI: il rapportino resta opzionale. */
export function validaTestataArchivio(input: {
  fornitore_id?: string | null;
  numero_bolla?: string | null;
  data_bolla?: string | null;
  commessa_id?: string | null;
  cantiere_id?: string | null;
  cantiereCommessaId?: string | null;
}): string | null {
  if (!input.fornitore_id) return "Seleziona il fornitore";
  if (!input.numero_bolla?.trim()) return "Numero bolla obbligatorio";
  if (!input.data_bolla) return "Data bolla obbligatoria";
  if (input.cantiere_id && !input.commessa_id) return "Seleziona prima la commessa";
  if (
    input.cantiere_id &&
    input.cantiereCommessaId &&
    input.cantiereCommessaId !== input.commessa_id
  ) {
    return "Cantiere non coerente con la commessa";
  }
  return null;
}
