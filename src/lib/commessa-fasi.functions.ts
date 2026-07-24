import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole =
  | "proprietario" | "amministratore" | "ufficio_tecnico" | "amministrazione"
  | "responsabile_commessa" | "capocantiere" | "operaio" | "cliente" | "fornitore";

const MANAGE_ROLES: AppRole[] = ["proprietario", "amministratore", "ufficio_tecnico"];
const STATI = ["non_iniziata", "in_corso", "sospesa", "completata", "annullata"] as const;

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
const hasAny = (roles: AppRole[], allowed: AppRole[]) => allowed.some((r) => roles.includes(r));

async function logAudit(context: any, orgId: string, action: string, entityId: string, meta: any = {}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    organization_id: orgId, user_id: context.userId,
    action, entity: "commessa_fasi", entity_id: entityId, metadata: meta,
  });
}

async function fetchCommessa(context: any, id: string, orgId: string) {
  const { data, error } = await context.supabase
    .from("commesse").select("id, organization_id, responsabile_id, closed_at, archived_at, avanzamento_modalita")
    .eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Commessa non trovata");
  return data;
}

async function fetchFase(context: any, id: string, orgId: string) {
  const { data, error } = await context.supabase
    .from("commessa_fasi").select("*").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fase non trovata");
  return data;
}

function assertEditable(commessa: any, roles: AppRole[], userId: string) {
  if (commessa.closed_at) throw new Error("Commessa chiusa: riaprila prima di modificarne le fasi.");
  if (commessa.archived_at) throw new Error("Commessa archiviata: ripristinala prima di modificarne le fasi.");
  const isManage = hasAny(roles, MANAGE_ROLES);
  const isResp = roles.includes("responsabile_commessa") && commessa.responsabile_id === userId;
  if (!isManage && !isResp) throw new Error("Non autorizzato");
}

// ============ LIST ============
export const listCommessaFasi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { commessa_id: string; includeArchived?: boolean }) => data)
  .handler(async ({ data, context }) => {
    const { organizationId } = await ctx(context);
    let q = context.supabase.from("commessa_fasi")
      .select("*")
      .eq("commessa_id", data.commessa_id)
      .eq("organization_id", organizationId)
      .order("posizione", { ascending: true })
      .order("created_at", { ascending: true });
    if (!data.includeArchived) q = q.is("archived_at", null);
    const { data: rows, error } = await q;
    if (error) throw error;

    // Enrich responsabile/cantiere names
    const respIds = Array.from(new Set((rows ?? []).map((r: any) => r.responsabile_id).filter(Boolean)));
    const cantIds = Array.from(new Set((rows ?? []).map((r: any) => r.cantiere_id).filter(Boolean)));
    const [{ data: profs }, { data: cants }] = await Promise.all([
      respIds.length
        ? context.supabase.from("profiles").select("id, nome, cognome, email").in("id", respIds)
        : Promise.resolve({ data: [] as any[] }),
      cantIds.length
        ? context.supabase.from("cantieri").select("id, codice, nome").in("id", cantIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const pm = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const cm = new Map((cants ?? []).map((c: any) => [c.id, c]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      responsabile: r.responsabile_id ? pm.get(r.responsabile_id) ?? null : null,
      cantiere: r.cantiere_id ? cm.get(r.cantiere_id) ?? null : null,
    }));
  });

// ============ CREATE ============
const createSchema = z.object({
  commessa_id: z.string().uuid(),
  titolo: z.string().min(1),
  descrizione: z.string().optional().nullable(),
  cantiere_id: z.string().uuid().optional().nullable(),
  responsabile_id: z.string().uuid().optional().nullable(),
  peso_percentuale: z.number().min(0).max(100).optional(),
  data_inizio_prevista: z.string().optional().nullable(),
  data_fine_prevista: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export const createCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof createSchema>) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const commessa = await fetchCommessa(context, data.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);

    const { data: maxPos } = await context.supabase
      .from("commessa_fasi").select("posizione")
      .eq("commessa_id", data.commessa_id).eq("organization_id", organizationId)
      .order("posizione", { ascending: false }).limit(1).maybeSingle();
    const nextPos = ((maxPos?.posizione as number | undefined) ?? -1) + 1;

    const { data: inserted, error } = await context.supabase.from("commessa_fasi").insert({
      organization_id: organizationId,
      commessa_id: data.commessa_id,
      titolo: data.titolo,
      descrizione: data.descrizione ?? null,
      cantiere_id: data.cantiere_id ?? null,
      responsabile_id: data.responsabile_id ?? null,
      peso_percentuale: data.peso_percentuale ?? 0,
      posizione: nextPos,
      data_inizio_prevista: data.data_inizio_prevista ?? null,
      data_fine_prevista: data.data_fine_prevista ?? null,
      note: data.note ?? null,
      created_by: context.userId,
    }).select("id").single();
    if (error) throw error;
    await logAudit(context, organizationId, "fase.created", inserted.id, { commessa_id: data.commessa_id, titolo: data.titolo });
    return { id: inserted.id };
  });

// ============ UPDATE ============
const updateSchema = z.object({
  id: z.string().uuid(),
  titolo: z.string().min(1).optional(),
  descrizione: z.string().optional().nullable(),
  cantiere_id: z.string().uuid().optional().nullable(),
  responsabile_id: z.string().uuid().optional().nullable(),
  peso_percentuale: z.number().min(0).max(100).optional(),
  data_inizio_prevista: z.string().optional().nullable(),
  data_fine_prevista: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export const updateCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof updateSchema>) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const fase = await fetchFase(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, fase.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);

    const patch: any = {};
    for (const k of ["titolo","descrizione","cantiere_id","responsabile_id","peso_percentuale","data_inizio_prevista","data_fine_prevista","note"] as const) {
      if (k in data && (data as any)[k] !== undefined) patch[k] = (data as any)[k];
    }
    const { error } = await context.supabase.from("commessa_fasi")
      .update(patch).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "fase.updated", data.id, { patch });
    return { ok: true };
  });

