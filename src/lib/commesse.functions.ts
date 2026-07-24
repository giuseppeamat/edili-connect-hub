import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole =
  | "proprietario" | "amministratore" | "ufficio_tecnico" | "amministrazione"
  | "responsabile_commessa" | "capocantiere" | "operaio" | "cliente" | "fornitore";

const MANAGE_ROLES: AppRole[] = ["proprietario", "amministratore", "ufficio_tecnico"];
const ADMIN_ROLES: AppRole[] = ["proprietario", "amministratore"];

const TIPOLOGIE = [
  "ristrutturazione", "nuova_costruzione", "manutenzione", "impiantistica",
  "riqualificazione", "demolizione", "fornitura_posa", "altro",
] as const;
const PRIORITA = ["bassa", "normale", "alta", "urgente"] as const;

async function ctx(context: any): Promise<{ organizationId: string; roles: AppRole[]; isActive: boolean }> {
  const [{ data: prof }, { data: rows }] = await Promise.all([
    context.supabase.from("profiles").select("organization_id, is_active").eq("id", context.userId).maybeSingle(),
    context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
  ]);
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  if (prof.is_active === false) throw new Error("Utente disattivato");
  return {
    organizationId: prof.organization_id as string,
    roles: (rows ?? []).map((r: any) => r.role as AppRole),
    isActive: prof.is_active !== false,
  };
}

function assertRole(roles: AppRole[], allowed: AppRole[], msg = "Non autorizzato") {
  if (!allowed.some((r) => roles.includes(r))) throw new Error(msg);
}

async function logAudit(
  context: any, organizationId: string, action: string, entityId: string,
  metadata: Record<string, unknown> = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    organization_id: organizationId,
    user_id: context.userId,
    action,
    entity: "commesse",
    entity_id: entityId,
    metadata: metadata as any,
  });
}

function calcMargini(ricavi: number | null, costiPrev: number | null, costiSost: number | null, costiImp: number | null) {
  const r = Number(ricavi ?? 0);
  const cp = Number(costiPrev ?? 0);
  const cs = Number(costiSost ?? 0);
  const ci = Number(costiImp ?? 0);
  const margine_previsto = +(r - cp).toFixed(2);
  const margine_aggiornato = +(r - cs - ci).toFixed(2);
  const margine_percentuale = r > 0 ? +((margine_previsto / r) * 100).toFixed(2) : 0;
  return { margine_previsto, margine_aggiornato, margine_percentuale };
}

async function fetchCommessaOrThrow(context: any, id: string, orgId: string) {
  const { data, error } = await context.supabase
    .from("commesse").select("*").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Commessa non trovata");
  return data;
}

async function validateResponsabile(context: any, orgId: string, userId: string | null | undefined) {
  if (!userId) return;
  const { data } = await context.supabase
    .from("profiles").select("id, organization_id, is_active")
    .eq("id", userId).maybeSingle();
  if (!data || data.organization_id !== orgId) throw new Error("Responsabile non valido");
  if (data.is_active === false) throw new Error("Responsabile disattivato");
}

async function validateCliente(context: any, orgId: string, clienteId: string) {
  const { data } = await context.supabase
    .from("clienti").select("id, organization_id").eq("id", clienteId).maybeSingle();
  if (!data || data.organization_id !== orgId) throw new Error("Cliente non valido per questa organizzazione");
}

// ============= CREATE =============
const createSchema = z.object({
  cliente_id: z.string().uuid(),
  titolo: z.string().trim().min(1).max(200),
  descrizione: z.string().max(2000).nullable().optional(),
  tipologia: z.enum(TIPOLOGIE).nullable().optional(),
  priorita: z.enum(PRIORITA).nullable().optional(),
  responsabile_id: z.string().uuid().nullable().optional(),
  indirizzo_cantiere: z.string().max(300).nullable().optional(),
  data_apertura: z.string().nullable().optional(),
  data_inizio_prevista: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  importo_contratto: z.number().min(0).nullable().optional(),
  costi_previsti: z.number().min(0).nullable().optional(),
  note_interne: z.string().max(4000).nullable().optional(),
});

