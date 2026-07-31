/**
 * Sprint 7 — Documenti e Scadenze.
 * Modulo PURO (nessun accesso a rete/DB): sanitizzazione nomi file, costruzione
 * path Storage, whitelist MIME, limiti dimensione, stato scadenza e label.
 * Condiviso fra server functions, UI e test.
 */

// ─────────────────────────────────────────────────────────────────────────────
// File: MIME, estensioni, dimensioni
// ─────────────────────────────────────────────────────────────────────────────
export const DOCUMENTI_BUCKET = "documenti";
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/** MIME ammessi con preview e download. */
export const PREVIEW_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** MIME ammessi solo in download. */
export const DOWNLOAD_ONLY_MIME = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/vnd.dwg",
  "application/acad",
  "application/dxf",
  "image/vnd.dxf",
] as const;

export const ALLOWED_MIME: string[] = [...PREVIEW_MIME, ...DOWNLOAD_ONLY_MIME];

/** Estensioni ammesse, coerenti con la whitelist MIME. */
export const ALLOWED_EXT = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "docx",
  "xlsx",
  "dwg",
  "dxf",
] as const;

/** Estensioni pericolose: mai ammesse, nemmeno come estensione intermedia. */
export const BLOCKED_EXT = [
  "exe",
  "bat",
  "cmd",
  "com",
  "scr",
  "msi",
  "sh",
  "bash",
  "ps1",
  "jar",
  "app",
  "dll",
  "html",
  "htm",
  "xhtml",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "php",
  "py",
  "rb",
  "svg",
  "vbs",
  "wsf",
  "apk",
  "dmg",
];

export const ERR_MIME = "Questo formato di file non è supportato.";
export const ERR_SIZE = "Il file supera la dimensione massima consentita.";
export const ERR_NOT_FOUND = "Elemento non trovato.";
export const ERR_FILE_MISSING = "Il file caricato non è disponibile.";
export const ERR_CONFLICT =
  "Il documento è stato modificato da un altro utente. Ricarica i dati.";

export function fileExtension(fileName: string): string {
  const clean = (fileName ?? "").trim().toLowerCase();
  const idx = clean.lastIndexOf(".");
  if (idx <= 0 || idx === clean.length - 1) return "";
  return clean.slice(idx + 1);
}

/** Tutte le estensioni presenti nel nome (per doppie estensioni sospette). */
export function allExtensions(fileName: string): string[] {
  const parts = (fileName ?? "").trim().toLowerCase().split(".");
  return parts.slice(1).filter(Boolean);
}

/** Nome file sanitizzato: ASCII-safe, senza path traversal, max 80 caratteri. */
export function sanitizeFileName(fileName: string): string {
  const raw = (fileName ?? "").trim();
  const base = raw.split(/[\\/]/).pop() ?? "";
  const ext = fileExtension(base);
  const stem = ext ? base.slice(0, base.length - ext.length - 1) : base;
  const normalized = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const safeStem = normalized || "documento";
  const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8);
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

/** Path Storage: organization_id/document_id/versione/nome-sanitizzato */
export function buildStoragePath(
  organizationId: string,
  documentoId: string,
  versione: number,
  fileName: string,
): string {
  return `${organizationId}/${documentoId}/${versione}/${sanitizeFileName(fileName)}`;
}

