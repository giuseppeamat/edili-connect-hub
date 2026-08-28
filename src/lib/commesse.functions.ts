import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";
import {
  costiSostenutiCommessa,
  manodoperaPerCantiere,
  manodoperaPerCommessa,
  type CostoManodoperaRow,
} from "@/lib/costi-propagazione";


type AppRole =
  | "proprietario" | "amministratore" | "ufficio_tecnico" | "amministrazione"
  | "responsabile_commessa" | "capocantiere" | "operaio" | "cliente" | "fornitore";

const MANAGE_ROLES: AppRole[] = ["proprietario", "amministratore", "amministrazione", "ufficio_tecnico"];
const ADMIN_ROLES: AppRole[] = ["proprietario", "amministratore", "amministrazione"];
const RESPONSABILE_ROLES: AppRole[] = [
  "proprietario", "amministratore", "amministrazione", "ufficio_tecnico", "responsabile_commessa", "capocantiere",
];

const TIPOLOGIE = [
  "ristrutturazione", "nuova_costruzione", "manutenzione", "impiantistica",
  "riqualificazione", "demolizione", "fornitura_posa", "altro",
] as const;
const PRIORITA = ["bassa", "normale", "alta", "urgente"] as const;
const STATI = ["bozza", "pianificata", "in_corso", "sospesa", "completata", "annullata"] as const;

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

function hasAny(roles: AppRole[], allowed: AppRole[]) {
  return allowed.some((r) => roles.includes(r));
}
function assertRole(roles: AppRole[], allowed: AppRole[], msg = "Non autorizzato") {
  if (!hasAny(roles, allowed)) throw new Error(msg);
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
  if (!userId) return true;
  const { data: valid, error: rpcErr } = await context.supabase
    .rpc("is_valid_responsabile", { _user: userId, _org: orgId });
  if (rpcErr) {
    console.error("[validateResponsabile] RPC error", rpcErr);
    throw new Error("Impossibile verificare il responsabile selezionato. Riprova.");
  }
  if (valid) return true;

  // Fallback diagnostico: individua motivo preciso del rifiuto.
  const [{ data: prof }, { data: roles }] = await Promise.all([
    context.supabase.from("profiles").select("id, is_active, organization_id").eq("id", userId).maybeSingle(),
    context.supabase.from("user_roles").select("role, organization_id").eq("user_id", userId),
  ]);
  if (!prof) throw new Error("Il responsabile selezionato non è disponibile.");
  if (prof.is_active === false) throw new Error("Il responsabile selezionato è disattivato.");
  if (prof.organization_id !== orgId) throw new Error("Il responsabile selezionato appartiene a un'altra organizzazione.");
  const rolesInOrg = (roles ?? []).filter((r: any) => r.organization_id === orgId).map((r: any) => r.role);
  const compat = rolesInOrg.some((r: string) => (RESPONSABILE_ROLES as string[]).includes(r));
  if (!compat) throw new Error("Il ruolo dell'utente selezionato non è compatibile con quello di responsabile commessa.");
  throw new Error("Il responsabile selezionato non è disponibile.");
}

async function validateCliente(context: any, orgId: string, clienteId: string) {
  const { data } = await context.supabase
    .from("clienti").select("id, organization_id").eq("id", clienteId).maybeSingle();
  if (!data || data.organization_id !== orgId) throw new Error("Cliente non valido per questa organizzazione");
}

