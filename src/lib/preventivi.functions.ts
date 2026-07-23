import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ----- Ruoli -----
type AppRole =
  | "proprietario" | "amministratore" | "ufficio_tecnico" | "amministrazione"
  | "responsabile_commessa" | "capocantiere" | "operaio" | "cliente" | "fornitore";

const MANAGE_ROLES: AppRole[] = ["proprietario", "amministratore", "ufficio_tecnico"];
const VIEW_ROLES: AppRole[] = [
  "proprietario", "amministratore", "ufficio_tecnico", "amministrazione", "responsabile_commessa",
];

async function ctx(context: any): Promise<{ organizationId: string; roles: AppRole[] }> {
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
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    organization_id: organizationId,
    user_id: context.userId,
    action,
    entity: "preventivi",
    entity_id: entityId,
    metadata: metadata as any,
  });
}

async function fetchPreventivoOrThrow(context: any, id: string) {
  const { data, error } = await context.supabase
    .from("preventivi").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Preventivo non trovato");
  return data;
}

// ============= CREATE PREVENTIVO =============

const createSchema = z.object({
  cliente_id: z.string().uuid().nullable().optional(),
  titolo: z.string().trim().max(200).nullable().optional(),
  oggetto: z.string().trim().min(1).max(500),
  tipo: z.enum(["ristrutturazione", "nuova_costruzione", "manutenzione", "impianti", "opere_pubbliche", "consulenza", "altro"]).nullable().optional(),
  responsabile_id: z.string().uuid().nullable().optional(),
  data_preventivo: z.string().optional(),
  data_validita: z.string().nullable().optional(),
  iva_default_pct: z.number().min(0).max(100).optional(),
  note: z.string().max(4000).nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
});

export const createPreventivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const anno = new Date().getFullYear();
    const { data: num, error: numErr } = await supabaseAdmin.rpc("assign_preventivo_numero", { _org: organizationId, _anno: anno });
    if (numErr) throw numErr;

    let templateFields: Record<string, unknown> = {};
    if (data.template_id) {
      const { data: tpl } = await context.supabase
        .from("preventivo_templates").select("*").eq("id", data.template_id).maybeSingle();
      if (tpl) templateFields = {
        condizioni_pagamento: tpl.condizioni_pagamento,
        tempi_esecuzione: tpl.tempi_esecuzione,
        esclusioni: tpl.esclusioni,
        garanzie: tpl.garanzie,
        condizioni_generali: tpl.condizioni_generali,
        iva_default_pct: tpl.iva_default_pct,
      };
    }

    const insertPayload: any = {
      organization_id: organizationId,
      numero: num,
      versione: 1,
      is_current_version: true,
      stato: "bozza",
      cliente_id: data.cliente_id ?? null,
      titolo: data.titolo ?? null,
      oggetto: data.oggetto,
      tipo: data.tipo ?? null,
      responsabile_id: data.responsabile_id ?? null,
      data_preventivo: data.data_preventivo ?? new Date().toISOString().slice(0, 10),
      data_validita: data.data_validita ?? null,
      iva_default_pct: data.iva_default_pct ?? (templateFields.iva_default_pct as number | undefined) ?? 22,
      note: data.note ?? null,
      created_by: context.userId,
      ...templateFields,
    };

    const { data: created, error } = await context.supabase
      .from("preventivi").insert(insertPayload).select("id").single();
    if (error) throw error;

    // root = self
    await context.supabase.from("preventivi").update({ root_preventivo_id: created.id }).eq("id", created.id);

    await logAudit(context, organizationId, "create_preventivo", created.id, { numero: num });
    return { id: created.id, numero: num as string };
  });

// ============= UPDATE HEADER (optimistic lock) =============