export const createCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);

    await validateCliente(context, organizationId, data.cliente_id);
    await validateResponsabile(context, organizationId, data.responsabile_id ?? null);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const anno = new Date(data.data_apertura || Date.now()).getFullYear();
    const { data: codice, error: codErr } = await supabaseAdmin
      .rpc("assign_commessa_codice", { _org: organizationId, _anno: anno });
    if (codErr) throw codErr;

    const importoContratto = data.importo_contratto ?? 0;
    const costiPrev = data.costi_previsti ?? 0;
    const margini = calcMargini(importoContratto, costiPrev, 0, 0);

    const { data: inserted, error } = await supabaseAdmin.from("commesse").insert({
      organization_id: organizationId,
      cliente_id: data.cliente_id,
      responsabile_id: data.responsabile_id ?? null,
      codice: codice as string,
      denominazione: data.titolo, // legacy retrocompat
      titolo: data.titolo,
      descrizione: data.descrizione ?? null,
      tipologia: data.tipologia ?? null,
      priorita: data.priorita ?? "normale",
      indirizzo_cantiere: data.indirizzo_cantiere ?? null,
      data_apertura: data.data_apertura || new Date().toISOString().slice(0, 10),
      data_inizio: data.data_inizio_prevista || null, // legacy
      data_inizio_prevista: data.data_inizio_prevista || null,
      data_fine_prevista: data.data_fine_prevista || null,
      importo: importoContratto, // legacy
      importo_contratto: importoContratto,
      ricavi_previsti: importoContratto,
      budget_costi: costiPrev, // legacy
      costi_previsti: costiPrev,
      costi_impegnati: 0,
      ...margini,
      note_interne: data.note_interne ?? null,
      stato: "pianificata",
      created_by: context.userId,
    }).select("id").single();
    if (error) throw error;

    await logAudit(context, organizationId, "commessa.created", inserted.id, {
      codice, titolo: data.titolo, cliente_id: data.cliente_id,
    });
    return { id: inserted.id, codice };
  });

// ============= UPDATE =============
const updateSchema = z.object({
  id: z.string().uuid(),
  expected_updated_at: z.string(),
  titolo: z.string().trim().min(1).max(200).optional(),
  descrizione: z.string().max(2000).nullable().optional(),
  tipologia: z.enum(TIPOLOGIE).nullable().optional(),
  priorita: z.enum(PRIORITA).nullable().optional(),
  cliente_id: z.string().uuid().optional(),
  responsabile_id: z.string().uuid().nullable().optional(),
  indirizzo_cantiere: z.string().max(300).nullable().optional(),
  data_apertura: z.string().nullable().optional(),
  data_inizio_prevista: z.string().nullable().optional(),
  data_inizio_effettiva: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  data_fine_effettiva: z.string().nullable().optional(),
  importo_contratto: z.number().min(0).nullable().optional(),
  costi_previsti: z.number().min(0).nullable().optional(),
  avanzamento_pct: z.number().min(0).max(100).optional(),
  stato: z.enum(["pianificata", "in_corso", "sospesa", "completata", "annullata"]).optional(),
  note_interne: z.string().max(4000).nullable().optional(),
});

