import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole =
  | "proprietario" | "amministratore" | "ufficio_tecnico" | "amministrazione"
  | "responsabile_commessa" | "capocantiere" | "operaio" | "cliente" | "fornitore";

const STATI_CANTIERE = ["pianificato","attivo","sospeso","completato","chiuso","archiviato"] as const;
const CAPOCANTIERE_ROLES: AppRole[] = ["capocantiere","responsabile_commessa","ufficio_tecnico","amministratore", "amministrazione","proprietario"];

async function ctx(context: any): Promise<{ organizationId: string; roles: AppRole[] }> {
  const [{ data: prof }, { data: rows }] = await Promise.all([
    context.supabase.from("profiles").select("organization_id, is_active").eq("id", context.userId).maybeSingle(),
    context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
  ]);
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  if (prof.is_active === false) throw new Error("Utente disattivato");
  return {
    organizationId: prof.organization_id as string,
    roles: (rows ?? []).map((r: any) => r.role as AppRole),
  };
}

function hasAny(roles: AppRole[], allowed: AppRole[]) {
  return allowed.some((r) => roles.includes(r));
}

async function logAudit(context: any, orgId: string, action: string, entityId: string, meta: Record<string, unknown> = {}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    organization_id: orgId, user_id: context.userId, action,
    entity: "cantieri", entity_id: entityId, metadata: meta as any,
  });
}

async function fetchCommessa(context: any, id: string, orgId: string) {
  const { data } = await context.supabase.from("commesse")
    .select("id, organization_id, responsabile_id, closed_at, archived_at")
    .eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (!data) throw new Error("Commessa non trovata");
  return data;
}

async function fetchCantiere(context: any, id: string, orgId: string) {
  const { data } = await context.supabase.from("cantieri")
    .select("*").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (!data) throw new Error("Cantiere non trovato");
  return data;
}

function assertCanManageCantieri(commessa: any, roles: AppRole[], userId: string) {
  if (hasAny(roles, ["proprietario","amministratore", "amministrazione","ufficio_tecnico"])) return;
  if (hasAny(roles, ["responsabile_commessa"]) && commessa.responsabile_id === userId) return;
  throw new Error("Non autorizzato a gestire i cantieri di questa commessa");
}

async function assertCapocantiereValid(context: any, orgId: string, userId: string) {
  const { data: p } = await context.supabase
    .from("profiles").select("id, is_active, organization_id").eq("id", userId).maybeSingle();
  if (!p || p.organization_id !== orgId || p.is_active === false) {
    throw new Error("Utente non attivo o fuori organizzazione");
  }
  const { data: r } = await context.supabase.from("user_roles")
    .select("role").eq("user_id", userId).eq("organization_id", orgId);
  const rolesU = (r ?? []).map((x: any) => x.role as AppRole);
  if (!rolesU.some((rr: AppRole) => CAPOCANTIERE_ROLES.includes(rr))) {
    throw new Error("Ruolo utente non compatibile con capocantiere");
  }
}

// ============= LIST =============
export const listCantieri = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    commessa_id: z.string().uuid(),
    includeArchived: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId } = await ctx(context);
    let q = context.supabase.from("cantieri").select("*")
      .eq("commessa_id", data.commessa_id)
      .eq("organization_id", organizationId)
      .order("is_principale", { ascending: false })
      .order("created_at", { ascending: true });
    if (!data.includeArchived) q = q.is("archived_at", null);
    const { data: rows, error } = await q;
    if (error) throw error;

    const ids = Array.from(new Set([
      ...(rows ?? []).map((r: any) => r.responsabile_id).filter(Boolean),
      ...(rows ?? []).map((r: any) => r.capocantiere_id).filter(Boolean),
    ]));
    const profMap = new Map<string, any>();
    if (ids.length) {
      const { data: profs } = await context.supabase
        .from("profiles").select("id, nome, cognome, email").in("id", ids);
      for (const p of profs ?? []) profMap.set(p.id, p);
    }

    // Numero membri attivi per cantiere
    const cantIds = (rows ?? []).map((r: any) => r.id);
    const memberCounts = new Map<string, number>();
    if (cantIds.length) {
      const { data: members } = await context.supabase.from("commessa_membri")
        .select("cantiere_id").in("cantiere_id", cantIds).eq("is_active", true);
      for (const m of members ?? []) {
        memberCounts.set((m as any).cantiere_id, (memberCounts.get((m as any).cantiere_id) ?? 0) + 1);
      }
    }
    return (rows ?? []).map((r: any) => ({
      ...r,
      responsabile: r.responsabile_id ? profMap.get(r.responsabile_id) ?? null : null,
      capocantiere: r.capocantiere_id ? profMap.get(r.capocantiere_id) ?? null : null,
      membri_count: memberCounts.get(r.id) ?? 0,
    }));
  });