const headerSchema = z.object({
  id: z.string().uuid(),
  expected_updated_at: z.string(),
  patch: z.object({
    titolo: z.string().max(200).nullable().optional(),
    oggetto: z.string().min(1).max(500).optional(),
    tipo: z.string().nullable().optional(),
    cliente_id: z.string().uuid().nullable().optional(),
    responsabile_id: z.string().uuid().nullable().optional(),
    data_preventivo: z.string().optional(),
    data_validita: z.string().nullable().optional(),
    sconto_globale_pct: z.number().min(0).max(100).optional(),
    maggiorazione_globale_pct: z.number().min(0).max(100).optional(),
    spese_accessorie: z.number().min(0).optional(),
    iva_default_pct: z.number().min(0).max(100).optional(),
    condizioni_pagamento: z.string().max(4000).nullable().optional(),
    tempi_esecuzione: z.string().max(2000).nullable().optional(),
    esclusioni: z.string().max(4000).nullable().optional(),
    garanzie: z.string().max(4000).nullable().optional(),
    condizioni_generali: z.string().max(8000).nullable().optional(),
    firma_referente: z.string().max(200).nullable().optional(),
    note: z.string().max(4000).nullable().optional(),
  }),
});

export const updatePreventivoHeader = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => headerSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const cur = await fetchPreventivoOrThrow(context, data.id);
    if (cur.organization_id !== organizationId) throw new Error("Non autorizzato");
    if (!cur.is_current_version) throw new Error("Impossibile modificare una versione superata");
    if (cur.stato === "convertito" || cur.stato === "annullato") throw new Error("Preventivo non modificabile in questo stato");
    if (new Date(cur.updated_at).getTime() !== new Date(data.expected_updated_at).getTime()) {
      const e: any = new Error("Il preventivo è stato modificato da un altro utente. Ricarica la pagina."); e.status = 409; throw e;
    }
    const { error } = await context.supabase.from("preventivi").update(data.patch as any).eq("id", data.id);
    if (error) throw error;
    await logAudit(context, organizationId, "update_header", data.id, {});
    return { ok: true };
  });

// ============= CATEGORIE =============

const upsertCatSchema = z.object({
  id: z.string().uuid().optional(),
  preventivo_id: z.string().uuid(),
  titolo: z.string().trim().min(1).max(200),
  descrizione: z.string().max(2000).nullable().optional(),
  posizione: z.number().int().min(0).optional(),
});

export const upsertCategoria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertCatSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const p = await fetchPreventivoOrThrow(context, data.preventivo_id);
    if (p.organization_id !== organizationId) throw new Error("Non autorizzato");
    if (!p.is_current_version) throw new Error("Versione non modificabile");

    if (data.id) {
      const { error } = await context.supabase.from("preventivo_categorie")
        .update({ titolo: data.titolo, descrizione: data.descrizione ?? null, ...(data.posizione != null ? { posizione: data.posizione } : {}) })
        .eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    let pos = data.posizione;
    if (pos == null) {
      const { data: maxRow } = await context.supabase
        .from("preventivo_categorie").select("posizione").eq("preventivo_id", data.preventivo_id)
        .order("posizione", { ascending: false }).limit(1).maybeSingle();
      pos = ((maxRow?.posizione as number | undefined) ?? -1) + 1;
    }
    const { data: created, error } = await context.supabase.from("preventivo_categorie").insert({
      organization_id: organizationId, preventivo_id: data.preventivo_id,
      titolo: data.titolo, descrizione: data.descrizione ?? null, posizione: pos,
    }).select("id").single();
    if (error) throw error;
    return { id: created.id };
  });

export const deleteCategoria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const { error } = await context.supabase.from("preventivo_categorie")
      .delete().eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const moveCategoria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const { data: cat } = await context.supabase.from("preventivo_categorie").select("*").eq("id", data.id).maybeSingle();
    if (!cat) throw new Error("Categoria non trovata");
    const cmp = data.direction === "up" ? "lt" : "gt";
    const order = data.direction === "up" ? { ascending: false } : { ascending: true };
    const { data: other } = await context.supabase
      .from("preventivo_categorie").select("*")
      .eq("preventivo_id", cat.preventivo_id)[cmp]("posizione", cat.posizione)
      .order("posizione", order).limit(1).maybeSingle();
    if (!other) return { ok: true };
    await context.supabase.from("preventivo_categorie").update({ posizione: other.posizione }).eq("id", cat.id);
    await context.supabase.from("preventivo_categorie").update({ posizione: cat.posizione }).eq("id", other.id);
    void organizationId;
    return { ok: true };
  });

// ============= VOCI =============