// ============= LIST RESPONSABILI =============
export const listResponsabiliCandidati = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { organizationId } = await ctx(context);
    const { data: rolesRows, error: rErr } = await context.supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .in("role", RESPONSABILE_ROLES);
    if (rErr) throw rErr;
    const ids = Array.from(new Set((rolesRows ?? []).map((r: any) => r.user_id)));
    if (!ids.length) return [];
    const { data: profs, error: pErr } = await context.supabase
      .from("profiles")
      .select("id, nome, cognome, email, is_active, organization_id")
      .in("id", ids)
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    if (pErr) throw pErr;
    return (profs ?? []).map((p: any) => ({
      id: p.id, nome: p.nome, cognome: p.cognome, email: p.email,
    }));
  });

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
  ricavi_previsti: z.number().min(0).nullable().optional(),
  costi_previsti: z.number().min(0).nullable().optional(),
  costi_impegnati: z.number().min(0).nullable().optional(),
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

    // Date coerenza
    if (data.data_inizio_prevista && data.data_fine_prevista &&
        data.data_fine_prevista < data.data_inizio_prevista) {
      throw new Error("La data di fine prevista non può essere antecedente alla data di inizio prevista");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // L'anno di numerazione è determinato da data_apertura (o data_inizio_prevista come fallback, o oggi)
    const annoDate = data.data_apertura || data.data_inizio_prevista || new Date().toISOString().slice(0, 10);
    const anno = new Date(annoDate).getFullYear();
    const { data: codice, error: codErr } = await supabaseAdmin
      .rpc("assign_commessa_codice", { _org: organizationId, _anno: anno });
    if (codErr) throw codErr;

    const importoContratto = data.importo_contratto ?? 0;
    const ricaviPrev = data.ricavi_previsti ?? importoContratto;
    const costiPrev = data.costi_previsti ?? 0;
    const costiImp = data.costi_impegnati ?? 0;
    const margini = calcMargini(ricaviPrev, costiPrev, 0, costiImp);

    const { data: inserted, error } = await supabaseAdmin.from("commesse").insert({
      organization_id: organizationId,
      cliente_id: data.cliente_id,
      responsabile_id: data.responsabile_id ?? null,
      codice: codice as string,
      denominazione: data.titolo, // legacy
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
      ricavi_previsti: ricaviPrev,
      budget_costi: costiPrev, // legacy
      costi_previsti: costiPrev,
      costi_impegnati: costiImp,
      ...margini,
      note_interne: data.note_interne ?? null,
      stato: "bozza",
      created_by: context.userId,
    }).select("id").single();
    if (error) throw error;

    // Sync commessa_membri per il responsabile iniziale
    if (data.responsabile_id) {
      await supabaseAdmin.from("commessa_membri").insert({
        organization_id: organizationId,
        commessa_id: inserted.id,
        user_id: data.responsabile_id,
        ruolo_operativo: "responsabile_commessa",
        is_active: true,
        created_by: context.userId,
      });
    }

    await logAudit(context, organizationId, "commessa.created", inserted.id, {
      codice, titolo: data.titolo, cliente_id: data.cliente_id, responsabile_id: data.responsabile_id ?? null,
    });
    return { id: inserted.id, codice };
  });

// ============= UPDATE (senza stato e senza responsabile) =============
// responsabile_id è centralizzato in setCommessaResponsabile per garantire sync con commessa_membri
const updateSchema = z.object({
  id: z.string().uuid(),
  expected_updated_at: z.string(),
  titolo: z.string().trim().min(1).max(200).optional(),
  descrizione: z.string().max(2000).nullable().optional(),
  tipologia: z.enum(TIPOLOGIE).nullable().optional(),
  priorita: z.enum(PRIORITA).nullable().optional(),
  cliente_id: z.string().uuid().optional(),
  indirizzo_cantiere: z.string().max(300).nullable().optional(),
  data_apertura: z.string().nullable().optional(),
  data_inizio_prevista: z.string().nullable().optional(),
  data_inizio_effettiva: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  data_fine_effettiva: z.string().nullable().optional(),
  importo_contratto: z.number().min(0).nullable().optional(),
  ricavi_previsti: z.number().min(0).nullable().optional(),
  costi_previsti: z.number().min(0).nullable().optional(),
  costi_impegnati: z.number().min(0).nullable().optional(),
  // avanzamento_pct RIMOSSO da updateCommessa: usare updateManualCommessaProgress (RPC).
  // avanzamento_modalita RIMOSSO da updateCommessa: usare setCommessaAvanzamentoModalita (RPC).
  note_interne: z.string().max(4000).nullable().optional(),
});

