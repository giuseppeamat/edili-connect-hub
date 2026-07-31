/**
 * Sprint 7 — Server functions DOCUMENTI.
 * Thin wrapper: solo import + dichiarazioni createServerFn.
 * organization_id, bucket, storage_path, versione e stati tecnici sono SEMPRE
 * derivati server-side; il client non può inviarli.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";
import {
  DOCUMENTI_BUCKET,
  ERR_CONFLICT,
  ERR_FILE_MISSING,
  ERR_NOT_FOUND,
  buildStoragePath,
  canPreview,
  validateFile,
} from "@/lib/documenti-model";
import {
  DOC_DETAIL_COLS,
  DOC_LIST_COLS,
  assertCategoria,
  assertManage,
  assertUpload,
  audit,
  buildLookups,
  loadDocumentoInternal,
  resolveDocContext,
  storageObjectExists,
  toDetailDTO,
  toListDTO,
  validateAssociazioni,
  versionChain,
  applyScadenzaFilter,
  scadenziarioRange,
} from "@/lib/documenti.server";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();

const prepareSchema = z.object({
  nome: z.string().trim().min(1, "Il nome è obbligatorio.").max(200),
  descrizione: z.string().trim().max(2000).nullable().optional(),
  categoria: z.string().trim().max(60).nullable().optional(),
  data_documento: z.string().nullable().optional(),
  data_scadenza: z.string().nullable().optional(),
  cliente_id: nullableUuid,
  fornitore_id: nullableUuid,
  commessa_id: nullableUuid,
  cantiere_id: nullableUuid,
  preventivo_id: nullableUuid,
  dipendente_id: nullableUuid,
  visibilita: z.enum(["privato", "organizzazione"]).optional(),
  file_name_originale: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().min(1).max(160),
  file_size: z.number().int().positive(),
  note_versione: z.string().trim().max(500).nullable().optional(),
});

export const prepareDocumentoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => prepareSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      assertUpload(ctx);
      assertCategoria(data.categoria);

      const check = validateFile({
        fileName: data.file_name_originale,
        mimeType: data.mime_type,
        fileSize: data.file_size,
      });
      if (!check.ok) throw new Error(check.error);

      await validateAssociazioni(context.supabase, ctx.organizationId, data);

      const { data: created, error } = await context.supabase
        .from("documenti")
        .insert({
          organization_id: ctx.organizationId,
          nome: data.nome,
          descrizione: data.descrizione ?? null,
          categoria: data.categoria ?? null,
          data_documento: data.data_documento || null,
          data_scadenza: data.data_scadenza || null,
          cliente_id: data.cliente_id ?? null,
          fornitore_id: data.fornitore_id ?? null,
          commessa_id: data.commessa_id ?? null,
          cantiere_id: data.cantiere_id ?? null,
          preventivo_id: data.preventivo_id ?? null,
          dipendente_id: data.dipendente_id ?? null,
          visibilita: data.visibilita ?? "organizzazione",
          note_versione: data.note_versione ?? null,
          file_name_originale: data.file_name_originale,
          mime_type: data.mime_type,
          size_bytes: data.file_size,
          storage_bucket: DOCUMENTI_BUCKET,
          versione: 1,
          is_versione_corrente: true,
          upload_stato: "preparato",
          created_by: context.userId,
          uploaded_by: context.userId,
          updated_by: context.userId,
        })
        .select("id, versione")
        .single();
      if (error) throw error;

      const path = buildStoragePath(
        ctx.organizationId,
        created.id,
        created.versione,
        data.file_name_originale,
      );
      const { error: upErr } = await context.supabase
        .from("documenti")
        .update({ storage_path: path })
        .eq("id", created.id)
        .eq("organization_id", ctx.organizationId);
      if (upErr) throw upErr;

      await audit(ctx.organizationId, context.userId, "documento_preparato", created.id, {
        nome: data.nome,
        versione: created.versione,
      });

      return {
        document_id: created.id as string,
        bucket: DOCUMENTI_BUCKET,
        path,
        versione: created.versione as number,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const finalizeDocumentoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ document_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      assertUpload(ctx);
      const doc = await loadDocumentoInternal(context.supabase, ctx.organizationId, data.document_id);

      if (doc.upload_stato === "disponibile") {
        return { document_id: doc.id, upload_stato: "disponibile", idempotent: true };
      }
      if (doc.upload_stato !== "preparato") throw new Error(ERR_FILE_MISSING);
      if (doc.storage_bucket !== DOCUMENTI_BUCKET || !doc.storage_path) throw new Error(ERR_FILE_MISSING);
      if (!String(doc.storage_path).startsWith(`${ctx.organizationId}/${doc.id}/`)) {
        throw new Error(ERR_FILE_MISSING);
      }

      const obj = await storageObjectExists(context.supabase, doc.storage_path);
      if (!obj.exists) {
        await context.supabase
          .from("documenti")
          .update({ upload_stato: "fallito", updated_by: context.userId })
          .eq("id", doc.id)
          .eq("organization_id", ctx.organizationId)
          .eq("upload_stato", "preparato");
        await audit(ctx.organizationId, context.userId, "documento_upload_fallito", doc.id, {});
        throw new Error(ERR_FILE_MISSING);
      }

      const { error } = await context.supabase
        .from("documenti")
        .update({
          upload_stato: "disponibile",
          size_bytes: obj.size ?? doc.size_bytes,
          mime_type: obj.mime ?? doc.mime_type,
          updated_by: context.userId,
          uploaded_by: context.userId,
        })
        .eq("id", doc.id)
        .eq("organization_id", ctx.organizationId)
        .eq("upload_stato", "preparato");
      if (error) throw error;

      await audit(ctx.organizationId, context.userId, "documento_upload_finalizzato", doc.id, {
        versione: doc.versione,
      });
      return { document_id: doc.id, upload_stato: "disponibile", idempotent: false };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const listSchema = z.object({
  q: z.string().trim().max(120).nullable().optional(),
  categoria: z.string().trim().max(60).nullable().optional(),
  stato_scadenza: z.enum(["scaduto", "in_scadenza", "valido", "senza_scadenza"]).nullable().optional(),
  cliente_id: nullableUuid,
  fornitore_id: nullableUuid,
  commessa_id: nullableUuid,
  cantiere_id: nullableUuid,
  includeArchived: z.boolean().nullable().optional(),
  upload_stato: z.enum(["preparato", "disponibile", "fallito"]).nullable().optional(),
  sort: z.enum(["updated_at", "data_scadenza", "nome", "created_at"]).nullable().optional(),
  page: z.number().int().min(1).max(500).nullable().optional(),
  pageSize: z.number().int().min(5).max(100).nullable().optional(),
  onlyCurrentVersion: z.boolean().nullable().optional(),
});

export const listDocumenti = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      const page = data.page ?? 1;
      const pageSize = data.pageSize ?? 25;
      const sort = data.sort ?? "updated_at";

      let q = context.supabase
        .from("documenti")
        .select(DOC_LIST_COLS, { count: "exact" })
        .eq("organization_id", ctx.organizationId);

      if (data.onlyCurrentVersion !== false) q = q.eq("is_versione_corrente", true);
      if (!data.includeArchived) q = q.is("archived_at", null);

      // Solo i ruoli amministrativi possono vedere record non disponibili.
      const uploadStato = data.upload_stato ?? "disponibile";
      if (uploadStato !== "disponibile" && !ctx.caps.canAdmin) throw new Error("Non autorizzato");
      q = q.eq("upload_stato", uploadStato);

      if (data.q) q = q.ilike("nome", `%${data.q}%`);
      if (data.categoria) q = q.eq("categoria", data.categoria);
      if (data.cliente_id) q = q.eq("cliente_id", data.cliente_id);
      if (data.fornitore_id) q = q.eq("fornitore_id", data.fornitore_id);
      if (data.commessa_id) q = q.eq("commessa_id", data.commessa_id);
      if (data.cantiere_id) q = q.eq("cantiere_id", data.cantiere_id);
      q = applyScadenzaFilter(q, data.stato_scadenza ?? null);

      q = q.order(sort, { ascending: sort === "nome" || sort === "data_scadenza", nullsFirst: false });
      q = q.range((page - 1) * pageSize, page * pageSize - 1);

      const { data: rows, error, count } = await q;
      if (error) throw error;
      const lookups = await buildLookups(context.supabase, ctx.organizationId, rows ?? []);
      return {
        items: (rows ?? []).map((r: any) => toListDTO(r, lookups)),
        total: count ?? 0,
        page,
        pageSize,
        capabilities: ctx.caps,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      const { data: row } = await context.supabase
        .from("documenti")
        .select(DOC_DETAIL_COLS)
        .eq("id", data.id)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (!row) throw new Error(ERR_NOT_FOUND);
      if (row.upload_stato !== "disponibile" && !ctx.caps.canAdmin && row.created_by !== context.userId) {
        throw new Error(ERR_NOT_FOUND);
      }
      const lookups = await buildLookups(context.supabase, ctx.organizationId, [row]);
      const dto = toDetailDTO(row, lookups, ctx.caps);
      return { ...dto, preview_supportata: canPreview(row.mime_type) };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const updateSchema = z.object({
  id: uuid,
  expected_updated_at: z.string().min(1),
  nome: z.string().trim().min(1).max(200).optional(),
  descrizione: z.string().trim().max(2000).nullable().optional(),
  categoria: z.string().trim().max(60).nullable().optional(),
  data_documento: z.string().nullable().optional(),
  data_scadenza: z.string().nullable().optional(),
  visibilita: z.enum(["privato", "organizzazione"]).optional(),
  cliente_id: nullableUuid,
  fornitore_id: nullableUuid,
  commessa_id: nullableUuid,
  cantiere_id: nullableUuid,
  preventivo_id: nullableUuid,
  dipendente_id: nullableUuid,
});

export const updateDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      assertManage(ctx);
      assertCategoria(data.categoria);
      const doc = await loadDocumentoInternal(context.supabase, ctx.organizationId, data.id);
      if (new Date(doc.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
        throw new Error(ERR_CONFLICT);
      }
      const assoc = {
        cliente_id: data.cliente_id ?? null,
        fornitore_id: data.fornitore_id ?? null,
        commessa_id: data.commessa_id ?? null,
        cantiere_id: data.cantiere_id ?? null,
        preventivo_id: data.preventivo_id ?? null,
        dipendente_id: data.dipendente_id ?? null,
      };
      await validateAssociazioni(context.supabase, ctx.organizationId, assoc);

      const patch: Record<string, unknown> = { ...assoc, updated_by: context.userId };
      if (data.nome !== undefined) patch.nome = data.nome;
      if (data.descrizione !== undefined) patch.descrizione = data.descrizione;
      if (data.categoria !== undefined) patch.categoria = data.categoria;
      if (data.data_documento !== undefined) patch.data_documento = data.data_documento || null;
      if (data.data_scadenza !== undefined) patch.data_scadenza = data.data_scadenza || null;
      if (data.visibilita !== undefined) patch.visibilita = data.visibilita;

      const { data: updated, error } = await context.supabase
        .from("documenti")
        .update(patch as any)
        .eq("id", data.id)
        .eq("organization_id", ctx.organizationId)
        .eq("updated_at", doc.updated_at)
        .select("id, updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error(ERR_CONFLICT);

      await audit(ctx.organizationId, context.userId, "documento_modificato", data.id, {
        campi: Object.keys(patch).filter((k) => k !== "updated_by"),
      });
      return { id: updated.id, updated_at: updated.updated_at };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

/**
 * Archiviazione dell'intero documento logico (tutte le versioni della catena),
 * in modo ATOMICO tramite RPC. Una versione storica non può essere archiviata
 * isolatamente.
 */