// ============= CREATE =============
const createSchema = z.object({
  commessa_id: z.string().uuid(),
  codice: z.string().trim().min(1).max(20),
  nome: z.string().trim().min(1).max(200),
  descrizione: z.string().max(2000).nullable().optional(),
  indirizzo: z.string().max(300).nullable().optional(),
  numero_civico: z.string().max(20).nullable().optional(),
  cap: z.string().max(10).nullable().optional(),
  citta: z.string().max(100).nullable().optional(),
  provincia: z.string().max(50).nullable().optional(),
  referente_nome: z.string().max(150).nullable().optional(),
  referente_telefono: z.string().max(50).nullable().optional(),
  referente_email: z.string().email().nullable().optional().or(z.literal("")),
  stato: z.enum(STATI_CANTIERE).optional(),
  data_inizio_prevista: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  note_operative: z.string().max(2000).nullable().optional(),
  is_principale: z.boolean().optional(),
});

export const createCantiere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const commessa = await fetchCommessa(context, data.commessa_id, organizationId);
    assertCanManageCantieri(commessa, roles, context.userId);

    if (data.is_principale) {
      // Verifica: non deve esistere già un principale attivo
      const { data: existing } = await context.supabase.from("cantieri")
        .select("id").eq("commessa_id", data.commessa_id).eq("is_principale", true).is("archived_at", null).maybeSingle();
      if (existing) throw new Error("Esiste già un cantiere principale attivo per questa commessa");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin.from("cantieri").insert({
      organization_id: organizationId,
      commessa_id: data.commessa_id,
      codice: data.codice,
      nome: data.nome,
      descrizione: data.descrizione ?? null,
      indirizzo: data.indirizzo ?? null,
      numero_civico: data.numero_civico ?? null,
      cap: data.cap ?? null,
      citta: data.citta ?? null,
      provincia: data.provincia ?? null,
      referente_nome: data.referente_nome ?? null,
      referente_telefono: data.referente_telefono ?? null,
      referente_email: data.referente_email || null,
      stato: data.stato ?? "pianificato",
      data_inizio_prevista: data.data_inizio_prevista || null,
      data_fine_prevista: data.data_fine_prevista || null,
      note_operative: data.note_operative ?? null,
      is_principale: !!data.is_principale,
      created_by: context.userId,
    }).select("id").single();
    if (error) throw error;

    await logAudit(context, organizationId, "cantiere.created", inserted.id, {
      commessa_id: data.commessa_id, codice: data.codice, nome: data.nome,
    });
    return { id: inserted.id };
  });

// ============= UPDATE =============
const updateSchema = z.object({
  id: z.string().uuid(),
  expected_updated_at: z.string(),
  nome: z.string().trim().min(1).max(200).optional(),
  descrizione: z.string().max(2000).nullable().optional(),
  indirizzo: z.string().max(300).nullable().optional(),
  numero_civico: z.string().max(20).nullable().optional(),
  cap: z.string().max(10).nullable().optional(),
  citta: z.string().max(100).nullable().optional(),
  provincia: z.string().max(50).nullable().optional(),
  referente_nome: z.string().max(150).nullable().optional(),
  referente_telefono: z.string().max(50).nullable().optional(),
  referente_email: z.string().email().nullable().optional().or(z.literal("")),
  stato: z.enum(STATI_CANTIERE).optional(),
  data_inizio_prevista: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  data_inizio_effettiva: z.string().nullable().optional(),
  data_fine_effettiva: z.string().nullable().optional(),
  note_operative: z.string().max(2000).nullable().optional(),
});

