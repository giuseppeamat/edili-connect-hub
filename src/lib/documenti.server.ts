/**
 * Sprint 7 — Documenti: helper SERVER-ONLY.
 * Contiene contesto tenant, validazione associazioni, DTO e audit.
 * Importato dalle server functions (`documenti.functions.ts`), mai dal client.
 */
import {
  DOCUMENTI_BUCKET,
  ERR_NOT_FOUND,
  documentoCapabilities,
  isCategoriaValida,
  scadenzaStato,
  type DocumentoCapabilities,
} from "@/lib/documenti-model";

export const DOC_LIST_COLS =
  "id, nome, categoria, descrizione, data_documento, data_scadenza, visibilita, versione, is_versione_corrente, file_name_originale, mime_type, size_bytes, upload_stato, created_at, updated_at, created_by, uploaded_by, archived_at, cliente_id, fornitore_id, commessa_id, cantiere_id, preventivo_id, dipendente_id";

export const DOC_DETAIL_COLS = `${DOC_LIST_COLS}, note_versione, documento_precedente_id, archived_by, updated_by`;

/** Colonne tecniche mai esposte al client (usate solo internamente). */
export const DOC_INTERNAL_COLS =
  "id, organization_id, storage_bucket, storage_path, upload_stato, versione, is_versione_corrente, created_by, updated_at, archived_at, mime_type, size_bytes, file_name_originale, documento_precedente_id, nome, commessa_id, cantiere_id, cliente_id, fornitore_id";

export type DocContext = {
  organizationId: string;
  roles: string[];
  caps: DocumentoCapabilities;
};