export const archiveDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      assertManage(ctx);
      await loadDocumentoInternal(context.supabase, ctx.organizationId, data.id);
      const { data: res, error } = await context.supabase.rpc("archive_documento_chain", {
        _id: data.id,
        _archive: true,
      });
      if (error) throw error;
      const r = (res ?? {}) as any;
      return {
        id: data.id,
        archived: true,
        versioni: Number(r.versioni ?? 0),
        idempotent: !!r.idempotent,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

/** Ripristino atomico dell'intera catena versioni. */
export const restoreDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      assertManage(ctx);
      await loadDocumentoInternal(context.supabase, ctx.organizationId, data.id);
      const { data: res, error } = await context.supabase.rpc("archive_documento_chain", {
        _id: data.id,
        _archive: false,
      });
      if (error) throw error;
      const r = (res ?? {}) as any;
      return {
        id: data.id,
        archived: false,
        versioni: Number(r.versioni ?? 0),
        idempotent: !!r.idempotent,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });


const versionSchema = z.object({
  documento_id: uuid,
  file_name_originale: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().min(1).max(160),
  file_size: z.number().int().positive(),
  note_versione: z.string().trim().max(500).nullable().optional(),
});

export const prepareDocumentoVersionUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => versionSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      assertUpload(ctx);
      const check = validateFile({
        fileName: data.file_name_originale,
        mimeType: data.mime_type,
        fileSize: data.file_size,
      });
      if (!check.ok) throw new Error(check.error);

      const corrente = await loadDocumentoInternal(context.supabase, ctx.organizationId, data.documento_id);
      if (corrente.archived_at) throw new Error("Il documento è archiviato. Ripristinalo prima di modificarlo.");

      const chain = await versionChain(context.supabase, ctx.organizationId, corrente.id);
      const maxVersione = Math.max(...chain.map((c: any) => Number(c.versione) || 1), 1);

      const { data: base } = await context.supabase
        .from("documenti")
        .select(
          "nome, descrizione, categoria, data_documento, data_scadenza, visibilita, cliente_id, fornitore_id, commessa_id, cantiere_id, preventivo_id, dipendente_id",
        )
        .eq("id", corrente.id)
        .eq("organization_id", ctx.organizationId)
        .single();

      const { data: created, error } = await context.supabase
        .from("documenti")
        .insert({
          ...(base as any),
          organization_id: ctx.organizationId,
          documento_precedente_id: corrente.id,
          versione: maxVersione + 1,
          is_versione_corrente: false,
          upload_stato: "preparato",
          storage_bucket: DOCUMENTI_BUCKET,
          file_name_originale: data.file_name_originale,
          mime_type: data.mime_type,
          size_bytes: data.file_size,
          note_versione: data.note_versione ?? null,
          created_by: context.userId,
          uploaded_by: context.userId,
          updated_by: context.userId,
        } as any)
        .select("id, versione")
        .single();
      if (error) throw error;

      const path = buildStoragePath(
        ctx.organizationId,
        created.id,
        created.versione,
        data.file_name_originale,
      );
      const { error: pErr } = await context.supabase
        .from("documenti")
        .update({ storage_path: path })
        .eq("id", created.id)
        .eq("organization_id", ctx.organizationId);
      if (pErr) throw pErr;

      await audit(ctx.organizationId, context.userId, "documento_versione_preparata", created.id, {
        precedente: corrente.id,
        versione: created.versione,
      });
      return {
        document_id: created.id as string,
        bucket: DOCUMENTI_BUCKET,
        path,
        versione: created.versione as number,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const finalizeDocumentoVersionUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ document_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      assertUpload(ctx);
      const doc = await loadDocumentoInternal(context.supabase, ctx.organizationId, data.document_id);

      if (doc.upload_stato === "disponibile" && doc.is_versione_corrente) {
        return { document_id: doc.id, upload_stato: "disponibile", idempotent: true };
      }
      if (doc.upload_stato !== "preparato" && doc.upload_stato !== "disponibile") {
        throw new Error(ERR_FILE_MISSING);
      }
      const obj = await storageObjectExists(context.supabase, doc.storage_path);
      if (!obj.exists) {
        await context.supabase
          .from("documenti")
          .update({ upload_stato: "fallito", updated_by: context.userId })
          .eq("id", doc.id)
          .eq("organization_id", ctx.organizationId)
          .eq("upload_stato", "preparato");
        await audit(ctx.organizationId, context.userId, "documento_upload_fallito", doc.id, {});
        throw new Error(ERR_FILE_MISSING);
      }

      const chain = await versionChain(context.supabase, ctx.organizationId, doc.id);
      const others = chain.filter((c: any) => c.id !== doc.id).map((c: any) => c.id);
      if (others.length) {
        await context.supabase
          .from("documenti")
          .update({ is_versione_corrente: false })
          .eq("organization_id", ctx.organizationId)
          .in("id", others);
      }
      const { error } = await context.supabase
        .from("documenti")
        .update({
          upload_stato: "disponibile",
          is_versione_corrente: true,
          size_bytes: obj.size ?? doc.size_bytes,
          mime_type: obj.mime ?? doc.mime_type,
          updated_by: context.userId,
          uploaded_by: context.userId,
        })
        .eq("id", doc.id)
        .eq("organization_id", ctx.organizationId);
      if (error) throw error;

      await audit(ctx.organizationId, context.userId, "documento_versione_finalizzata", doc.id, {
        versione: doc.versione,
      });
      return { document_id: doc.id, upload_stato: "disponibile", idempotent: false };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const listDocumentoVersioni = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      const doc = await loadDocumentoInternal(context.supabase, ctx.organizationId, data.id);
      const chain = await versionChain(context.supabase, ctx.organizationId, doc.id);
      const ids = chain.map((c: any) => c.id);
      const { data: rows } = await context.supabase
        .from("documenti")
        .select(DOC_LIST_COLS)
        .eq("organization_id", ctx.organizationId)
        .in("id", ids)
        .order("versione", { ascending: false });
      const lookups = await buildLookups(context.supabase, ctx.organizationId, rows ?? []);
      return (rows ?? []).map((r: any) => toListDTO(r, lookups));
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const createDocumentoDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      const doc = await loadDocumentoInternal(context.supabase, ctx.organizationId, data.id);
      if (doc.upload_stato !== "disponibile" || !doc.storage_path) throw new Error(ERR_FILE_MISSING);
      const { data: signed, error } = await context.supabase.storage
        .from(DOCUMENTI_BUCKET)
        .createSignedUrl(doc.storage_path, 120, {
          download: doc.file_name_originale ?? doc.nome ?? true,
        });
      if (error || !signed?.signedUrl) throw new Error(ERR_FILE_MISSING);
      return { url: signed.signedUrl as string, expires_in: 120 };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const createDocumentoPreviewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      const doc = await loadDocumentoInternal(context.supabase, ctx.organizationId, data.id);
      if (doc.upload_stato !== "disponibile" || !doc.storage_path) throw new Error(ERR_FILE_MISSING);
      if (!canPreview(doc.mime_type)) throw new Error("Anteprima non disponibile per questo formato.");
      const { data: signed, error } = await context.supabase.storage
        .from(DOCUMENTI_BUCKET)
        .createSignedUrl(doc.storage_path, 120);
      if (error || !signed?.signedUrl) throw new Error(ERR_FILE_MISSING);
      return { url: signed.signedUrl as string, expires_in: 120, mime_type: doc.mime_type };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const scadenziarioSchema = z.object({
  filtro: z
    .enum(["default", "scaduti", "oggi", "7", "30", "60", "validi", "senza_scadenza", "tutti"])
    .nullable()
    .optional(),
  categoria: z.string().trim().max(60).nullable().optional(),
  commessa_id: nullableUuid,
  includeArchived: z.boolean().nullable().optional(),
});

export const listScadenziario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scadenziarioSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    try {
      const ctx = await resolveDocContext(context.supabase, context.userId);
      let q = context.supabase
        .from("documenti")
        .select(DOC_LIST_COLS)
        .eq("organization_id", ctx.organizationId)
        .eq("upload_stato", "disponibile")
        .eq("is_versione_corrente", true)
        .limit(500);
      if (!data.includeArchived) q = q.is("archived_at", null);
      if (data.categoria) q = q.eq("categoria", data.categoria);
      if (data.commessa_id) q = q.eq("commessa_id", data.commessa_id);
      q = scadenziarioRange(q, data.filtro ?? "default");
      q = q.order("data_scadenza", { ascending: true, nullsFirst: false });
      const { data: rows, error } = await q;
      if (error) throw error;
      const lookups = await buildLookups(context.supabase, ctx.organizationId, rows ?? []);
      return {
        items: (rows ?? []).map((r: any) => toListDTO(r, lookups)),
        capabilities: ctx.caps,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