const upsertVoceSchema = z.object({
  id: z.string().uuid().optional(),
  preventivo_id: z.string().uuid(),
  categoria_id: z.string().uuid(),
  ordine: z.number().int().min(0).optional(),
  codice: z.string().max(50).nullable().optional(),
  descrizione: z.string().trim().min(1).max(2000),
  unita_misura: z.string().max(20).nullable().optional(),
  quantita: z.number().min(0),
  costo_unitario: z.number().min(0).optional(),
  ricarico_pct: z.number().min(0).max(1000).optional(),
  prezzo_unitario: z.number().min(0).optional(),
  sconto_pct: z.number().min(0).max(100).optional(),
  maggiorazione_pct: z.number().min(0).max(100).optional(),
  iva_pct: z.number().min(0).max(100).optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const upsertVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertVoceSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const p = await fetchPreventivoOrThrow(context, data.preventivo_id);
    if (p.organization_id !== organizationId) throw new Error("Non autorizzato");
    if (!p.is_current_version) throw new Error("Versione non modificabile");

    const payload: any = {
      descrizione: data.descrizione,
      unita_misura: data.unita_misura ?? null,
      quantita: data.quantita,
      costo_unitario: data.costo_unitario ?? 0,
      ricarico_pct: data.ricarico_pct ?? 0,
      prezzo_unitario: data.prezzo_unitario ?? 0,
      sconto_pct: data.sconto_pct ?? 0,
      maggiorazione_pct: data.maggiorazione_pct ?? 0,
      iva_pct: data.iva_pct ?? p.iva_default_pct ?? 22,
      codice: data.codice ?? null,
      note: data.note ?? null,
      categoria_id: data.categoria_id,
    };

    if (data.id) {
      const { error } = await context.supabase.from("preventivo_voci").update(payload).eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    let ordine = data.ordine;
    if (ordine == null) {
      const { data: maxRow } = await context.supabase
        .from("preventivo_voci").select("ordine").eq("categoria_id", data.categoria_id)
        .order("ordine", { ascending: false }).limit(1).maybeSingle();
      ordine = ((maxRow?.ordine as number | undefined) ?? -1) + 1;
    }
    const { data: created, error } = await context.supabase.from("preventivo_voci").insert({
      organization_id: organizationId, preventivo_id: data.preventivo_id, ordine, ...payload,
    }).select("id").single();
    if (error) throw error;
    return { id: created.id };
  });

export const deleteVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const { error } = await context.supabase.from("preventivo_voci")
      .delete().eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw error;
    return { ok: true };
  });

export const moveVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const { data: v } = await context.supabase.from("preventivo_voci").select("*").eq("id", data.id).maybeSingle();
    if (!v) throw new Error("Voce non trovata");
    const cmp = data.direction === "up" ? "lt" : "gt";
    const order = data.direction === "up" ? { ascending: false } : { ascending: true };
    const { data: other } = await context.supabase
      .from("preventivo_voci").select("*")
      .eq("categoria_id", v.categoria_id as string)[cmp]("ordine", v.ordine)
      .order("ordine", order).limit(1).maybeSingle();
    if (!other) return { ok: true };
    await context.supabase.from("preventivo_voci").update({ ordine: other.ordine }).eq("id", v.id);
    await context.supabase.from("preventivo_voci").update({ ordine: v.ordine }).eq("id", other.id);
    void organizationId;
    return { ok: true };
  });

export const duplicateVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const { data: v } = await context.supabase.from("preventivo_voci").select("*").eq("id", data.id).maybeSingle();
    if (!v || v.organization_id !== organizationId) throw new Error("Voce non trovata");
    const { data: maxRow } = await context.supabase
      .from("preventivo_voci").select("ordine").eq("categoria_id", v.categoria_id as string)
      .order("ordine", { ascending: false }).limit(1).maybeSingle();
    const ordine = ((maxRow?.ordine as number | undefined) ?? -1) + 1;
    const { id: _, created_at: __, updated_at: ___, importo_netto, costo_totale, margine, margine_pct, totale, ...rest } = v as any;
    const { data: created, error } = await context.supabase.from("preventivo_voci").insert({
      ...rest, ordine, descrizione: `${rest.descrizione} (copia)`,
    }).select("id").single();
    if (error) throw error;
    return { id: created.id };
  });