export const updateCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const isAdmin = hasAny(roles, ADMIN_ROLES);
    const isTecnico = hasAny(roles, ["ufficio_tecnico"]);
    const isRespRole = hasAny(roles, ["responsabile_commessa"]);
    if (!(isAdmin || isTecnico || isRespRole)) throw new Error("Non autorizzato");

    const current = await fetchCommessaOrThrow(context, data.id, organizationId);

    // Responsabile-only può modificare solo le proprie commesse
    if (!isAdmin && !isTecnico && isRespRole && current.responsabile_id !== context.userId) {
      throw new Error("Non autorizzato: puoi modificare solo le commesse di cui sei responsabile");
    }

    if (current.closed_at) {
      throw new Error("La commessa è chiusa e non può essere modificata senza essere riaperta.");
    }
    if (current.archived_at) {
      throw new Error("Commessa archiviata: ripristinala prima di modificarla.");
    }

    if (new Date(current.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
      throw new Error("Questa commessa è stata modificata da un altro utente. Ricarica la pagina prima di salvare.");
    }

    // Responsabile-only: NON può cambiare cliente
    if (!isAdmin && !isTecnico) {
      if (data.cliente_id !== undefined && data.cliente_id !== current.cliente_id) {
        throw new Error("Non puoi modificare il cliente");
      }
    }

    if (data.cliente_id && data.cliente_id !== current.cliente_id) {
      await validateCliente(context, organizationId, data.cliente_id);
    }

    if (data.data_inizio_prevista && data.data_fine_prevista &&
        data.data_fine_prevista < data.data_inizio_prevista) {
      throw new Error("La data di fine prevista non può essere antecedente alla data di inizio prevista");
    }

    const patch: Record<string, unknown> = {};
    const setIf = (k: keyof typeof data, col?: string) => {
      if (data[k] !== undefined) patch[col ?? (k as string)] = data[k];
    };
    setIf("titolo");
    if (data.titolo !== undefined) patch.denominazione = data.titolo; // legacy
    setIf("descrizione");
    setIf("tipologia");
    setIf("priorita");
    setIf("cliente_id");
    setIf("indirizzo_cantiere");
    setIf("data_apertura");
    setIf("data_inizio_prevista");
    if (data.data_inizio_prevista !== undefined) patch.data_inizio = data.data_inizio_prevista; // legacy
    setIf("data_inizio_effettiva");
    setIf("data_fine_prevista");
    setIf("data_fine_effettiva");
    // avanzamento_pct non è più aggiornabile qui — usare updateManualCommessaProgress (RPC).
    setIf("note_interne");

    if (data.importo_contratto !== undefined) {
      patch.importo_contratto = data.importo_contratto;
      patch.importo = data.importo_contratto ?? 0; // legacy
      if (data.ricavi_previsti === undefined) patch.ricavi_previsti = data.importo_contratto;
    }
    if (data.ricavi_previsti !== undefined) patch.ricavi_previsti = data.ricavi_previsti;
    if (data.costi_previsti !== undefined) {
      patch.costi_previsti = data.costi_previsti;
      patch.budget_costi = data.costi_previsti ?? 0; // legacy
    }
    if (data.costi_impegnati !== undefined) patch.costi_impegnati = data.costi_impegnati;

    const ricavi = (patch.ricavi_previsti ?? current.ricavi_previsti) as number | null;
    const cp = (patch.costi_previsti ?? current.costi_previsti) as number | null;
    const ci = (patch.costi_impegnati ?? current.costi_impegnati) as number | null;
    Object.assign(patch, calcMargini(ricavi, cp, current.costi_sostenuti, ci));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("commesse").update(patch as any).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;

    await logAudit(context, organizationId, "commessa.updated", data.id, {
      campi: Object.keys(patch),
    });
    return { ok: true };
  });

// ============= CHANGE STATE =============
const stateSchema = z.object({
  id: z.string().uuid(),
  nuovo_stato: z.enum(STATI),
  expected_updated_at: z.string(),
  motivazione: z.string().trim().max(500).optional(),
});

export const changeCommessaStato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => stateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Chiamiamo l'RPC come utente autenticato per far applicare la logica di autorizzazione
    // basata su auth.uid() (has_any_role usa la sessione).
    const { error } = await context.supabase.rpc("change_commessa_stato", {
      _commessa_id: data.id,
      _nuovo_stato: data.nuovo_stato,
      _expected_updated_at: data.expected_updated_at,
      _motivazione: data.motivazione ?? undefined,
    });
    if (error) throw new Error(error.message);
    // supabaseAdmin non necessario, ma teniamolo importato per audit fallback futuri
    void supabaseAdmin;
    return { ok: true };
  });

// ============= ARCHIVE / RESTORE =============
const idSchema = z.object({ id: z.string().uuid() });
const idMotivoSchema = z.object({
  id: z.string().uuid(),
  motivazione: z.string().trim().min(1).max(500),
  override: z.boolean().optional(),
});

export const archiveCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idMotivoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ADMIN_ROLES);
    const current = await fetchCommessaOrThrow(context, data.id, organizationId);
    if (current.archived_at) return { ok: true };

    const isClosed = !!current.closed_at || current.stato === "completata" || current.stato === "annullata";
    if (!isClosed && !data.override) {
      throw new Error("Prima di archiviare la commessa, completala o chiudila.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commesse")
      .update({ archived_at: new Date().toISOString(), archived_by: context.userId })
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.archived", data.id, {
      motivazione: data.motivazione, override: !!data.override,
    });
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
    // Ripristino: azzera SOLO archived_*. NON riapre closed_*.
    const { error } = await supabaseAdmin.from("commesse")
      .update({ archived_at: null, archived_by: null })
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.restored", data.id, {});
    return { ok: true };
  });

