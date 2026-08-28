import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------- Utilities ----------------

const CLIENT_TIPO = z.enum(["persona_fisica", "azienda", "condominio", "ente", "altro"]);
const CLIENT_STATO = z.enum(["potenziale", "attivo", "inattivo", "archiviato"]);
const ATT_TIPO = z.enum(["telefonata", "email", "incontro", "sopralluogo", "nota", "promemoria", "altro"]);
const ATT_STATO = z.enum(["pianificata", "completata", "annullata"]);
const ATT_PRIO = z.enum(["bassa", "normale", "alta", "urgente"]);

type AppRole =
  | "proprietario" | "amministratore" | "ufficio_tecnico" | "amministrazione"
  | "responsabile_commessa" | "capocantiere" | "operaio" | "cliente" | "fornitore";

const MANAGE_ROLES: AppRole[] = ["proprietario", "amministratore", "ufficio_tecnico", "amministrazione"];
const ARCHIVE_ROLES: AppRole[] = ["proprietario", "amministratore", "amministrazione"];

function normPiva(v?: string | null) {
  return (v ?? "").replace(/\s+/g, "").toLowerCase() || null;
}
function normCF(v?: string | null) {
  return (v ?? "").replace(/\s+/g, "").toUpperCase() || null;
}
function normEmail(v?: string | null) {
  return (v ?? "").trim().toLowerCase() || null;
}
function normTel(v?: string | null) {
  return (v ?? "").replace(/[\s\-().]/g, "") || null;
}
function normDenom(v?: string | null) {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ") || null;
}

async function getOrgAndRoles(context: any): Promise<{ organizationId: string; roles: AppRole[] }> {
  const [{ data: prof }, { data: rows }] = await Promise.all([
    context.supabase.from("profiles").select("organization_id").eq("id", context.userId).maybeSingle(),
    context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
  ]);
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  return {
    organizationId: prof.organization_id as string,
    roles: (rows ?? []).map((r: any) => r.role as AppRole),
  };
}

function assertRole(roles: AppRole[], allowed: AppRole[], msg = "Non autorizzato") {
  if (!allowed.some((r) => roles.includes(r))) throw new Error(msg);
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

// ---------------- CLIENTI ----------------

const clienteBase = z.object({
  tipo: CLIENT_TIPO,
  denominazione: z.string().trim().min(1, "Denominazione richiesta").max(200),
  nome: z.string().trim().max(100).optional().nullable(),
  cognome: z.string().trim().max(100).optional().nullable(),
  ragione_sociale: z.string().trim().max(200).optional().nullable(),
  codice_fiscale: z.string().trim().max(32).optional().nullable(),
  partita_iva: z.string().trim().max(32).optional().nullable(),
  codice_destinatario: z.string().trim().max(16).optional().nullable(),
  pec: z.string().trim().email().max(255).optional().nullable().or(z.literal("").transform(() => null)),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal("").transform(() => null)),
  telefono: z.string().trim().max(40).optional().nullable(),
  cellulare: z.string().trim().max(40).optional().nullable(),
  sito_web: z.string().trim().max(255).optional().nullable(),
  indirizzo: z.string().trim().max(200).optional().nullable(),
  numero_civico: z.string().trim().max(20).optional().nullable(),
  cap: z.string().trim().max(10).optional().nullable(),
  citta: z.string().trim().max(100).optional().nullable(),
  provincia: z.string().trim().max(4).optional().nullable(),
  paese: z.string().trim().max(4).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  note_interne: z.string().max(2000).optional().nullable(),
  fonte_acquisizione: z.string().max(50).optional().nullable(),
  stato_cliente: CLIENT_STATO.optional(),
  responsabile_id: z.string().uuid().optional().nullable(),
  referente: z.string().trim().max(100).optional().nullable(),
});

