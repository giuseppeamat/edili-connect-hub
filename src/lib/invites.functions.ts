import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomBytes } from "crypto";

type AppRole =
  | "proprietario"
  | "amministratore"
  | "ufficio_tecnico"
  | "amministrazione"
  | "responsabile_commessa"
  | "capocantiere"
  | "operaio"
  | "cliente"
  | "fornitore";

// Ruoli che possono essere invitati / assegnati via inviti.
// 'proprietario' MAI (nessun secondo proprietario via invito - Sprint 1).
const INVITABLE_ROLES: AppRole[] = [
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
  "operaio",
  "cliente",
  "fornitore",
];

const INVITE_TTL_DAYS = 7;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function generateToken(): string {
  // 32 byte -> 43 char base64url. Nessun padding.
  return randomBytes(32).toString("base64url");
}

function tokenPreview(token: string): string {
  // Solo per audit/log — mostra 4 char iniziali + finali, mai il token intero.
  if (token.length < 12) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function assertCallerCanManageInvites(context: any, organizationId: string) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("organization_id", organizationId);
  if (error) throw new Error("Impossibile verificare i permessi");
  const roles = (data ?? []).map((r: any) => r.role as AppRole);
  const isOwner = roles.includes("proprietario");
  const isAdmin = roles.includes("amministratore");
  if (!isOwner && !isAdmin) throw new Error("Non autorizzato");
  return { isOwner, isAdmin, roles };
}

function assertRoleAssignable(role: AppRole, callerIsOwner: boolean) {
  if (!INVITABLE_ROLES.includes(role)) {
    throw new Error("Ruolo non assegnabile via invito");
  }
  // Un amministratore non può invitare/creare un altro amministratore.
  if (role === "amministratore" && !callerIsOwner) {
    throw new Error("Solo il proprietario può assegnare il ruolo Amministratore");
  }
}

async function getCallerOrganizationId(context: any): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (error || !data?.organization_id) throw new Error("Organizzazione non trovata");
  return data.organization_id as string;
}

async function logAudit(
  context: any,
  organizationId: string,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    organization_id: organizationId,
    user_id: context.userId,
    action,
    entity,
    entity_id: entityId,
    metadata: metadata as any,
  });
}

// ---------------------- CREATE INVITE ----------------------
export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().transform((s) => s.trim().toLowerCase()),
        role: z.enum([
          "amministratore",
          "ufficio_tecnico",
          "amministrazione",
          "responsabile_commessa",
          "capocantiere",
          "operaio",
          "cliente",
          "fornitore",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getCallerOrganizationId(context);
    const { isOwner } = await assertCallerCanManageInvites(context, organizationId);
    assertRoleAssignable(data.role as AppRole, isOwner);

    // Se l'email è già membro attivo dell'organizzazione → errore
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existingUser } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("email", data.email)
      .maybeSingle();
    if (existingUser?.organization_id === organizationId) {
      throw new Error("Questo utente è già membro dell'organizzazione");
    }
    if (existingUser?.organization_id && existingUser.organization_id !== organizationId) {
      throw new Error("Questo utente appartiene già a un'altra organizzazione");
    }

    const token = generateToken();
    const token_hash = sha256(token);
    const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Se c'è un pending precedente, revocalo prima (per rispettare l'unique index parziale)
    await supabaseAdmin
      .from("invites")
      .update({ status: "revoked", revoked_by: context.userId, revoked_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .ilike("email", data.email);

    const { data: inv, error } = await supabaseAdmin
      .from("invites")
      .insert({
        organization_id: organizationId,
        email: data.email,
        role: data.role,
        token_hash,
        expires_at,
        created_by: context.userId,
      })
      .select("id, expires_at")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(context, organizationId, "invite.create", "invites", inv.id, {
      email: data.email,
      role: data.role,
      token_preview: tokenPreview(token),
      expires_at,
    });

    // Il token è restituito UNA SOLA VOLTA. Non è persistito né loggato.
    return { invite_id: inv.id, token, expires_at: inv.expires_at };
  });

