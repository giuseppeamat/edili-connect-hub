import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleEnum = z.enum([
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
  "operaio",
  "cliente",
  "fornitore",
]);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null));

function mapDbError(message: string): string {
  if (/duplicate key|23505/i.test(message) && /email/i.test(message)) {
    return "Esiste già un membro con questa email nell'organizzazione";
  }
  return message;
}

async function callerOrganizationId(context: any): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (error || !data?.organization_id) throw new Error("Organizzazione non trovata");
  return data.organization_id as string;
}

// ---------------------- LIST ----------------------
export const listOrganizationMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ includeArchived: z.boolean().optional().default(false) })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await callerOrganizationId(context);

    let query = context.supabase
      .from("organization_members")
      .select(
        "id, user_id, nome, cognome, email, telefono, ruolo_organizzativo, qualifica, stato_accesso, is_active, archived_at, updated_at, created_at",
      )
      .eq("organization_id", organizationId)
      .order("cognome", { ascending: true, nullsFirst: false })
      .order("nome", { ascending: true });

    if (!data.includeArchived) query = query.is("archived_at", null);

    const { data: members, error } = await query;
    if (error) throw new Error(error.message);

    // Inviti pendenti per derivare lo stato "invitato" / "invito scaduto".
    const { data: invites } = await context.supabase
      .from("invites")
      .select("member_id, email, status, expires_at")
      .eq("organization_id", organizationId)
      .eq("status", "pending");

    const inviteByMember = new Map<string, { status: string; expires_at: string }>();
    (invites ?? []).forEach((i: any) => {
      if (i.member_id) inviteByMember.set(i.member_id, { status: i.status, expires_at: i.expires_at });
    });

    return (members ?? []).map((m: any) => ({
      ...m,
      invito: inviteByMember.get(m.id) ?? null,
    }));
  });

// ---------------------- CREATE ----------------------
export const createOrganizationMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        nome: z.string().trim().min(1, "Il nome è obbligatorio").max(80),
        cognome: optionalText(80),
        email: z
          .string()
          .trim()
          .email("Email non valida")
          .max(255)
          .optional()
          .nullable()
          .or(z.literal(""))
          .transform((v) => (v && v !== "" ? String(v).toLowerCase() : null)),
        telefono: optionalText(40),
        ruolo_organizzativo: roleEnum,
        qualifica: optionalText(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("create_organization_member", {
      _nome: data.nome,
      _cognome: data.cognome ?? undefined,
      _email: data.email ?? undefined,
      _telefono: data.telefono ?? undefined,
      _ruolo: data.ruolo_organizzativo,
      _qualifica: data.qualifica ?? undefined,
    });
    if (error) throw new Error(mapDbError(error.message));
    const row = Array.isArray(res) ? res[0] : res;
    return { id: row?.id as string, updated_at: row?.updated_at as string };
  });

// ---------------------- UPDATE ----------------------
export const updateOrganizationMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        expected_updated_at: z.string(),
        nome: z.string().trim().min(1).max(80),
        cognome: optionalText(80),
        email: z
          .string()
          .trim()
          .email("Email non valida")
          .max(255)
          .optional()
          .nullable()
          .or(z.literal(""))
          .transform((v) => (v && v !== "" ? String(v).toLowerCase() : null)),
        telefono: optionalText(40),
        ruolo_organizzativo: roleEnum.optional().nullable(),
        qualifica: optionalText(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("update_organization_member", {
      _id: data.id,
      _expected_updated_at: data.expected_updated_at,
      _nome: data.nome,
      _cognome: data.cognome ?? undefined,
      _email: data.email ?? undefined,
      _telefono: data.telefono ?? undefined,
      _ruolo: data.ruolo_organizzativo ?? undefined,
      _qualifica: data.qualifica ?? undefined,
    });
    if (error) throw new Error(mapDbError(error.message));
    const row = Array.isArray(res) ? res[0] : res;
    return { id: row?.id as string, updated_at: row?.updated_at as string };
  });

// ---------------------- ARCHIVE / RESTORE ----------------------
export const archiveOrganizationMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("archive_organization_member", { _id: data.id });
    if (error) throw new Error(mapDbError(error.message));
    return { ok: true };
  });

export const restoreOrganizationMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("restore_organization_member", { _id: data.id });
    if (error) throw new Error(mapDbError(error.message));
    return { ok: true };
  });

// ---------------------- ACCESSO: disabilita / riattiva ----------------------
export const setOrganizationMemberAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        stato: z.enum(["senza_accesso", "invitato", "attivo", "invito_scaduto", "disabilitato"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_organization_member_access", {
      _id: data.id,
      _stato: data.stato,
    });
    if (error) throw new Error(mapDbError(error.message));

    // Se il membro ha un account collegato, allinea anche l'accesso reale.
    const { data: member } = await context.supabase
      .from("organization_members")
      .select("user_id, organization_id")
      .eq("id", data.id)
      .maybeSingle();

    if (member?.user_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: rpcErr } = await supabaseAdmin.rpc("admin_set_member_active" as any, {
        _user: member.user_id,
        _org: member.organization_id,
        _active: data.stato === "attivo",
        _actor: context.userId,
      } as any);
      if (rpcErr) throw new Error(rpcErr.message);
    }
    return { ok: true };
  });

// ---------------------- MEMBRI ASSEGNABILI ----------------------
/** Elenco leggero per le select di assegnazione (rapportini, tariffe, team). */
export const listAssignableMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await callerOrganizationId(context);
    const { data, error } = await context.supabase
      .from("organization_members")
      .select("id, user_id, nome, cognome, ruolo_organizzativo")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("is_active", true)
      .order("cognome", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