// ============= AVANZAMENTO MANUALE COMMESSA (RPC-only) =============
const manualProgressSchema = z.object({
  commessaId: z.string().uuid(),
  avanzamentoPercentuale: z.number().min(0).max(100),
  expectedUpdatedAt: z.string().min(1),
  motivazione: z.string().trim().max(500).optional().nullable(),
});
export const updateManualCommessaProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => manualProgressSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await (context.supabase.rpc as any)("update_manual_commessa_progress", {
        _commessa_id: data.commessaId,
        _nuovo_avanzamento: data.avanzamentoPercentuale,
        _expected_updated_at: data.expectedUpdatedAt,
        _motivazione: data.motivazione ?? null,
      });
      if (error) throw error;
      return {
        id: data.commessaId,
        updated_at: newUpd as unknown as string,
        avanzamento: data.avanzamentoPercentuale,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });



// ============= CLOSE / REOPEN =============
const closeSchema = z.object({
  id: z.string().uuid(),
  expected_updated_at: z.string(),
  data_fine_effettiva: z.string().min(1),
  motivazione: z.string().trim().min(1).max(500),
  override: z.boolean().optional(),
});

export const closeCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => closeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ADMIN_ROLES);
    const current = await fetchCommessaOrThrow(context, data.id, organizationId);

    if (current.archived_at) throw new Error("Commessa archiviata: ripristinala prima di chiuderla.");
    if (current.closed_at) return { ok: true };
    if (new Date(current.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
      throw new Error("Questa commessa è stata modificata da un altro utente. Ricarica la pagina prima di salvare.");
    }

    if (current.stato !== "completata" && !data.override) {
      throw new Error("La commessa può essere chiusa solo se completata (override richiesto).");
    }
    if (current.data_inizio_effettiva && data.data_fine_effettiva < current.data_inizio_effettiva) {
      throw new Error("La data di fine effettiva non può essere antecedente alla data di inizio effettiva");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      closed_at: new Date().toISOString(),
      closed_by: context.userId,
      data_fine_effettiva: data.data_fine_effettiva,
    };
    if (current.stato !== "completata") patch.stato = "completata";

    const { error } = await supabaseAdmin.from("commesse").update(patch as any)
      .eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.closed", data.id, {
      data_fine_effettiva: data.data_fine_effettiva,
      motivazione: data.motivazione, override: !!data.override,
      stato_precedente: current.stato,
    });
    return { ok: true };
  });

const reopenSchema = z.object({
  id: z.string().uuid(),
  motivazione: z.string().trim().min(1).max(500),
  nuovo_stato: z.enum(["in_corso", "completata"]).default("in_corso"),
});

export const reopenCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reopenSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ADMIN_ROLES);
    const current = await fetchCommessaOrThrow(context, data.id, organizationId);
    if (!current.closed_at) return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commesse").update({
      closed_at: null, closed_by: null, stato: data.nuovo_stato,
    }).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.reopened", data.id, {
      motivazione: data.motivazione,
      stato_precedente: current.stato,
      stato_nuovo: data.nuovo_stato,
    });
    return { ok: true };
  });

// =========================================================================
// ============= SPRINT 4 · BLOCCO 4: Membri, Responsabile, Detail ==========
// =========================================================================

const RUOLI_OPERATIVI = [
  "responsabile_commessa", "capocantiere", "tecnico", "amministrazione",
  "operaio", "collaboratore", "altro",
] as const;

async function fetchCommessaAccessible(context: any, id: string, orgId: string) {
  const { data, error } = await context.supabase
    .from("commesse").select("*").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Commessa non trovata o non accessibile");
  return data;
}

