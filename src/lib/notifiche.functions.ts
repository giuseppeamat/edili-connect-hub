import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";
import { normalizeSeverita, type NotificaDTO } from "@/lib/notifiche-model";

/**
 * Sprint 8 — Server functions NOTIFICHE.
 * Il client non invia mai organization_id, destinatario o dedupe_key:
 * tutto è risolto server-side da auth.uid() e dalle RPC SECURITY DEFINER.
 */

const uuid = z.string().uuid();

const SELECT_COLS =
  "id, tipo, severita, titolo, messaggio, entity_type, entity_id, route, created_at, read_at, archived_at";

async function currentOrgId(context: any): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("organization_id, is_active")
    .eq("id", context.userId)
    .maybeSingle();
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  if (prof.is_active === false) throw new Error("Utente disattivato");
  return prof.organization_id as string;
}

function toDTO(r: any): NotificaDTO {
  return {
    id: r.id,
    tipo: r.tipo,
    severita: normalizeSeverita(r.severita),
    titolo: r.titolo,
    messaggio: r.messaggio ?? null,
    entity_type: r.entity_type ?? null,
    entity_id: r.entity_id ?? null,
    route: r.route ?? null,
    created_at: r.created_at,
    read_at: r.read_at ?? null,
    archived_at: r.archived_at ?? null,
  };
}

/**
 * Sintesi per la campanella: esegue lo sweep idempotente delle condizioni
 * temporali, poi restituisce conteggio non lette + anteprima.
 * Una sola andata/ritorno: nessun N+1.
 */
export const getNotificheSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const org = await currentOrgId(context);
      // Sweep idempotente (dedupe a livello DB): genera/risolve condizioni temporali.
      await context.supabase.rpc("notifiche_sweep" as any);

      const [{ count, error: cErr }, { data: rows, error: lErr }] = await Promise.all([
        context.supabase
          .from("notifiche")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org)
          .eq("destinatario_user_id", context.userId)
          .is("archived_at", null)
          .is("read_at", null),
        context.supabase
          .from("notifiche")
          .select(SELECT_COLS)
          .eq("organization_id", org)
          .eq("destinatario_user_id", context.userId)
          .is("archived_at", null)
          .order("read_at", { ascending: true, nullsFirst: true })
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      if (cErr) throw cErr;
      if (lErr) throw lErr;
      return { unreadCount: count ?? 0, preview: (rows ?? []).map(toDTO) };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const listSchema = z.object({
  stato: z.enum(["non_lette", "tutte", "archiviate"]).default("tutte"),
  tipo: z.string().nullable().optional(),
  severita: z.enum(["info", "attenzione", "critica"]).nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  q: z.string().trim().max(200).nullable().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
});

export const listNotifiche = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    try {
      const org = await currentOrgId(context);
      let q = context.supabase
        .from("notifiche")
        .select(SELECT_COLS, { count: "exact" })
        .eq("organization_id", org)
        .eq("destinatario_user_id", context.userId);

      if (data.stato === "archiviate") q = q.not("archived_at", "is", null);
      else q = q.is("archived_at", null);
      if (data.stato === "non_lette") q = q.is("read_at", null);
      if (data.tipo) q = q.eq("tipo", data.tipo);
      if (data.severita) q = q.eq("severita", data.severita);
      if (data.from) q = q.gte("created_at", data.from);
      if (data.to) q = q.lte("created_at", data.to);
      if (data.q) q = q.or(`titolo.ilike.%${data.q}%,messaggio.ilike.%${data.q}%`);

      const fromIdx = (data.page - 1) * data.pageSize;
      const { data: rows, count, error } = await q
        .order("created_at", { ascending: false })
        .range(fromIdx, fromIdx + data.pageSize - 1);
      if (error) throw error;
      return {
        rows: (rows ?? []).map(toDTO),
        total: count ?? 0,
        page: data.page,
        pageSize: data.pageSize,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getUnreadCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const org = await currentOrgId(context);
      const { count, error } = await context.supabase
        .from("notifiche")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org)
        .eq("destinatario_user_id", context.userId)
        .is("archived_at", null)
        .is("read_at", null);
      if (error) throw error;
      return { unreadCount: count ?? 0 };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const markNotificaRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      await currentOrgId(context);
      const { error } = await context.supabase.rpc("mark_notifica_read" as any, {
        _id: data.id,
        _read: true,
      });
      if (error) throw error;
      return { ok: true as const };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const markNotificaUnread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      await currentOrgId(context);
      const { error } = await context.supabase.rpc("mark_notifica_read" as any, {
        _id: data.id,
        _read: false,
      });
      if (error) throw error;
      return { ok: true as const };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const markAllNotificheRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      await currentOrgId(context);
      const { data: n, error } = await context.supabase.rpc("mark_all_notifiche_read" as any);
      if (error) throw error;
      return { updated: (n as number) ?? 0 };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const archiveNotifica = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      await currentOrgId(context);
      const { error } = await context.supabase.rpc("archive_notifica" as any, { _id: data.id });
      if (error) throw error;
      return { ok: true as const };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const archiveAllReadNotifiche = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      await currentOrgId(context);
      const { data: n, error } = await context.supabase.rpc(
        "archive_all_read_notifiche" as any,
      );
      if (error) throw error;
      return { archived: (n as number) ?? 0 };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