// ============ UPDATE AVANZAMENTO (capocantiere/resp/admin) ============
const avanzSchema = z.object({
  id: z.string().uuid(),
  avanzamento_percentuale: z.number().min(0).max(100),
  note: z.string().optional().nullable(),
});
export const updateFaseAvanzamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof avanzSchema>) => avanzSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const fase = await fetchFase(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, fase.commessa_id, organizationId);
    if (commessa.closed_at) throw new Error("Commessa chiusa");
    if (commessa.archived_at) throw new Error("Commessa archiviata");

    const isManage = hasAny(roles, MANAGE_ROLES);
    const isResp = roles.includes("responsabile_commessa") && commessa.responsabile_id === context.userId;
    let isCapo = false;
    if (!isManage && !isResp && roles.includes("capocantiere") && fase.cantiere_id) {
      const { data: capoOk } = await context.supabase.rpc("is_capocantiere_di", { _cantiere_id: fase.cantiere_id });
      isCapo = !!capoOk;
    }
    if (!isManage && !isResp && !isCapo) throw new Error("Non autorizzato ad aggiornare l'avanzamento");

    const patch: any = { avanzamento_percentuale: data.avanzamento_percentuale };
    // Auto-transizioni di stato coerenti
    if (data.avanzamento_percentuale >= 100 && fase.stato !== "completata") {
      patch.stato = "completata";
      if (!fase.data_fine_effettiva) patch.data_fine_effettiva = new Date().toISOString().slice(0,10);
    } else if (data.avanzamento_percentuale > 0 && fase.stato === "non_iniziata") {
      patch.stato = "in_corso";
      if (!fase.data_inizio_effettiva) patch.data_inizio_effettiva = new Date().toISOString().slice(0,10);
    }
    if (data.note) patch.note = data.note;

    const { error } = await context.supabase.from("commessa_fasi")
      .update(patch).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "fase.progress_updated", data.id, {
      avanzamento: data.avanzamento_percentuale, stato: patch.stato ?? fase.stato,
    });
    return { ok: true };
  });