export const updateCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const current = await fetchCommessaOrThrow(context, data.id, organizationId);

    if (new Date(current.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
      throw new Error("Questa commessa è stata modificata da un altro utente. Ricarica la pagina prima di salvare.");
    }

    if (data.cliente_id && data.cliente_id !== current.cliente_id) {
      await validateCliente(context, organizationId, data.cliente_id);
    }
    if (data.responsabile_id !== undefined && data.responsabile_id !== current.responsabile_id) {
      await validateResponsabile(context, organizationId, data.responsabile_id);
    }

    const patch: Record<string, unknown> = {};
    const setIf = (k: keyof typeof data, col?: string) => {
      if (data[k] !== undefined) patch[col ?? (k as string)] = data[k];
    };
    setIf("titolo");
    if (data.titolo !== undefined) patch.denominazione = data.titolo; // legacy sync
    setIf("descrizione");
    setIf("tipologia");
    setIf("priorita");
    setIf("cliente_id");
    setIf("responsabile_id");
    setIf("indirizzo_cantiere");
    setIf("data_apertura");
    setIf("data_inizio_prevista");
    if (data.data_inizio_prevista !== undefined) patch.data_inizio = data.data_inizio_prevista; // legacy
    setIf("data_inizio_effettiva");
    setIf("data_fine_prevista");
    setIf("data_fine_effettiva");
    setIf("avanzamento_pct");
    setIf("stato");
    setIf("note_interne");

    if (data.importo_contratto !== undefined) {
      patch.importo_contratto = data.importo_contratto;
      patch.importo = data.importo_contratto ?? 0; // legacy
      patch.ricavi_previsti = data.importo_contratto;
    }
    if (data.costi_previsti !== undefined) {
      patch.costi_previsti = data.costi_previsti;
      patch.budget_costi = data.costi_previsti ?? 0; // legacy
    }

    const ricavi = (patch.ricavi_previsti ?? current.ricavi_previsti) as number | null;
    const cp = (patch.costi_previsti ?? current.costi_previsti) as number | null;
    Object.assign(patch, calcMargini(ricavi, cp, current.costi_sostenuti, current.costi_impegnati));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("commesse").update(patch as any).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;

    await logAudit(context, organizationId, "commessa.updated", data.id, {
      campi: Object.keys(patch),
      stato_prev: current.stato,
      stato_next: patch.stato ?? current.stato,
    });
    return { ok: true };
  });

// ============= ARCHIVE / RESTORE =============
const idSchema = z.object({ id: z.string().uuid() });
const idMotivoSchema = z.object({ id: z.string().uuid(), motivazione: z.string().trim().min(1).max(500) });

export const archiveCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idMotivoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ADMIN_ROLES);
    const current = await fetchCommessaOrThrow(context, data.id, organizationId);
    if (current.archived_at) return { ok: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commesse")
      .update({ archived_at: new Date().toISOString(), archived_by: context.userId })
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.archived", data.id, { motivazione: data.motivazione });
    return { ok: true };
  });

export const restoreCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ADMIN_ROLES);
    await fetchCommessaOrThrow(context, data.id, organizationId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commesse")
      .update({ archived_at: null, archived_by: null })
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.restored", data.id, {});
    return { ok: true };
  });

// ============= CLOSE / REOPEN =============
const closeSchema = z.object({
  id: z.string().uuid(),
  data_fine_effettiva: z.string().min(1),
  note_chiusura: z.string().max(1000).nullable().optional(),
});

export const closeCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => closeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ADMIN_ROLES);
    const current = await fetchCommessaOrThrow(context, data.id, organizationId);

    if (current.data_inizio_effettiva && data.data_fine_effettiva < current.data_inizio_effettiva) {
      throw new Error("La data di fine effettiva non può essere antecedente alla data di inizio effettiva");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commesse").update({
      closed_at: new Date().toISOString(),
      closed_by: context.userId,
      data_fine_effettiva: data.data_fine_effettiva,
      stato: "completata",
    }).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.closed", data.id, {
      data_fine_effettiva: data.data_fine_effettiva,
      note: data.note_chiusura ?? null,
      stato_prev: current.stato,
    });
    return { ok: true };
  });

export const reopenCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idMotivoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ADMIN_ROLES);
    const current = await fetchCommessaOrThrow(context, data.id, organizationId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commesse").update({
      closed_at: null, closed_by: null,
      stato: current.stato === "completata" ? "in_corso" : current.stato,
    }).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.reopened", data.id, { motivazione: data.motivazione });
    return { ok: true };
  });