async function findDuplicates(
  context: any,
  organizationId: string,
  data: { partita_iva?: string | null; codice_fiscale?: string | null; email?: string | null; telefono?: string | null; denominazione: string },
  excludeId?: string,
) {
  const piva = normPiva(data.partita_iva);
  const cf = normCF(data.codice_fiscale);
  const em = normEmail(data.email);
  const tel = normTel(data.telefono);
  const denomN = normDenom(data.denominazione);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin
    .from("clienti")
    .select("id, denominazione, partita_iva, codice_fiscale, email, telefono, archived_at")
    .eq("organization_id", organizationId)
    .limit(50);
  if (excludeId) query = query.neq("id", excludeId);
  const { data: rows } = await query;
  const list = rows ?? [];

  const blocks: string[] = [];
  const warnings: string[] = [];
  const duplicates: any[] = [];

  for (const r of list) {
    const rPiva = normPiva(r.partita_iva);
    const rCf = normCF(r.codice_fiscale);
    const rEm = normEmail(r.email);
    const rTel = normTel(r.telefono);
    const rDenom = normDenom(r.denominazione);
    let matched: string[] = [];
    if (piva && rPiva && piva === rPiva) matched.push("P.IVA");
    if (cf && rCf && cf === rCf) matched.push("Codice fiscale");
    if (em && rEm && em === rEm) matched.push("Email");
    if (tel && rTel && tel === rTel) matched.push("Telefono");
    if (denomN && rDenom && denomN === rDenom) matched.push("Denominazione");
    if (matched.length) duplicates.push({ ...r, matched });
  }

  for (const d of duplicates) {
    const isArchived = !!d.archived_at;
    if (d.matched.includes("P.IVA") && !isArchived) blocks.push(`P.IVA già usata da "${d.denominazione}"`);
    else if (d.matched.includes("Codice fiscale") && !isArchived) blocks.push(`Codice fiscale già usato da "${d.denominazione}"`);
    else if (d.matched.includes("Email")) warnings.push(`Email già usata da "${d.denominazione}"`);
    else if (d.matched.includes("Telefono")) warnings.push(`Telefono già usato da "${d.denominazione}"`);
    else if (d.matched.includes("Denominazione")) warnings.push(`Denominazione simile a "${d.denominazione}"`);
  }
  return { blocks, warnings, duplicates };
}

export const createCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ cliente: clienteBase, force: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, MANAGE_ROLES, "Non hai i permessi per creare clienti");

    const c = data.cliente;
    const dup = await findDuplicates(context, organizationId, c);
    if (dup.blocks.length && !data.force) {
      return { ok: false as const, blocked: true as const, blocks: dup.blocks, warnings: dup.warnings, duplicates: dup.duplicates };
    }
    // I bloccanti (P.IVA/CF identici non archiviati) NON sono forzabili
    if (dup.blocks.length) {
      return { ok: false as const, blocked: true as const, blocks: dup.blocks, warnings: dup.warnings, duplicates: dup.duplicates };
    }

    const payload: any = {
      ...c,
      organization_id: organizationId,
      created_by: context.userId,
      partita_iva: c.partita_iva ? c.partita_iva.replace(/\s+/g, "") : null,
      codice_fiscale: c.codice_fiscale ? c.codice_fiscale.replace(/\s+/g, "").toUpperCase() : null,
      email: normEmail(c.email),
      pec: normEmail(c.pec),
      // mantieni ragione_sociale coerente per compatibilità
      ragione_sociale: c.ragione_sociale ?? (c.tipo === "persona_fisica" ? null : c.denominazione),
    };

    // Valida responsabile (deve appartenere all'org)
    if (payload.responsabile_id) {
      const { data: p } = await context.supabase
        .from("profiles").select("id, organization_id, is_active").eq("id", payload.responsabile_id).maybeSingle();
      if (!p || p.organization_id !== organizationId || p.is_active === false) {
        throw new Error("Responsabile non valido per questa organizzazione");
      }
    }

    const { data: inserted, error } = await context.supabase.from("clienti").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "cliente.created", "cliente", inserted.id, { tipo: c.tipo, denominazione: c.denominazione });
    return { ok: true as const, id: inserted.id, warnings: dup.warnings };
  });

export const updateCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: clienteBase.partial(), force: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, MANAGE_ROLES, "Non hai i permessi per modificare clienti");

    // Verifica esistenza + org
    const { data: current, error: e0 } = await context.supabase
      .from("clienti").select("id, organization_id, denominazione").eq("id", data.id).maybeSingle();
    if (e0 || !current) throw new Error("Cliente non trovato");
    if (current.organization_id !== organizationId) throw new Error("Non autorizzato");

    const patch: any = { ...data.patch };
    // Protezione campi sensibili
    delete patch.organization_id;
    delete patch.created_by;
    delete patch.archived_at;
    delete patch.archived_by;
    if (patch.partita_iva !== undefined) patch.partita_iva = patch.partita_iva ? patch.partita_iva.replace(/\s+/g, "") : null;
    if (patch.codice_fiscale !== undefined) patch.codice_fiscale = patch.codice_fiscale ? patch.codice_fiscale.replace(/\s+/g, "").toUpperCase() : null;
    if (patch.email !== undefined) patch.email = normEmail(patch.email);
    if (patch.pec !== undefined) patch.pec = normEmail(patch.pec);

    if (patch.responsabile_id) {
      const { data: p } = await context.supabase
        .from("profiles").select("id, organization_id, is_active").eq("id", patch.responsabile_id).maybeSingle();
      if (!p || p.organization_id !== organizationId || p.is_active === false) {
        throw new Error("Responsabile non valido");
      }
    }

    // Duplicati (solo se cambiano campi identificativi)
    if (patch.partita_iva !== undefined || patch.codice_fiscale !== undefined || patch.email !== undefined || patch.telefono !== undefined || patch.denominazione !== undefined) {
      const merged = {
        partita_iva: patch.partita_iva ?? undefined,
        codice_fiscale: patch.codice_fiscale ?? undefined,
        email: patch.email ?? undefined,
        telefono: patch.telefono ?? undefined,
        denominazione: patch.denominazione ?? current.denominazione,
      };
      const dup = await findDuplicates(context, organizationId, merged as any, data.id);
      if (dup.blocks.length && !data.force) {
        return { ok: false as const, blocked: true as const, blocks: dup.blocks, warnings: dup.warnings, duplicates: dup.duplicates };
      }
      if (dup.blocks.length) return { ok: false as const, blocked: true as const, blocks: dup.blocks, warnings: dup.warnings, duplicates: dup.duplicates };
    }

    const { error } = await context.supabase.from("clienti").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "cliente.updated", "cliente", data.id, { fields: Object.keys(patch) });
    return { ok: true as const };
  });