// ============= STATE MACHINE =============

const stateSchema = z.object({
  id: z.string().uuid(),
  nuovo_stato: z.enum(["bozza", "in_revisione", "pronto", "inviato", "accettato", "rifiutato", "scaduto", "annullato"]),
  note: z.string().max(1000).nullable().optional(),
  motivo: z.string().max(500).nullable().optional(),
});

export const changeStato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => stateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("change_preventivo_stato", {
      _preventivo_id: data.id, _nuovo_stato: data.nuovo_stato,
      _note: data.note ?? null, _motivo: data.motivo ?? null,
    });
    if (error) throw error;
    return { ok: true };
  });

// ============= NUOVA VERSIONE =============

export const createNuovaVersione = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), motivo: z.string().max(500).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: newId, error } = await context.supabase.rpc("create_preventivo_nuova_versione", {
      _preventivo_id: data.id, _motivo: data.motivo ?? null,
    });
    if (error) throw error;
    return { id: newId as string };
  });

// ============= DUPLICATE (nuovo preventivo, nuovo numero, root nuovo) =============

export const duplicatePreventivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, MANAGE_ROLES);
    const src = await fetchPreventivoOrThrow(context, data.id);
    if (src.organization_id !== organizationId) throw new Error("Non autorizzato");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const anno = new Date().getFullYear();
    const { data: num, error: numErr } = await supabaseAdmin.rpc("assign_preventivo_numero", { _org: organizationId, _anno: anno });
    if (numErr) throw numErr;

    const { data: created, error } = await context.supabase.from("preventivi").insert({
      organization_id: organizationId,
      numero: num, versione: 1, is_current_version: true, stato: "bozza",
      cliente_id: src.cliente_id, tipo: src.tipo,
      titolo: src.titolo, oggetto: `${src.oggetto} (copia)`,
      data_preventivo: new Date().toISOString().slice(0, 10),
      data_validita: src.data_validita, responsabile_id: src.responsabile_id,
      sconto_globale_pct: src.sconto_globale_pct, maggiorazione_globale_pct: src.maggiorazione_globale_pct,
      spese_accessorie: src.spese_accessorie, iva_default_pct: src.iva_default_pct,
      condizioni_pagamento: src.condizioni_pagamento, tempi_esecuzione: src.tempi_esecuzione,
      esclusioni: src.esclusioni, garanzie: src.garanzie, condizioni_generali: src.condizioni_generali,
      firma_referente: src.firma_referente, note: src.note,
      created_by: context.userId,
    }).select("id").single();
    if (error) throw error;
    await context.supabase.from("preventivi").update({ root_preventivo_id: created.id }).eq("id", created.id);

    // Copia categorie e voci
    const { data: cats } = await context.supabase
      .from("preventivo_categorie").select("*").eq("preventivo_id", data.id).order("posizione");
    for (const cat of cats ?? []) {
      const { data: newCat, error: catErr } = await context.supabase.from("preventivo_categorie").insert({
        organization_id: organizationId, preventivo_id: created.id,
        titolo: cat.titolo, descrizione: cat.descrizione, posizione: cat.posizione,
      }).select("id").single();
      if (catErr) throw catErr;
      const { data: voci } = await context.supabase
        .from("preventivo_voci").select("*").eq("categoria_id", cat.id).order("ordine");
      if (voci?.length) {
        const rows = voci.map((v: any) => ({
          organization_id: organizationId, preventivo_id: created.id, categoria_id: newCat.id,
          ordine: v.ordine, codice: v.codice, capitolo: v.capitolo, categoria: v.categoria,
          descrizione: v.descrizione, unita_misura: v.unita_misura, quantita: v.quantita,
          costo_unitario: v.costo_unitario, ricarico_pct: v.ricarico_pct, prezzo_unitario: v.prezzo_unitario,
          sconto_pct: v.sconto_pct, maggiorazione_pct: v.maggiorazione_pct, iva_pct: v.iva_pct, note: v.note,
        }));
        const { error: vErr } = await context.supabase.from("preventivo_voci").insert(rows);
        if (vErr) throw vErr;
      }
    }
    await logAudit(context, organizationId, "duplicate_preventivo", created.id, { from: data.id, numero: num });
    return { id: created.id, numero: num as string };
  });