// ---------------------- REGENERATE ----------------------
export const regenerateInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invite_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await supabaseAdmin
      .from("invites")
      .select("id, organization_id, email, role, status")
      .eq("id", data.invite_id)
      .maybeSingle();
    if (!inv) throw new Error("Invito non trovato");

    const { isOwner } = await assertCallerCanManageInvites(context, inv.organization_id);
    assertRoleAssignable(inv.role as AppRole, isOwner);
    if (inv.status === "accepted") throw new Error("Invito già accettato, non rigenerabile");

    const token = generateToken();
    const token_hash = sha256(token);
    const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabaseAdmin
      .from("invites")
      .update({
        token_hash,
        expires_at,
        status: "pending",
        revoked_at: null,
        revoked_by: null,
      })
      .eq("id", inv.id);
    if (error) throw new Error(error.message);

    await logAudit(context, inv.organization_id, "invite.regenerate", "invites", inv.id, {
      email: inv.email,
      token_preview: tokenPreview(token),
      expires_at,
    });

    return { invite_id: inv.id, token, expires_at };
  });

// ---------------------- REVOKE ----------------------
export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ invite_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await supabaseAdmin
      .from("invites")
      .select("id, organization_id, status, email")
      .eq("id", data.invite_id)
      .maybeSingle();
    if (!inv) throw new Error("Invito non trovato");
    await assertCallerCanManageInvites(context, inv.organization_id);
    if (inv.status !== "pending") throw new Error("Invito non revocabile");

    const { error } = await supabaseAdmin
      .from("invites")
      .update({ status: "revoked", revoked_by: context.userId, revoked_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (error) throw new Error(error.message);

    await logAudit(context, inv.organization_id, "invite.revoke", "invites", inv.id, {
      email: inv.email,
    });
    return { ok: true };
  });

// ---------------------- LOOKUP (pubblico, per pagina /accetta-invito) ----------------------
export const lookupInvite = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(20).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token_hash = sha256(data.token);
    const { data: inv } = await supabaseAdmin
      .from("invites")
      .select("id, organization_id, email, role, status, expires_at, organizations(nome)")
      .eq("token_hash", token_hash)
      .maybeSingle();
    if (!inv) return { valid: false as const, reason: "not_found" as const };
    if (inv.status !== "pending") return { valid: false as const, reason: inv.status };
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      // Auto-mark as expired
      await supabaseAdmin.from("invites").update({ status: "expired" }).eq("id", inv.id);
      return { valid: false as const, reason: "expired" as const };
    }
    return {
      valid: true as const,
      email: inv.email as string,
      role: inv.role as AppRole,
      organization_nome: ((inv as any).organizations?.nome ?? null) as string | null,
      expires_at: inv.expires_at as string,
    };
  });

// ---------------------- ACCEPT (utente autenticato) ----------------------
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ token: z.string().min(20).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token_hash = sha256(data.token);

    const { data: inv } = await supabaseAdmin
      .from("invites")
      .select("id, organization_id, email, role, status, expires_at")
      .eq("token_hash", token_hash)
      .maybeSingle();
    if (!inv) throw new Error("Invito non valido");
    if (inv.status !== "pending") throw new Error("Invito non più valido");
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      await supabaseAdmin.from("invites").update({ status: "expired" }).eq("id", inv.id);
      throw new Error("Invito scaduto");
    }

    // Email dell'utente autenticato deve corrispondere all'invito
    const callerEmail = (context.claims as any)?.email?.toLowerCase();
    if (!callerEmail || callerEmail !== inv.email.toLowerCase()) {
      throw new Error(
        "L'invito è stato emesso per un'email diversa. Accedi con l'email indicata nell'invito.",
      );
    }

    // L'utente non deve appartenere già a un'altra organizzazione
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", context.userId)
      .maybeSingle();

    if (existingProfile?.organization_id && existingProfile.organization_id !== inv.organization_id) {
      throw new Error("Sei già associato a un'altra organizzazione");
    }

    // Se il profilo esiste ma organization_id è null (caso raro), lo aggancio.
    // Altrimenti l'utente è nuovo: il trigger handle_new_user crea sempre una org.
    // In quel caso: se ha già la stessa org, ok; se ne ha una diversa creata dal trigger,
    // rimuovo quella org "vuota" e riaggancio.
    if (existingProfile && existingProfile.organization_id !== inv.organization_id) {
      const orgToRemove = existingProfile.organization_id;

      // Rimuovi ruoli sull'org vuota (se solo lui) e la org
      if (orgToRemove) {
        const { count } = await supabaseAdmin
          .from("user_roles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgToRemove);
        // Sposta il profilo
      }

      // Aggancio profilo all'org dell'invito (bypass trigger)
      await supabaseAdmin.rpc("set_config" as any, {} as any); // no-op placeholder
      const { error: updErr } = await supabaseAdmin
        .from("profiles")
        .update({ organization_id: inv.organization_id })
        .eq("id", context.userId);
      if (updErr) throw new Error(`Impossibile associare l'organizzazione: ${updErr.message}`);

      // Rimuovi eventuali ruoli 'proprietario' sull'org auto-creata
      if (orgToRemove) {
        await supabaseAdmin
          .from("user_roles")
          .delete()
          .eq("user_id", context.userId)
          .eq("organization_id", orgToRemove);
        // Elimina l'org auto-creata se non ha più membri
        const { count: remaining } = await supabaseAdmin
          .from("user_roles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgToRemove);
        if ((remaining ?? 0) === 0) {
          await supabaseAdmin.from("organizations").delete().eq("id", orgToRemove);
        }
      }
    }

    // Assegna il ruolo previsto (solo uno)
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: context.userId, organization_id: inv.organization_id, role: inv.role },
        { onConflict: "user_id,organization_id,role" },
      );
    if (roleErr) throw new Error(roleErr.message);

    // Marca l'invito come accettato
    await supabaseAdmin
      .from("invites")
      .update({ status: "accepted", accepted_by: context.userId, accepted_at: new Date().toISOString() })
      .eq("id", inv.id);

    await logAudit(context, inv.organization_id, "invite.accept", "invites", inv.id, {
      email: inv.email,
      role: inv.role,
    });

    return { ok: true, organization_id: inv.organization_id };
  });