export const archiveCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, ARCHIVE_ROLES, "Non hai i permessi per archiviare clienti");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("clienti").select("id, organization_id").eq("id", data.id).maybeSingle();
    if (!c || c.organization_id !== organizationId) throw new Error("Cliente non trovato");
    const { error } = await supabaseAdmin.from("clienti").update({
      archived_at: new Date().toISOString(),
      archived_by: context.userId,
      stato_cliente: "archiviato",
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "cliente.archived", "cliente", data.id, {});
    return { ok: true as const };
  });

export const restoreCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), stato: CLIENT_STATO.optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, ARCHIVE_ROLES, "Non hai i permessi per ripristinare clienti");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin.from("clienti").select("id, organization_id").eq("id", data.id).maybeSingle();
    if (!c || c.organization_id !== organizationId) throw new Error("Cliente non trovato");
    const { error } = await supabaseAdmin.from("clienti").update({
      archived_at: null,
      archived_by: null,
      stato_cliente: data.stato ?? "attivo",
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "cliente.restored", "cliente", data.id, {});
    return { ok: true as const };
  });

export const setResponsabile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), responsabile_id: z.string().uuid().nullable() }).parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, MANAGE_ROLES);
    if (data.responsabile_id) {
      const { data: p } = await context.supabase
        .from("profiles").select("id, organization_id, is_active").eq("id", data.responsabile_id).maybeSingle();
      if (!p || p.organization_id !== organizationId || p.is_active === false) throw new Error("Responsabile non valido");
    }
    const { error } = await context.supabase.from("clienti").update({ responsabile_id: data.responsabile_id }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "cliente.responsabile_changed", "cliente", data.id, { responsabile_id: data.responsabile_id });
    return { ok: true as const };
  });

// ---------------- CONTATTI ----------------

const contattoBase = z.object({
  cliente_id: z.string().uuid(),
  nome: z.string().trim().min(1).max(100),
  cognome: z.string().trim().max(100).optional().nullable(),
  ruolo: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal("").transform(() => null)),
  telefono: z.string().trim().max(40).optional().nullable(),
  cellulare: z.string().trim().max(40).optional().nullable(),
  pec: z.string().trim().email().max(255).optional().nullable().or(z.literal("").transform(() => null)),
  is_primary: z.boolean().optional(),
  note: z.string().max(2000).optional().nullable(),
});

async function assertClienteInOrg(context: any, clienteId: string, organizationId: string) {
  const { data } = await context.supabase.from("clienti").select("id, organization_id").eq("id", clienteId).maybeSingle();
  if (!data || data.organization_id !== organizationId) throw new Error("Cliente non trovato");
}

export const createContatto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => contattoBase.parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, MANAGE_ROLES);
    await assertClienteInOrg(context, data.cliente_id, organizationId);

    if (data.is_primary) {
      // sblocca eventuale precedente primary attivo
      await context.supabase.from("cliente_contatti").update({ is_primary: false })
        .eq("cliente_id", data.cliente_id).eq("is_primary", true).is("archived_at", null);
    }

    const payload = {
      ...data,
      organization_id: organizationId,
      email: normEmail(data.email),
      pec: normEmail(data.pec),
    };
    const { data: inserted, error } = await context.supabase.from("cliente_contatti").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "contatto.created", "cliente_contatto", inserted.id, { cliente_id: data.cliente_id });
    return { ok: true as const, id: inserted.id };
  });