// ============ CAMBIO STATO ============
const stateSchema = z.object({
  id: z.string().uuid(),
  stato: z.enum(STATI),
  motivazione: z.string().optional().nullable(),
});
export const changeFaseStato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof stateSchema>) => stateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const fase = await fetchFase(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, fase.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);

    const patch: any = { stato: data.stato };
    const today = new Date().toISOString().slice(0,10);
    if (data.stato === "in_corso" && !fase.data_inizio_effettiva) patch.data_inizio_effettiva = today;
    if (data.stato === "completata") {
      patch.avanzamento_percentuale = 100;
      if (!fase.data_fine_effettiva) patch.data_fine_effettiva = today;
    }
    const { error } = await context.supabase.from("commessa_fasi")
      .update(patch).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "fase.state_changed", data.id, {
      from: fase.stato, to: data.stato, motivazione: data.motivazione ?? null,
    });
    return { ok: true };
  });

// ============ ARCHIVIA / RIPRISTINA ============
export const archiveCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const fase = await fetchFase(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, fase.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);
    const { error } = await context.supabase.from("commessa_fasi")
      .update({ archived_at: new Date().toISOString(), archived_by: context.userId })
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "fase.archived", data.id, {});
    return { ok: true };
  });

export const restoreCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const fase = await fetchFase(context, data.id, organizationId);
    const commessa = await fetchCommessa(context, fase.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);
    const { error } = await context.supabase.from("commessa_fasi")
      .update({ archived_at: null, archived_by: null })
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "fase.restored", data.id, {});
    return { ok: true };
  });

// ============ RIORDINO ============
export const reorderCommessaFasi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { commessa_id: string; order: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const commessa = await fetchCommessa(context, data.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);
    for (let i = 0; i < data.order.length; i++) {
      const { error } = await context.supabase.from("commessa_fasi")
        .update({ posizione: i })
        .eq("id", data.order[i]).eq("organization_id", organizationId);
      if (error) throw error;
    }
    return { ok: true };
  });

// ============ DISTRIBUZIONE PESI ============
export const distribuisciPesiEqualmente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { commessa_id: string }) => data)
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const commessa = await fetchCommessa(context, data.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);
    const { data: rows, error: eR } = await context.supabase.from("commessa_fasi")
      .select("id").eq("commessa_id", data.commessa_id).eq("organization_id", organizationId)
      .is("archived_at", null).neq("stato", "annullata");
    if (eR) throw eR;
    const n = (rows ?? []).length;
    if (n === 0) return { ok: true, peso: 0 };
    const peso = +(100 / n).toFixed(2);
    for (const r of rows!) {
      const { error } = await context.supabase.from("commessa_fasi")
        .update({ peso_percentuale: peso }).eq("id", r.id).eq("organization_id", organizationId);
      if (error) throw error;
    }
    await logAudit(context, organizationId, "fase.weights_distributed", data.commessa_id, { peso, count: n });
    return { ok: true, peso };
  });

// ============ MODALITÀ AVANZAMENTO ============
export const setCommessaAvanzamentoModalita = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { commessa_id: string; modalita: "manuale" | "fasi" }) => data)
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const commessa = await fetchCommessa(context, data.commessa_id, organizationId);
    assertEditable(commessa, roles, context.userId);
    const { error } = await context.supabase.from("commesse")
      .update({ avanzamento_modalita: data.modalita })
      .eq("id", data.commessa_id).eq("organization_id", organizationId);
    if (error) throw error;
    if (data.modalita === "fasi") {
      await context.supabase.rpc("recalculate_commessa_avanzamento", { _commessa_id: data.commessa_id });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_log").insert({
      organization_id: organizationId, user_id: context.userId,
      action: "commessa.progress_mode_changed", entity: "commesse",
      entity_id: data.commessa_id, metadata: { modalita: data.modalita },
    });
    return { ok: true };
  });