// ============= GET DETAIL =============
export const getCommessaDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const canEcon = hasAny(roles, ["proprietario", "amministratore", "amministrazione", "ufficio_tecnico"])
      || hasAny(roles, ["responsabile_commessa"]);
    const c = await fetchCommessaAccessible(context, data.id, organizationId);

    const [{ data: cliente }, { data: resp }, { data: cantieriCount }, { data: membriCount }] = await Promise.all([
      c.cliente_id
        ? context.supabase.from("clienti").select("id, ragione_sociale, partita_iva, codice_fiscale, email, telefono")
            .eq("id", c.cliente_id).maybeSingle()
        : Promise.resolve({ data: null }),
      c.responsabile_id
        ? context.supabase.from("profiles").select("id, nome, cognome, email").eq("id", c.responsabile_id).maybeSingle()
        : Promise.resolve({ data: null }),
      context.supabase.from("cantieri").select("id", { count: "exact", head: true }).eq("commessa_id", c.id).is("archived_at", null),
      context.supabase.from("commessa_membri").select("id", { count: "exact", head: true }).eq("commessa_id", c.id).eq("is_active", true),
    ]);

    // Se non autorizzato ai dati economici, mascheriamo TUTTE le colonne economiche
    if (!canEcon) {
      const econCols = [
        "importo","importo_contratto","budget_costi",
        "ricavi_previsti","ricavi_acquisiti","ricavi_aggiornati",
        "extra_approvati","extra_non_approvati",
        "costi_previsti","costi_impegnati","costi_sostenuti","costi_residui_stimati","costo_aggiornato",
        "margine_previsto","margine_aggiornato","margine_percentuale","margine_percentuale_aggiornato",
        "scostamento_costi","scostamento_ricavi","scostamento_margine",
        "baseline_ricavi","baseline_costi","baseline_margine","baseline_preventivo_id",
        "baseline_created_at","baseline_created_by",
        "budget_modalita","budget_calcolato_at",
      ];
      for (const k of econCols) (c as any)[k] = null;
    }


    // Manodopera contabilizzata (ledger autorevole), inclusa una sola volta
    let manodopera: {
      totale: number;
      giaNelBudget: boolean;
      costiSostenutiTotali: number;
      perCantiere: Record<string, number>;
    } | null = null;
    if (canEcon) {
      const { data: rows } = await context.supabase.rpc("get_costi_manodopera" as any, {
        _commessa_ids: [c.id],
      });
      const list = ((rows ?? []) as CostoManodoperaRow[]).filter((r) => r.commessa_id === c.id);
      manodopera = {
        totale: manodoperaPerCommessa(list)[c.id] ?? 0,
        giaNelBudget: list.some((r) => r.gia_nel_budget === true),
        costiSostenutiTotali: costiSostenutiCommessa(c as any, list),
        perCantiere: manodoperaPerCantiere(list, c.id),
      };
    }

    return {
      commessa: c,
      cliente: cliente ?? null,
      responsabile: resp ?? null,
      cantieriCount: (cantieriCount as any) ?? 0,
      membriCount: (membriCount as any) ?? 0,
      canViewEconomics: canEcon,
      manodopera,
    };
  });


// ============= LIST MEMBERS =============
export const listCommessaMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId } = await ctx(context);
    const { data: rows, error } = await context.supabase
      .from("commessa_membri")
      .select("*")
      .eq("commessa_id", data.commessa_id)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const membroIds = Array.from(new Set((rows ?? []).map((r: any) => r.membro_id).filter(Boolean)));
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean)));

    const membroMap = new Map<string, any>();
    if (membroIds.length) {
      const { data: membri } = await context.supabase
        .from("organization_members")
        .select("id, user_id, nome, cognome, email, stato_accesso")
        .eq("organization_id", organizationId)
        .in("id", membroIds);
      for (const m of membri ?? []) membroMap.set((m as any).id, m);
    }
    const profMap = new Map<string, any>();
    if (userIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles").select("id, nome, cognome, email").in("id", userIds);
      for (const p of profs ?? []) profMap.set(p.id, p);
    }

    return (rows ?? []).map((r: any) => {
      const membro = r.membro_id ? membroMap.get(r.membro_id) : null;
      const prof = r.user_id ? profMap.get(r.user_id) : null;
      const person = membro ?? prof ?? null;
      return {
        ...r,
        profile: person
          ? { nome: person.nome, cognome: person.cognome, email: person.email }
          : null,
        has_access: Boolean(r.user_id ?? membro?.user_id),
      };
    });
  });

// ============= LIST ASSIGNABLE MEMBERS (per aggiunta team) =============
export const listAssignableMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { organizationId } = await ctx(context);
    const { data: membri } = await context.supabase
      .from("organization_members")
      .select("id, user_id, nome, cognome, email, ruolo_organizzativo, is_active, archived_at")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("is_active", true)
      .order("cognome", { ascending: true });

    return (membri ?? [])
      .filter((m: any) => m.ruolo_organizzativo !== "cliente" && m.ruolo_organizzativo !== "fornitore")
      .map((m: any) => ({
        membro_id: m.id,
        user_id: m.user_id ?? null,
        nome: m.nome,
        cognome: m.cognome,
        email: m.email,
        ruolo_organizzativo: m.ruolo_organizzativo,
        has_access: Boolean(m.user_id),
      }));
  });


