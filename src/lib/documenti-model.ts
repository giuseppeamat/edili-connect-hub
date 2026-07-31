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

export const CATEGORIE_DOCUMENTO = [
  "Certificazione",
  "Contratto",
  "Sicurezza",
  "Amministrativo",
  "Tecnico",
  "Fattura",
  "Permesso",
  "Altro",
] as const;

export function isCategoriaValida(categoria?: string | null): boolean {
  if (!categoria) return true;
  return (CATEGORIE_DOCUMENTO as readonly string[]).includes(categoria);
}

export const VISIBILITA = ["privato", "organizzazione"] as const;