export const updateCantiere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const cantiere = await fetchCantiere(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, cantiere.commessa_id, organizationId);

    const isAdmin = hasAny(roles, ["proprietario","amministratore", "amministrazione","ufficio_tecnico"]);
    const isResp = hasAny(roles, ["responsabile_commessa"]) && commessa.responsabile_id === context.userId;
    const isCapo = hasAny(roles, ["capocantiere"]) && cantiere.capocantiere_id === context.userId;

    if (!isAdmin && !isResp && !isCapo) throw new Error("Non autorizzato");

    if (new Date(cantiere.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
      throw new Error("Il cantiere è stato modificato da un altro utente. Ricarica la pagina.");
    }

    // Capocantiere: campi limitati
    let allowed: (keyof typeof data)[];
    if (isCapo && !isAdmin && !isResp) {
      allowed = ["stato","data_inizio_effettiva","data_fine_effettiva","note_operative"];
    } else {
      allowed = ["nome","descrizione","indirizzo","numero_civico","cap","citta","provincia",
                 "referente_nome","referente_telefono","referente_email","stato",
                 "data_inizio_prevista","data_fine_prevista","data_inizio_effettiva","data_fine_effettiva","note_operative"];
    }

    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (data[k] !== undefined) patch[k as string] = k === "referente_email" ? (data[k] || null) : data[k];
    }
    if (Object.keys(patch).length === 0) return { ok: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("cantieri")
      .update(patch as any).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "cantiere.updated", data.id, { campi: Object.keys(patch) });
    return { ok: true };
  });

// ============= ARCHIVE / RESTORE =============
export const archiveCantiere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    motivazione: z.string().trim().min(1).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const cantiere = await fetchCantiere(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, cantiere.commessa_id, organizationId);
    assertCanManageCantieri(commessa, roles, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("cantieri")
      .update({ archived_at: new Date().toISOString(), is_principale: false })
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "cantiere.archived", data.id, { motivazione: data.motivazione });
    return { ok: true };
  });

export const restoreCantiere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const cantiere = await fetchCantiere(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, cantiere.commessa_id, organizationId);
    assertCanManageCantieri(commessa, roles, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("cantieri")
      .update({ archived_at: null }).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "cantiere.restored", data.id, {});
    return { ok: true };
  });

// ============= SET CAPOCANTIERE =============
export const setCapocantiere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    cantiere_id: z.string().uuid(),
    capocantiere_id: z.string().uuid().nullable(),
    expected_updated_at: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const cantiere = await fetchCantiere(context, data.cantiere_id, organizationId);
    const commessa = await fetchCommessa(context, cantiere.commessa_id, organizationId);
    assertCanManageCantieri(commessa, roles, context.userId);

    if (new Date(cantiere.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
      throw new Error("Cantiere modificato da un altro utente. Ricarica la pagina.");
    }
    if (data.capocantiere_id) {
      await assertCapocantiereValid(context, organizationId, data.capocantiere_id);
    }

    const previous = cantiere.capocantiere_id;
    if (previous === data.capocantiere_id) return { ok: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Termina assegnazione capocantiere precedente per questo cantiere
    await supabaseAdmin.from("commessa_membri").update({
      is_active: false,
      data_fine: new Date().toISOString().slice(0,10),
      archived_at: new Date().toISOString(),
    })
      .eq("cantiere_id", data.cantiere_id)
      .eq("organization_id", organizationId)
      .eq("ruolo_operativo", "capocantiere")
      .eq("is_active", true);

    if (data.capocantiere_id) {
      await supabaseAdmin.from("commessa_membri").insert({
        organization_id: organizationId,
        commessa_id: cantiere.commessa_id,
        cantiere_id: data.cantiere_id,
        user_id: data.capocantiere_id,
        ruolo_operativo: "capocantiere",
        is_active: true,
        created_by: context.userId,
      });
    }

    const { error } = await supabaseAdmin.from("cantieri")
      .update({ capocantiere_id: data.capocantiere_id })
      .eq("id", data.cantiere_id).eq("organization_id", organizationId);
    if (error) throw error;

    await logAudit(context, organizationId, "cantiere.capocantiere_changed", data.cantiere_id, {
      commessa_id: cantiere.commessa_id, precedente: previous, nuovo: data.capocantiere_id,
    });
    return { ok: true };
  });