// ============= ADD MEMBER =============
const addMemberSchema = z.object({
  commessa_id: z.string().uuid(),
  membro_id: z.string().uuid(),
  ruolo_operativo: z.enum(RUOLI_OPERATIVI),
  cantiere_id: z.string().uuid().nullable().optional(),
  data_inizio: z.string().optional(),
  data_fine: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Il membro deve esistere in anagrafica, essere attivo e non essere cliente/fornitore. */
async function resolveAssignableMembro(context: any, orgId: string, membroId: string) {
  const { data: m } = await context.supabase
    .from("organization_members")
    .select("id, user_id, is_active, archived_at, ruolo_organizzativo, organization_id")
    .eq("id", membroId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!m) throw new Error("Membro non appartiene all'organizzazione");
  if (m.archived_at || m.is_active === false) throw new Error("Membro non attivo");
  if (m.ruolo_organizzativo === "cliente" || m.ruolo_organizzativo === "fornitore") {
    throw new Error("Cliente/Fornitore non possono essere assegnati come membri interni");
  }
  return m as { id: string; user_id: string | null };
}


async function assertCanManageMembers(context: any, commessa: any, roles: AppRole[]) {
  if (hasAny(roles, ["proprietario","amministratore", "amministrazione","ufficio_tecnico"])) return;
  if (hasAny(roles, ["responsabile_commessa"]) && commessa.responsabile_id === context.userId) return;
  throw new Error("Non autorizzato a gestire i membri di questa commessa");
}

export const addCommessaMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addMemberSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const commessa = await fetchCommessaAccessible(context, data.commessa_id, organizationId);
    await assertCanManageMembers(context, commessa, roles);

    // responsabile_commessa NON può assegnare ruoli amministrativi tramite membri
    if (!hasAny(roles, ["proprietario","amministratore", "amministrazione","ufficio_tecnico"])
        && data.ruolo_operativo === "responsabile_commessa") {
      throw new Error("Non puoi assegnare il ruolo responsabile via team: usa 'Cambia responsabile'");
    }

    const membro = await resolveAssignableMembro(context, organizationId, data.membro_id);

    if (data.cantiere_id) {
      const { data: k } = await context.supabase.from("cantieri")
        .select("id, commessa_id").eq("id", data.cantiere_id).maybeSingle();
      if (!k || k.commessa_id !== data.commessa_id) throw new Error("Cantiere non valido");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin.from("commessa_membri").insert({
      organization_id: organizationId,
      commessa_id: data.commessa_id,
      cantiere_id: data.cantiere_id ?? null,
      membro_id: membro.id,
      user_id: membro.user_id ?? null,
      ruolo_operativo: data.ruolo_operativo,
      data_inizio: data.data_inizio || new Date().toISOString().slice(0,10),
      data_fine: data.data_fine ?? null,
      note: data.note ?? null,
      is_active: true,
      created_by: context.userId,
    }).select("id").single();
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.member_added", data.commessa_id, {
      member_id: inserted.id, membro_id: membro.id, user_id: membro.user_id ?? null,
      ruolo_operativo: data.ruolo_operativo,
      cantiere_id: data.cantiere_id ?? null,
    });
    return { id: inserted.id };
  });


// ============= UPDATE MEMBER =============
const updateMemberSchema = z.object({
  id: z.string().uuid(),
  ruolo_operativo: z.enum(RUOLI_OPERATIVI).optional(),
  cantiere_id: z.string().uuid().nullable().optional(),
  data_fine: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const updateCommessaMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateMemberSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const { data: m } = await context.supabase.from("commessa_membri")
      .select("*").eq("id", data.id).eq("organization_id", organizationId).maybeSingle();
    if (!m) throw new Error("Membro non trovato");
    const commessa = await fetchCommessaAccessible(context, m.commessa_id, organizationId);
    await assertCanManageMembers(context, commessa, roles);

    if (data.cantiere_id) {
      const { data: k } = await context.supabase.from("cantieri")
        .select("id, commessa_id").eq("id", data.cantiere_id).maybeSingle();
      if (!k || k.commessa_id !== m.commessa_id) throw new Error("Cantiere non valido");
    }

    const patch: Record<string, unknown> = {};
    if (data.ruolo_operativo !== undefined) patch.ruolo_operativo = data.ruolo_operativo;
    if (data.cantiere_id !== undefined) patch.cantiere_id = data.cantiere_id;
    if (data.data_fine !== undefined) patch.data_fine = data.data_fine;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (data.note !== undefined) patch.note = data.note;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commessa_membri")
      .update(patch as any).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.member_updated", m.commessa_id, {
      member_id: data.id, campi: Object.keys(patch),
    });
    return { ok: true };
  });