// ---------------------- CHANGE MEMBER ROLE ----------------------
export const changeMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum([
          "amministratore",
          "ufficio_tecnico",
          "amministrazione",
          "responsabile_commessa",
          "capocantiere",
          "operaio",
          "cliente",
          "fornitore",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getCallerOrganizationId(context);
    const { isOwner } = await assertCallerCanManageInvites(context, organizationId);
    assertRoleAssignable(data.role as AppRole, isOwner);

    if (data.user_id === context.userId) throw new Error("Non puoi modificare il tuo ruolo");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verifica che il target sia nella stessa org
    const { data: targetProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!targetProfile || targetProfile.organization_id !== organizationId) {
      throw new Error("Utente non appartenente all'organizzazione");
    }

    // Blocca modifiche a un proprietario
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id)
      .eq("organization_id", organizationId);
    const isTargetOwner = (targetRoles ?? []).some((r: any) => r.role === "proprietario");
    if (isTargetOwner) throw new Error("Il proprietario non può essere modificato");

    // Sostituisci i ruoli con quello nuovo (single-role model in Sprint 1)
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .eq("organization_id", organizationId);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, organization_id: organizationId, role: data.role });
    if (error) throw new Error(error.message);

    await logAudit(context, organizationId, "member.role_change", "user_roles", data.user_id, {
      new_role: data.role,
    });
    return { ok: true };
  });

// ---------------------- DEACTIVATE / REACTIVATE MEMBER ----------------------
export const setMemberActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ user_id: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await getCallerOrganizationId(context);
    await assertCallerCanManageInvites(context, organizationId);
    if (data.user_id === context.userId) throw new Error("Non puoi disattivare te stesso");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (!targetProfile || targetProfile.organization_id !== organizationId) {
      throw new Error("Utente non appartenente all'organizzazione");
    }

    // Blocca disattivazione proprietario
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id)
      .eq("organization_id", organizationId);
    const isTargetOwner = (targetRoles ?? []).some((r: any) => r.role === "proprietario");
    if (isTargetOwner) throw new Error("Il proprietario non può essere disattivato");

    // Bypass trigger di protezione via setting locale
    const client = supabaseAdmin;
    // Nota: il trigger tg_profiles_protect_sensitive blocca UPDATE su is_active
    // a meno che app.allow_member_admin = 'on'. Usiamo un RPC dedicato invece.
    const { error } = await client.rpc("admin_set_member_active" as any, {
      _user: data.user_id,
      _org: organizationId,
      _active: data.active,
      _actor: context.userId,
    });
    if (error) throw new Error(error.message);

    await logAudit(
      context,
      organizationId,
      data.active ? "member.reactivate" : "member.deactivate",
      "profiles",
      data.user_id,
      {},
    );
    return { ok: true };
  });