// ============= CONVERT TO COMMESSA =============

const convertSchema = z.object({
  id: z.string().uuid(),
  data_inizio: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  indirizzo_cantiere: z.string().max(500).nullable().optional(),
  responsabile_id: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const convertToCommessa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => convertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: commessaId, error } = await context.supabase.rpc("convert_preventivo_to_commessa", {
      _preventivo_id: data.id,
      _data_inizio: data.data_inizio ?? null,
      _data_fine_prevista: data.data_fine_prevista ?? null,
      _indirizzo_cantiere: data.indirizzo_cantiere ?? null,
      _responsabile_id: data.responsabile_id ?? null,
      _note: data.note ?? null,
    });
    if (error) throw error;
    return { commessa_id: commessaId as string };
  });

// ============= PDF =============

export const generatePreventivoPdfFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { organizationId, roles } = await ctx(context);
    assertRole(roles, VIEW_ROLES);

    const [{ data: p }, { data: cats }, { data: voci }, { data: org }] = await Promise.all([
      context.supabase.from("preventivi").select("*, clienti(*)").eq("id", data.id).maybeSingle(),
      context.supabase.from("preventivo_categorie").select("*").eq("preventivo_id", data.id).order("posizione"),
      context.supabase.from("preventivo_voci").select("*").eq("preventivo_id", data.id).order("ordine"),
      context.supabase.from("organizations").select("*").eq("id", organizationId).maybeSingle(),
    ]);
    if (!p) throw new Error("Preventivo non trovato");

    const categorie = (cats ?? []).map((c: any) => ({
      id: c.id, titolo: c.titolo, descrizione: c.descrizione,
      posizione: c.posizione, subtotale_ricavo: Number(c.subtotale_ricavo ?? 0),
      voci: (voci ?? []).filter((v: any) => v.categoria_id === c.id).map((v: any) => ({
        ordine: v.ordine, descrizione: v.descrizione, unita_misura: v.unita_misura,
        quantita: Number(v.quantita), prezzo_unitario: Number(v.prezzo_unitario),
        sconto_pct: Number(v.sconto_pct), maggiorazione_pct: Number(v.maggiorazione_pct),
        importo_netto: Number(v.importo_netto), iva_pct: Number(v.iva_pct),
      })),
    }));

    const cli = p.clienti as any;
    const { generatePreventivoPdf } = await import("./preventivi-pdf.server");
    const bytes = await generatePreventivoPdf({
      preventivo: p as any,
      organizzazione: {
        nome: org?.nome ?? "Organizzazione",
        email: org?.email ?? null, telefono: org?.telefono ?? null,
        partita_iva: org?.partita_iva ?? null, indirizzo: org?.indirizzo ?? null,
      },
      cliente: cli ? {
        denominazione: cli.denominazione, partita_iva: cli.partita_iva, codice_fiscale: cli.codice_fiscale,
        indirizzo: cli.indirizzo, citta: cli.citta, cap: cli.cap, provincia: cli.provincia,
      } : null,
      categorie,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const filename = `Preventivo_${(p as any).numero}_v${(p as any).versione}.pdf`;
    const path = `${organizationId}/preventivi/${data.id}/${Date.now()}_${filename}`;
    const { error: upErr } = await supabaseAdmin.storage.from("documenti")
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw upErr;

    const { data: doc, error: docErr } = await supabaseAdmin.from("documenti").insert({
      organization_id: organizationId,
      nome: filename, categoria: "preventivo",
      descrizione: `PDF preventivo ${(p as any).numero} v${(p as any).versione}`,
      storage_path: path, mime_type: "application/pdf",
      size_bytes: bytes.byteLength,
      cliente_id: (p as any).cliente_id,
      preventivo_id: data.id,
      uploaded_by: context.userId,
      visibilita: "interna",
      data_documento: new Date().toISOString().slice(0, 10),
    }).select("id").single();
    if (docErr) throw docErr;

    await logAudit(context, organizationId, "generate_pdf", data.id, { documento_id: doc.id, path });
    return { documento_id: doc.id, storage_path: path, filename };
  });