export type FileValidationInput = {
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export type FileValidationResult = { ok: true } | { ok: false; error: string };

export function validateFile(input: FileValidationInput): FileValidationResult {
  const { fileName, mimeType, fileSize } = input;
  if (!Number.isFinite(fileSize) || fileSize <= 0) return { ok: false, error: ERR_MIME };
  if (fileSize > MAX_FILE_SIZE) return { ok: false, error: ERR_SIZE };

  const mime = (mimeType ?? "").trim().toLowerCase();
  if (!ALLOWED_MIME.includes(mime)) return { ok: false, error: ERR_MIME };

  const exts = allExtensions(fileName);
  if (exts.length === 0) return { ok: false, error: ERR_MIME };
  if (exts.some((e) => BLOCKED_EXT.includes(e))) return { ok: false, error: ERR_MIME };

  const ext = exts[exts.length - 1];
  if (!(ALLOWED_EXT as readonly string[]).includes(ext)) return { ok: false, error: ERR_MIME };

  // Coerenza MIME ↔ estensione
  const expected: Record<string, string[]> = {
    pdf: ["application/pdf"],
    jpg: ["image/jpeg"],
    jpeg: ["image/jpeg"],
    png: ["image/png"],
    webp: ["image/webp"],
    docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    dwg: ["image/vnd.dwg", "application/acad"],
    dxf: ["application/dxf", "image/vnd.dxf"],
  };
  if (!expected[ext]?.includes(mime)) return { ok: false, error: ERR_MIME };

  return { ok: true };
}

export function canPreview(mimeType?: string | null): boolean {
  return (PREVIEW_MIME as readonly string[]).includes((mimeType ?? "").toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Scadenze
// ─────────────────────────────────────────────────────────────────────────────
export type ScadenzaStato = "scaduto" | "in_scadenza" | "valido" | "senza_scadenza";

function atMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Giorni mancanti alla scadenza: negativo = scaduto. null se senza scadenza. */
export function giorniAllaScadenza(
  dataScadenza?: string | null,
  today: Date = new Date(),
): number | null {
  if (!dataScadenza) return null;
  const sc = atMidnight(new Date(`${String(dataScadenza).slice(0, 10)}T00:00:00`));
  if (Number.isNaN(sc.getTime())) return null;
  const base = atMidnight(today);
  return Math.round((sc.getTime() - base.getTime()) / 86400000);
}

/** Stato derivato. Soglia "in scadenza" di default 30 giorni. */
export function scadenzaStato(
  dataScadenza?: string | null,
  today: Date = new Date(),
  sogliaGiorni = 30,
): ScadenzaStato {
  const g = giorniAllaScadenza(dataScadenza, today);
  if (g === null) return "senza_scadenza";
  if (g < 0) return "scaduto";
  if (g <= sogliaGiorni) return "in_scadenza";
  return "valido";
}

export function scadenzaLabel(dataScadenza?: string | null, today: Date = new Date()): string {
  const g = giorniAllaScadenza(dataScadenza, today);
  if (g === null) return "Senza scadenza";
  if (g < 0) return `Scaduto da ${Math.abs(g)} giorni`;
  if (g === 0) return "Scade oggi";
  if (g === 1) return "Scade domani";
  return `Scade tra ${g} giorni`;
}

export const SCADENZA_FILTERS = [
  "scaduti",
  "oggi",
  "7",
  "30",
  "60",
  "validi",
  "senza_scadenza",
] as const;
export type ScadenzaFilter = (typeof SCADENZA_FILTERS)[number];

export function matchScadenzaFilter(
  filter: ScadenzaFilter,
  dataScadenza?: string | null,
  today: Date = new Date(),
): boolean {
  const g = giorniAllaScadenza(dataScadenza, today);
  if (filter === "senza_scadenza") return g === null;
  if (g === null) return false;
  switch (filter) {
    case "scaduti":
      return g < 0;
    case "oggi":
      return g === 0;
    case "7":
      return g >= 0 && g <= 7;
    case "30":
      return g >= 0 && g <= 30;
    case "60":
      return g >= 0 && g <= 60;
    case "validi":
      return g > 30;
    default:
      return false;
  }
}

/** Ordinamento scadenziario: prima i più urgenti, senza scadenza in fondo. */
export function sortByScadenza<T extends { data_scadenza?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ga = giorniAllaScadenza(a.data_scadenza);
    const gb = giorniAllaScadenza(b.data_scadenza);
    if (ga === null && gb === null) return 0;
    if (ga === null) return 1;
    if (gb === null) return -1;
    return ga - gb;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ruoli e capability documenti
// ─────────────────────────────────────────────────────────────────────────────
export const DOC_UPLOAD_ROLES = [
  "proprietario",
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
];
export const DOC_MANAGE_ROLES = [
  "proprietario",
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
];
export const DOC_ADMIN_ROLES = ["proprietario", "amministratore", "amministrazione"];

export type DocumentoCapabilities = {
  canUpload: boolean;
  canManage: boolean;
  canAdmin: boolean;
};

export function documentoCapabilities(roles: string[]): DocumentoCapabilities {
  const has = (allowed: string[]) => roles.some((r) => allowed.includes(r));
  return {
    canUpload: has(DOC_UPLOAD_ROLES),
    canManage: has(DOC_MANAGE_ROLES),
    canAdmin: has(DOC_ADMIN_ROLES),
  };
}

/**
 * Categorie selezionabili per i nuovi documenti.
 * `preventivo` è una categoria stabile: è generata automaticamente dal modulo
 * Preventivi (PDF allegato) ed è presente sui dati storici.
 */
export const CATEGORIE_DOCUMENTO = [
  "Certificazione",
  "Contratto",
  "Sicurezza",
  "Amministrativo",
  "Tecnico",
  "Fattura",
  "Permesso",
  "preventivo",
  "Altro",
] as const;

/**
 * Categorie storiche presenti nei dati e non più proposte nei nuovi documenti.
 * Restano valide in lettura e in modifica: un documento storico non deve
 * diventare non modificabile solo perché usa una categoria legacy.
 * Una migration futura opzionale potrà rimapparle sulla whitelist stabile.
 */
export const CATEGORIE_LEGACY = ["Anagrafica", "Formazione", "Assicurazione"] as const;

/** Etichette leggibili (le categorie legacy mantengono la propria label). */
export const CATEGORIA_LABELS: Record<string, string> = {
  preventivo: "Preventivo",
};

export function categoriaLabel(categoria?: string | null): string {
  if (!categoria) return "—";
  return CATEGORIA_LABELS[categoria] ?? categoria;
}

export function isCategoriaLegacy(categoria?: string | null): boolean {
  if (!categoria) return false;
  return (CATEGORIE_LEGACY as readonly string[]).includes(categoria);
}

export function isCategoriaValida(categoria?: string | null): boolean {
  if (!categoria) return true;
  return (
    (CATEGORIE_DOCUMENTO as readonly string[]).includes(categoria) ||
    isCategoriaLegacy(categoria)
  );
}

/** Opzioni per la select: whitelist + eventuale categoria legacy già presente. */
export function categorieSelezionabili(categoriaCorrente?: string | null): string[] {
  const base = [...CATEGORIE_DOCUMENTO];
  if (categoriaCorrente && !base.includes(categoriaCorrente as any)) {
    return [categoriaCorrente, ...base];
  }
  return base;
}

/** Opzioni di filtro: whitelist stabile + categorie storiche ancora presenti. */
export const CATEGORIA_FILTER_OPTIONS: string[] = [
  ...CATEGORIE_DOCUMENTO,
  ...CATEGORIE_LEGACY,
];

export const VISIBILITA = ["privato", "organizzazione"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup tecnico file Storage orfani
// ─────────────────────────────────────────────────────────────────────────────

/** Solo ruoli tecnici/amministrativi possono usare gli strumenti di cleanup. */
export const DOC_CLEANUP_ROLES = ["proprietario", "amministratore"];

/** Età minima di un oggetto Storage prima di poter essere rimosso (24 ore). */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export const ERR_CLEANUP_REFERENCED =
  "Il file è collegato a un documento e non può essere rimosso.";
export const ERR_CLEANUP_TOO_RECENT =
  "Il file è troppo recente: attendi almeno 24 ore prima del cleanup.";

export function canCleanupStorage(roles: string[]): boolean {
  return roles.some((r) => DOC_CLEANUP_ROLES.includes(r));
}

/** Un oggetto è orfano se nessun documento lo referenzia (in qualunque stato). */
export function isOrphanObject(path: string, referencedPaths: Iterable<string>): boolean {
  return !new Set(referencedPaths).has(path);
}

/** Verifica soglia temporale: `force` è ammesso solo per dati QA espliciti. */
export function orphanCleanupAllowed(
  createdAt: string | Date,
  now: Date = new Date(),
  force = false,
): { ok: true } | { ok: false; error: string } {
  if (force) return { ok: true };
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return { ok: false, error: ERR_CLEANUP_TOO_RECENT };
  if (now.getTime() - t < ORPHAN_MIN_AGE_MS) return { ok: false, error: ERR_CLEANUP_TOO_RECENT };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catena versioni (regole pure)
// ─────────────────────────────────────────────────────────────────────────────
export type VersioneRow = {
  id: string;
  versione: number;
  is_versione_corrente: boolean;
  archived_at?: string | null;
};

/** Una sola versione corrente per catena. */
export function versioneCorrente(chain: VersioneRow[]): VersioneRow | null {
  return chain.find((v) => v.is_versione_corrente) ?? null;
}

export function chainCoerente(chain: VersioneRow[]): boolean {
  const correnti = chain.filter((v) => v.is_versione_corrente).length;
  const ids = new Set(chain.map((v) => v.id));
  return correnti === 1 && ids.size === chain.length;
}

/** L'archiviazione riguarda l'intero documento logico. */
export function chainTuttaArchiviata(chain: VersioneRow[]): boolean {
  return chain.length > 0 && chain.every((v) => !!v.archived_at);
}

export function chainTuttaAttiva(chain: VersioneRow[]): boolean {
  return chain.length > 0 && chain.every((v) => !v.archived_at);
}

export const MSG_ARCHIVE_CHAIN =
  "Archiviando il documento verranno archiviate tutte le sue versioni.";
export const MSG_RESTORE_CHAIN = "Verranno ripristinate tutte le versioni del documento.";


// ─────────────────────────────────────────────────────────────────────────────
// Riconciliazione upload interrotti (regole pure — nessun cron in questo blocco)
// ─────────────────────────────────────────────────────────────────────────────

/** Oltre questa soglia un record "preparato" senza file può passare a fallito. */
export const PREPARATO_STALE_MS = 24 * 60 * 60 * 1000;

export type UploadReconciliation =
  | "nessuna_azione"
  | "finalizzabile"
  | "marca_fallito"
  | "gia_disponibile";

export function uploadReconciliation(input: {
  upload_stato: string;
  created_at: string | Date;
  hasFile: boolean;
  now?: Date;
}): UploadReconciliation {
  const { upload_stato, hasFile } = input;
  if (upload_stato === "disponibile") return "gia_disponibile";
  if (upload_stato !== "preparato") return "nessuna_azione";
  if (hasFile) return "finalizzabile"; // finalize può sempre essere ritentato
  const now = (input.now ?? new Date()).getTime();
  const created = new Date(input.created_at).getTime();
  if (!Number.isFinite(created)) return "nessuna_azione";
  return now - created >= PREPARATO_STALE_MS ? "marca_fallito" : "nessuna_azione";
}