export const updateContatto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: contattoBase.partial().omit({ cliente_id: true }) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, MANAGE_ROLES);
    const { data: cur } = await context.supabase.from("cliente_contatti").select("id, organization_id, cliente_id").eq("id", data.id).maybeSingle();
    if (!cur || cur.organization_id !== organizationId) throw new Error("Contatto non trovato");
    const patch: any = { ...data.patch };
    if (patch.email !== undefined) patch.email = normEmail(patch.email);
    if (patch.pec !== undefined) patch.pec = normEmail(patch.pec);
    if (patch.is_primary === true) {
      await context.supabase.from("cliente_contatti").update({ is_primary: false })
        .eq("cliente_id", cur.cliente_id).eq("is_primary", true).is("archived_at", null).neq("id", data.id);
    }
    const { error } = await context.supabase.from("cliente_contatti").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "contatto.updated", "cliente_contatto", data.id, { fields: Object.keys(patch) });
    return { ok: true as const };
  });

export const archiveContatto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, MANAGE_ROLES);
    const { data: cur } = await context.supabase.from("cliente_contatti").select("id, organization_id").eq("id", data.id).maybeSingle();
    if (!cur || cur.organization_id !== organizationId) throw new Error("Contatto non trovato");
    const { error } = await context.supabase.from("cliente_contatti").update({
      archived_at: new Date().toISOString(),
      is_primary: false,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "contatto.archived", "cliente_contatto", data.id, {});
    return { ok: true as const };
  });

// ---------------- ATTIVITÀ CRM ----------------

const attivitaBase = z.object({
  cliente_id: z.string().uuid(),
  contatto_id: z.string().uuid().optional().nullable(),
  tipo: ATT_TIPO,
  titolo: z.string().trim().min(1).max(200),
  descrizione: z.string().max(4000).optional().nullable(),
  stato: ATT_STATO.optional(),
  priorita: ATT_PRIO.optional(),
  data_attivita: z.string().datetime().optional(),
  scadenza: z.string().datetime().optional().nullable(),
  assegnata_a: z.string().uuid().optional().nullable(),
});

export const createAttivita = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => attivitaBase.parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await getOrgAndRoles(context);
    assertRole(roles, ["proprietario", "amministratore", "ufficio_tecnico", "amministrazione", "responsabile_commessa", "capocantiere"]);
    await assertClienteInOrg(context, data.cliente_id, organizationId);
    if (data.contatto_id) {
      const { data: ct } = await context.supabase.from("cliente_contatti").select("id, cliente_id, organization_id").eq("id", data.contatto_id).maybeSingle();
      if (!ct || ct.organization_id !== organizationId || ct.cliente_id !== data.cliente_id) throw new Error("Contatto non valido");
    }
    if (data.assegnata_a) {
      const { data: p } = await context.supabase.from("profiles").select("id, organization_id").eq("id", data.assegnata_a).maybeSingle();
      if (!p || p.organization_id !== organizationId) throw new Error("Assegnatario non valido");
    }
    const stato = data.stato ?? (data.tipo === "nota" ? "completata" : "pianificata");
    const payload = {
      organization_id: organizationId,
      cliente_id: data.cliente_id,
      contatto_id: data.contatto_id ?? null,
      tipo: data.tipo,
      titolo: data.titolo,
      descrizione: data.descrizione ?? null,
      stato,
      priorita: data.priorita ?? "normale",
      data_attivita: data.data_attivita ?? new Date().toISOString(),
      scadenza: data.scadenza ?? null,
      assegnata_a: data.assegnata_a ?? null,
      created_by: context.userId,
    };
    const { data: inserted, error } = await context.supabase.from("crm_attivita").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "attivita.created", "crm_attivita", inserted.id, { cliente_id: data.cliente_id, tipo: data.tipo });
    return { ok: true as const, id: inserted.id };
  });

export const completeAttivita = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId } = await getOrgAndRoles(context);
    const { error } = await context.supabase.from("crm_attivita").update({ stato: "completata" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "attivita.completed", "crm_attivita", data.id, {});
    return { ok: true as const };
  });

export const cancelAttivita = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId } = await getOrgAndRoles(context);
    const { error } = await context.supabase.from("crm_attivita").update({ stato: "annullata" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "attivita.cancelled", "crm_attivita", data.id, {});
    return { ok: true as const };
  });

export const updateAttivita = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    id: z.string().uuid(),
    patch: attivitaBase.partial().omit({ cliente_id: true }),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { organizationId } = await getOrgAndRoles(context);
    const patch: any = { ...data.patch };
    const { error } = await context.supabase.from("crm_attivita").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAudit(context, organizationId, "attivita.updated", "crm_attivita", data.id, { fields: Object.keys(patch) });
    return { ok: true as const };
  });