// ============= REMOVE MEMBER (logico) =============
export const removeCommessaMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    motivazione: z.string().trim().min(1).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const { data: m } = await context.supabase.from("commessa_membri")
      .select("*").eq("id", data.id).eq("organization_id", organizationId).maybeSingle();
    if (!m) throw new Error("Membro non trovato");
    const commessa = await fetchCommessaAccessible(context, m.commessa_id, organizationId);
    await assertCanManageMembers(context, commessa, roles);

    // Se è il responsabile principale, blocca (deve usare setCommessaResponsabile con nuovo o null)
    if (m.ruolo_operativo === "responsabile_commessa" && commessa.responsabile_id === m.user_id) {
      throw new Error("Rimuovi prima il responsabile principale usando 'Cambia responsabile'");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("commessa_membri").update({
      is_active: false,
      data_fine: new Date().toISOString().slice(0,10),
      archived_at: new Date().toISOString(),
    }).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    await logAudit(context, organizationId, "commessa.member_removed", m.commessa_id, {
      member_id: data.id, user_id: m.user_id, motivazione: data.motivazione,
    });
    return { ok: true };
  });

// ============= SET RESPONSABILE (centralizzato) =============
export const setCommessaResponsabile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    commessa_id: z.string().uuid(),
    responsabile_id: z.string().uuid().nullable(),
    expected_updated_at: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, ["proprietario","amministratore", "amministrazione","ufficio_tecnico"], "Non autorizzato a cambiare il responsabile");
    const commessa = await fetchCommessaAccessible(context, data.commessa_id, organizationId);
    if (new Date(commessa.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
      throw new Error("Commessa modificata da un altro utente. Ricarica la pagina.");
    }
    if (data.responsabile_id) {
      await validateResponsabile(context, organizationId, data.responsabile_id);
    }
    const previous = commessa.responsabile_id;
    if (previous === data.responsabile_id) return { ok: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Termina assegnazioni attive precedenti come responsabile_commessa per questa commessa
    await supabaseAdmin.from("commessa_membri").update({
      is_active: false,
      data_fine: new Date().toISOString().slice(0,10),
      archived_at: new Date().toISOString(),
    })
      .eq("commessa_id", data.commessa_id)
      .eq("organization_id", organizationId)
      .eq("ruolo_operativo", "responsabile_commessa")
      .eq("is_active", true);

    if (data.responsabile_id) {
      await supabaseAdmin.from("commessa_membri").insert({
        organization_id: organizationId,
        commessa_id: data.commessa_id,
        user_id: data.responsabile_id,
        ruolo_operativo: "responsabile_commessa",
        is_active: true,
        created_by: context.userId,
      });
    }

    const { error } = await supabaseAdmin.from("commesse").update({
      responsabile_id: data.responsabile_id,
    }).eq("id", data.commessa_id).eq("organization_id", organizationId);
    if (error) throw error;

    await logAudit(context, organizationId, "commessa.responsabile_changed", data.commessa_id, {
      responsabile_precedente: previous, responsabile_nuovo: data.responsabile_id,
    });
    return { ok: true };
  });

// ============= LIST AUDIT ENTRIES =============
export const listCommessaAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    commessa_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId } = await ctx(context);
    await fetchCommessaAccessible(context, data.commessa_id, organizationId);

    // Colleziona anche audit dei cantieri della commessa
    const { data: cantieri } = await context.supabase.from("cantieri")
      .select("id").eq("commessa_id", data.commessa_id).eq("organization_id", organizationId);
    const cantIds = (cantieri ?? []).map((k: any) => k.id);

    let query = context.supabase.from("audit_log")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    // Filtro: entità commesse per questa commessa, oppure entità cantieri dei suoi cantieri
    const filters: string[] = [
      `and(entity.eq.commesse,entity_id.eq.${data.commessa_id})`,
    ];
    if (cantIds.length) {
      filters.push(`and(entity.eq.cantieri,entity_id.in.(${cantIds.join(",")}))`);
    }
    query = query.or(filters.join(","));
    const { data: rows, error } = await query;
    if (error) throw error;

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean)));
    let userMap = new Map<string, any>();
    if (userIds.length) {
      const { data: profs } = await context.supabase.from("profiles")
        .select("id, nome, cognome, email").in("id", userIds);
      for (const p of profs ?? []) userMap.set(p.id, p);
    }
    return (rows ?? []).map((r: any) => ({ ...r, user: r.user_id ? userMap.get(r.user_id) ?? null : null }));
  });