export async function resolveDocContext(supabase: any, userId: string): Promise<DocContext> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("organization_id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  if (prof.is_active === false) throw new Error("Utente disattivato");
  const { data: rr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", prof.organization_id);
  const roles = (rr ?? []).map((r: any) => String(r.role));
  return { organizationId: prof.organization_id as string, roles, caps: documentoCapabilities(roles) };
}

export function assertUpload(ctx: DocContext) {
  if (!ctx.caps.canUpload) throw new Error("Non autorizzato");
}
export function assertManage(ctx: DocContext) {
  if (!ctx.caps.canManage) throw new Error("Non autorizzato");
}

export type Associazioni = {
  cliente_id?: string | null;
  fornitore_id?: string | null;
  commessa_id?: string | null;
  cantiere_id?: string | null;
  preventivo_id?: string | null;
  dipendente_id?: string | null;
};

/**
 * Verifica che ogni associazione appartenga alla stessa organizzazione.
 * Cross-tenant e inesistente producono lo STESSO errore: "Elemento non trovato."
 */
export async function validateAssociazioni(
  supabase: any,
  org: string,
  a: Associazioni,
): Promise<void> {
  const checks: Array<Promise<void>> = [];
  const one = async (table: string, id: string, extra = "id") => {
    const { data } = await supabase
      .from(table)
      .select(extra)
      .eq("id", id)
      .eq("organization_id", org)
      .maybeSingle();
    if (!data) throw new Error(ERR_NOT_FOUND);
  };

  if (a.cliente_id) checks.push(one("clienti", a.cliente_id));
  if (a.fornitore_id) checks.push(one("fornitori", a.fornitore_id));
  if (a.preventivo_id) checks.push(one("preventivi", a.preventivo_id));
  if (a.dipendente_id)
    checks.push(
      (async () => {
        const { data } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", a.dipendente_id)
          .eq("organization_id", org)
          .maybeSingle();
        if (!data) throw new Error(ERR_NOT_FOUND);
      })(),
    );
  await Promise.all(checks);

  let commessa: any = null;
  if (a.commessa_id) {
    const { data } = await supabase
      .from("commesse")
      .select("id, cliente_id")
      .eq("id", a.commessa_id)
      .eq("organization_id", org)
      .maybeSingle();
    if (!data) throw new Error(ERR_NOT_FOUND);
    commessa = data;
  }

  if (a.cantiere_id) {
    const { data } = await supabase
      .from("cantieri")
      .select("id, commessa_id")
      .eq("id", a.cantiere_id)
      .eq("organization_id", org)
      .maybeSingle();
    if (!data) throw new Error(ERR_NOT_FOUND);
    if (a.commessa_id && data.commessa_id !== a.commessa_id) {
      throw new Error("Il cantiere selezionato non appartiene alla commessa.");
    }
  }

  if (commessa && a.cliente_id && commessa.cliente_id && commessa.cliente_id !== a.cliente_id) {
    throw new Error("La commessa selezionata non appartiene al cliente indicato.");
  }
}

export function assertCategoria(categoria?: string | null) {
  if (!isCategoriaValida(categoria)) throw new Error("Categoria non valida.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment / DTO
// ─────────────────────────────────────────────────────────────────────────────
export type Lookups = {
  clienti: Map<string, any>;
  fornitori: Map<string, any>;
  commesse: Map<string, any>;
  cantieri: Map<string, any>;
  profili: Map<string, any>;
};

export async function buildLookups(supabase: any, org: string, rows: any[]): Promise<Lookups> {
  const ids = (k: string) => Array.from(new Set(rows.map((r) => r[k]).filter(Boolean)));
  const cli = ids("cliente_id");
  const forn = ids("fornitore_id");
  const comm = ids("commessa_id");
  const cant = ids("cantiere_id");
  const users = Array.from(
    new Set([...rows.map((r) => r.created_by), ...rows.map((r) => r.uploaded_by)].filter(Boolean)),
  );
  const empty = Promise.resolve({ data: [] as any[] });
  const [c, f, m, k, p] = await Promise.all([
    cli.length
      ? supabase.from("clienti").select("id, denominazione").eq("organization_id", org).in("id", cli)
      : empty,
    forn.length
      ? supabase.from("fornitori").select("id, ragione_sociale").eq("organization_id", org).in("id", forn)
      : empty,
    comm.length
      ? supabase.from("commesse").select("id, codice, denominazione").eq("organization_id", org).in("id", comm)
      : empty,
    cant.length
      ? supabase.from("cantieri").select("id, codice, nome").eq("organization_id", org).in("id", cant)
      : empty,
    users.length
      ? supabase.from("profiles").select("id, nome, cognome, email").eq("organization_id", org).in("id", users)
      : empty,
  ]);
  const map = (d: any) => new Map(((d?.data ?? []) as any[]).map((x: any) => [x.id, x]));
  return { clienti: map(c), fornitori: map(f), commesse: map(m), cantieri: map(k), profili: map(p) };
}

export function personName(p: any): string | null {
  if (!p) return null;
  const s = [p.nome, p.cognome].filter(Boolean).join(" ").trim();
  return s || p.email || null;
}

const SHORT = 160;

export function toListDTO(row: any, l: Lookups) {
  return {
    id: row.id,
    nome: row.nome,
    categoria: row.categoria ?? null,
    descrizione_breve: row.descrizione ? String(row.descrizione).slice(0, SHORT) : null,
    data_documento: row.data_documento ?? null,
    data_scadenza: row.data_scadenza ?? null,
    stato_scadenza: scadenzaStato(row.data_scadenza),
    visibilita: row.visibilita,
    versione: row.versione,
    is_versione_corrente: row.is_versione_corrente,
    file_name_originale: row.file_name_originale ?? null,
    mime_type: row.mime_type ?? null,
    file_size: row.size_bytes ?? null,
    upload_stato: row.upload_stato,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
    autore: personName(l.profili.get(row.created_by ?? row.uploaded_by)),
    cliente: row.cliente_id
      ? { id: row.cliente_id, label: l.clienti.get(row.cliente_id)?.denominazione ?? "—" }
      : null,
    fornitore: row.fornitore_id
      ? { id: row.fornitore_id, label: l.fornitori.get(row.fornitore_id)?.ragione_sociale ?? "—" }
      : null,
    commessa: row.commessa_id
      ? {
          id: row.commessa_id,
          label: [l.commesse.get(row.commessa_id)?.codice, l.commesse.get(row.commessa_id)?.denominazione]
            .filter(Boolean)
            .join(" — ") || "—",
        }
      : null,
    cantiere: row.cantiere_id
      ? {
          id: row.cantiere_id,
          label: [l.cantieri.get(row.cantiere_id)?.codice, l.cantieri.get(row.cantiere_id)?.nome]
            .filter(Boolean)
            .join(" — ") || "—",
        }
      : null,
  };
}

export function toDetailDTO(row: any, l: Lookups, caps: DocumentoCapabilities) {
  return {
    ...toListDTO(row, l),
    descrizione: row.descrizione ?? null,
    note_versione: row.note_versione ?? null,
    preventivo_id: row.preventivo_id ?? null,
    dipendente_id: row.dipendente_id ?? null,
    documento_precedente_id: row.documento_precedente_id ?? null,
    capabilities: {
      canUpload: caps.canUpload,
      canManage: caps.canManage,
      canAdmin: caps.canAdmin,
      canArchive: caps.canManage && !row.archived_at,
      canRestore: caps.canManage && !!row.archived_at,
      canNewVersion: caps.canUpload && !row.archived_at && row.upload_stato === "disponibile",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage / audit
// ─────────────────────────────────────────────────────────────────────────────
export async function storageObjectExists(
  supabase: any,
  path: string,
): Promise<{ exists: boolean; size?: number | null; mime?: string | null }> {
  const idx = path.lastIndexOf("/");
  const dir = path.slice(0, idx);
  const file = path.slice(idx + 1);
  const { data, error } = await supabase.storage.from(DOCUMENTI_BUCKET).list(dir, {
    limit: 100,
    search: file,
  });
  if (error) return { exists: false };
  const found = (data ?? []).find((o: any) => o.name === file);
  if (!found) return { exists: false };
  return {
    exists: true,
    size: found.metadata?.size ?? null,
    mime: found.metadata?.mimetype ?? null,
  };
}

/** Audit tramite service role (server-only): la tabella nega INSERT agli utenti. */
export async function audit(
  org: string,
  userId: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_log").insert({
      organization_id: org,
      user_id: userId,
      action,
      entity: "documenti",
      entity_id: entityId,
      metadata: metadata as any,
    });
  } catch {
    /* l'audit non deve mai bloccare l'operazione utente */
  }
}

/** Carica un documento della propria organizzazione o fallisce con "Elemento non trovato." */
export async function loadDocumentoInternal(supabase: any, org: string, id: string) {
  const { data } = await supabase
    .from("documenti")
    .select(DOC_INTERNAL_COLS)
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle();
  if (!data) throw new Error(ERR_NOT_FOUND);
  return data as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Versioni e filtri scadenza (server-side)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catena di versioni cui appartiene il documento: risale ai precedenti e
 * discende ai successivi restando sempre dentro l'organizzazione.
 */
export async function versionChain(
  supabase: any,
  org: string,
  id: string,
): Promise<Array<{ id: string; versione: number; is_versione_corrente: boolean }>> {
  const seen = new Map<string, any>();
  // Risalita
  let currentId: string | null = id;
  for (let i = 0; i < 50 && currentId; i++) {
    const { data } = (await supabase
      .from("documenti")
      .select("id, versione, is_versione_corrente, documento_precedente_id")
      .eq("id", currentId)
      .eq("organization_id", org)
      .maybeSingle()) as { data: any };
    if (!data || seen.has(data.id)) break;
    seen.set(data.id, data);
    currentId = data.documento_precedente_id ?? null;
  }
  // Discesa
  let frontier = Array.from(seen.keys());
  for (let i = 0; i < 50 && frontier.length; i++) {
    const { data } = await supabase
      .from("documenti")
      .select("id, versione, is_versione_corrente, documento_precedente_id")
      .eq("organization_id", org)
      .in("documento_precedente_id", frontier);
    const next = (data ?? []).filter((r: any) => !seen.has(r.id));
    next.forEach((r: any) => seen.set(r.id, r));
    frontier = next.map((r: any) => r.id);
  }
  return Array.from(seen.values()).map((r: any) => ({
    id: r.id,
    versione: Number(r.versione) || 1,
    is_versione_corrente: !!r.is_versione_corrente,
  }));
}

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Filtro stato scadenza sulla query (soglia 30 giorni, coerente con il DB). */
export function applyScadenzaFilter(q: any, stato: string | null) {
  if (!stato) return q;
  if (stato === "senza_scadenza") return q.is("data_scadenza", null);
  if (stato === "scaduto") return q.lt("data_scadenza", isoDay(0));
  if (stato === "in_scadenza") return q.gte("data_scadenza", isoDay(0)).lte("data_scadenza", isoDay(30));
  if (stato === "valido") return q.gt("data_scadenza", isoDay(30));
  return q;
}

/** Filtri dello Scadenziario. Default: scaduti + entro 30 giorni. */
export function scadenziarioRange(q: any, filtro: string) {
  switch (filtro) {
    case "tutti":
      return q;
    case "scaduti":
      return q.lt("data_scadenza", isoDay(0));
    case "oggi":
      return q.eq("data_scadenza", isoDay(0));
    case "7":
      return q.gte("data_scadenza", isoDay(0)).lte("data_scadenza", isoDay(7));
    case "30":
      return q.gte("data_scadenza", isoDay(0)).lte("data_scadenza", isoDay(30));
    case "60":
      return q.gte("data_scadenza", isoDay(0)).lte("data_scadenza", isoDay(60));
    case "validi":
      return q.gt("data_scadenza", isoDay(30));
    case "senza_scadenza":
      return q.is("data_scadenza", null);
    default:
      return q.not("data_scadenza", "is", null).lte("data_scadenza", isoDay(30));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup tecnico: file Storage orfani (Sprint 7 — hardening finale)
// ─────────────────────────────────────────────────────────────────────────────
import { canCleanupStorage } from "@/lib/documenti-model";

export function assertCleanup(ctx: DocContext) {
  if (!canCleanupStorage(ctx.roles)) throw new Error("Non autorizzato");
}

export type StorageObjectInfo = {
  path: string;
  size: number | null;
  created_at: string | null;
  mime_type: string | null;
};

/** Elenca ricorsivamente gli oggetti sotto un prefisso (max ~5 livelli). */
export async function listStorageObjects(
  supabase: any,
  prefix: string,
  depth = 0,
): Promise<StorageObjectInfo[]> {
  if (depth > 5) return [];
  const { data, error } = await supabase.storage
    .from(DOCUMENTI_BUCKET)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error || !data) return [];
  const out: StorageObjectInfo[] = [];
  for (const entry of data as any[]) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null || entry.metadata == null) {
      out.push(...(await listStorageObjects(supabase, full, depth + 1)));
    } else {
      out.push({
        path: full,
        size: entry.metadata?.size ?? null,
        created_at: entry.created_at ?? null,
        mime_type: entry.metadata?.mimetype ?? null,
      });
    }
  }
  return out;
}

/** Tutti i path referenziati da un documento dell'organizzazione (qualunque stato). */
export async function referencedStoragePaths(supabase: any, org: string): Promise<Set<string>> {
  const paths = new Set<string>();
  const pageSize = 1000;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from("documenti")
      .select("storage_path")
      .eq("organization_id", org)
      .not("storage_path", "is", null)
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error || !data || data.length === 0) break;
    (data as any[]).forEach((r) => r.storage_path && paths.add(String(r.storage_path)));
    if (data.length < pageSize) break;
  }
  return paths;
}