// ============= LIST RAPPORTINI per commessa =============
export const listRapportiniByCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId } = await ctx(context);
    await fetchCommessaAccessible(context, data.commessa_id, organizationId);
    const { data: rows, error } = await context.supabase
      .from("rapportini")
      .select("*")
      .eq("commessa_id", data.commessa_id)
      .eq("organization_id", organizationId)
      .order("data", { ascending: false })
      .limit(50);
    if (error) throw error;

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean)));
    const cantIds = Array.from(new Set((rows ?? []).map((r: any) => r.cantiere_id).filter(Boolean)));
    const [{ data: profs }, { data: canti }] = await Promise.all([
      userIds.length
        ? context.supabase.from("profiles").select("id, nome, cognome, email").in("id", userIds)
        : Promise.resolve({ data: [] }),
      cantIds.length
        ? context.supabase.from("cantieri").select("id, codice, nome").in("id", cantIds)
        : Promise.resolve({ data: [] }),
    ]);
    const pMap = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]));
    const kMap = new Map<string, any>((canti ?? []).map((k: any) => [k.id, k]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      user: r.user_id ? pMap.get(r.user_id) ?? null : null,
      cantiere: r.cantiere_id ? kMap.get(r.cantiere_id) ?? null : null,
    }));
  });

// ============= LIST DOCUMENTI per commessa =============
export const listDocumentiByCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId } = await ctx(context);
    await fetchCommessaAccessible(context, data.commessa_id, organizationId);
    const { data: rows, error } = await context.supabase
      .from("documenti")
      .select("*")
      .eq("commessa_id", data.commessa_id)
      .eq("organization_id", organizationId)
      .order("data_documento", { ascending: false, nullsFirst: false })
      .limit(100);
    if (error) throw error;

    const cantIds = Array.from(new Set((rows ?? []).map((r: any) => r.cantiere_id).filter(Boolean)));
    const { data: canti } = cantIds.length
      ? await context.supabase.from("cantieri").select("id, codice, nome").in("id", cantIds)
      : { data: [] };
    const kMap = new Map<string, any>((canti ?? []).map((k: any) => [k.id, k]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      cantiere: r.cantiere_id ? kMap.get(r.cantiere_id) ?? null : null,
    }));
  });

// =========================================================================
// SAFE LIST / DASHBOARD — Sprint 4 Blocco 6d (payload role-aware, no colonne
// economiche per capocantiere/operaio/cliente/fornitore)
// =========================================================================

const ECON_ROLES: AppRole[] = [
  "proprietario","amministratore","amministrazione","ufficio_tecnico","responsabile_commessa",
];

const OPERATIONAL_COLS = [
  "id","organization_id","cliente_id","responsabile_id","codice","denominazione",
  "indirizzo_cantiere","data_inizio","data_inizio_prevista","data_inizio_effettiva",
  "data_fine_prevista","data_fine_effettiva","data_apertura","avanzamento_pct","stato",
  "note","titolo","descrizione","tipologia","priorita","closed_at","closed_by",
  "archived_at","archived_by","avanzamento_modalita","avanzamento_calcolato_at",
  "created_at","updated_at",
].join(", ");

export const listCommesseBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ showArchived: z.boolean().optional().default(false) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const canEcon = hasAny(roles, ECON_ROLES);
    const cols = canEcon
      ? "*, clienti!commesse_cliente_id_fkey(ragione_sociale)"
      : `${OPERATIONAL_COLS}, clienti!commesse_cliente_id_fkey(ragione_sociale)`;
    let q = context.supabase.from("commesse")
      .select(cols)
      .eq("organization_id", organizationId)
      .order("data_inizio_prevista", { ascending: false, nullsFirst: false });
    if (!data.showArchived) q = q.is("archived_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(mapServerError(error));
    const respIds = Array.from(new Set((rows ?? []).map((r: any) => r.responsabile_id).filter(Boolean)));
    const respMap = new Map<string, any>();
    if (respIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles").select("id, nome, cognome, email").in("id", respIds as any);
      for (const p of profs ?? []) respMap.set((p as any).id, p);
    }
    return {
      canViewEconomics: canEcon,
      rows: (rows ?? []).map((r: any) => ({
        ...r,
        responsabile: r.responsabile_id ? respMap.get(r.responsabile_id) ?? null : null,
      })),
    };
  });

export const listCommesseByCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ cliente_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    const canEcon = hasAny(roles, ECON_ROLES);
    const cols = canEcon
      ? "id, codice, denominazione, stato, importo, data_inizio"
      : "id, codice, denominazione, stato, data_inizio";
    const { data: rows, error } = await context.supabase
      .from("commesse").select(cols)
      .eq("cliente_id", data.cliente_id)
      .eq("organization_id", organizationId)
      .order("data_inizio", { ascending: false });
    if (error) throw new Error(mapServerError(error));
    return {
      canViewEconomics: canEcon,
      rows: (rows ?? []).map((r: any) => (canEcon ? r : { ...r, importo: null })),
    };
  });
