import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";

/**
 * Blocco 6c — Server functions BUDGET DI COMMESSA
 *
 * Regole:
 * - Tutte le mutazioni passano ESCLUSIVAMENTE tramite RPC SECURITY DEFINER.
 * - Nessun INSERT/UPDATE/DELETE diretto su `commessa_budget_voci` o su aggregati `commesse`.
 * - `organization_id` NON viene mai accettato dal client.
 * - Optimistic locking obbligatorio via `expected_updated_at`.
 * - Errori mappati con `mapServerError` (nessun dettaglio SQL esposto).
 */

const uuid = z.string().uuid();
const iso = z.string().min(1, "expected_updated_at obbligatorio");
const num0 = z.number().min(0);
const numOptNull = z.number().min(0).nullable().optional();

const COSTO_CAT = [
  "manodopera", "materiali", "subappalti", "noleggi", "mezzi", "trasporti",
  "consulenze", "sicurezza", "smaltimenti", "utenze", "spese_generali",
  "imprevisti", "altro",
] as const;
const RICAVO_CAT = ["contratto", "extra_approvato", "extra_non_approvato", "variante", "rimborso", "altro"] as const;

export const BUDGET_CATEGORIES = {
  costo: COSTO_CAT,
  ricavo: RICAVO_CAT,
} as const;

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

// ─────────────────────────────────────────────────────────────────────────────
// LIST VOCI
// ─────────────────────────────────────────────────────────────────────────────
const listSchema = z.object({
  commessa_id: uuid,
  tipo: z.enum(["ricavo", "costo"]).optional(),
  categoria: z.string().optional(),
  cantiere_id: uuid.optional(),
  fase_id: uuid.optional(),
  fornitore_id: uuid.optional(),
  fonte: z.string().optional(),
  includeArchived: z.boolean().optional(),
  onlyLocked: z.boolean().optional(),
});

export const listCommessaBudgetVoci = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const orgId = await currentOrgId(context);
      let q = context.supabase
        .from("commessa_budget_voci")
        .select("*")
        .eq("commessa_id", data.commessa_id)
        .eq("organization_id", orgId)
        .order("posizione", { ascending: true })
        .order("created_at", { ascending: true });
      if (data.tipo) q = q.eq("tipo", data.tipo);
      if (data.categoria) q = q.eq("categoria", data.categoria);
      if (data.cantiere_id) q = q.eq("cantiere_id", data.cantiere_id);
      if (data.fase_id) q = q.eq("fase_id", data.fase_id);
      if (data.fornitore_id) q = q.eq("fornitore_id", data.fornitore_id);
      if (data.fonte) q = q.eq("fonte", data.fonte);
      if (data.onlyLocked) q = q.eq("is_locked", true);
      if (!data.includeArchived) q = q.is("archived_at", null);
      const { data: rows, error } = await q;
      if (error) throw error;

      const cantIds = Array.from(new Set((rows ?? []).map((r: any) => r.cantiere_id).filter(Boolean)));
      const faseIds = Array.from(new Set((rows ?? []).map((r: any) => r.fase_id).filter(Boolean)));
      const fornIds = Array.from(new Set((rows ?? []).map((r: any) => r.fornitore_id).filter(Boolean)));
      const [{ data: cants }, { data: fasi }, { data: forns }] = await Promise.all([
        cantIds.length ? context.supabase.from("cantieri").select("id, codice, nome").in("id", cantIds) : Promise.resolve({ data: [] as any[] }),
        faseIds.length ? context.supabase.from("commessa_fasi").select("id, titolo").in("id", faseIds) : Promise.resolve({ data: [] as any[] }),
        fornIds.length ? context.supabase.from("fornitori").select("id, ragione_sociale").in("id", fornIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const cm = new Map((cants ?? []).map((r: any) => [r.id, r]));
      const fm = new Map((fasi ?? []).map((r: any) => [r.id, r]));
      const om = new Map((forns ?? []).map((r: any) => [r.id, r]));
      return (rows ?? []).map((r: any) => ({
        ...r,
        cantiere: r.cantiere_id ? cm.get(r.cantiere_id) ?? null : null,
        fase: r.fase_id ? fm.get(r.fase_id) ?? null : null,
        fornitore: r.fornitore_id ? om.get(r.fornitore_id) ?? null : null,
      }));
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
export const getCommessaBudgetSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const orgId = await currentOrgId(context);
      const { data: c, error } = await context.supabase
        .from("commesse")
        .select([
          "id", "organization_id", "preventivo_id", "updated_at", "closed_at", "archived_at",
          "budget_modalita", "budget_calcolato_at",
          "ricavi_previsti", "ricavi_acquisiti", "extra_approvati", "extra_non_approvati", "ricavi_aggiornati",
          "costi_previsti", "costi_impegnati", "costi_sostenuti", "costi_residui_stimati", "costo_aggiornato",
          "margine_previsto", "margine_aggiornato", "margine_percentuale", "margine_percentuale_aggiornato",
          "scostamento_costi", "scostamento_ricavi", "scostamento_margine",
          "baseline_preventivo_id", "baseline_ricavi", "baseline_costi", "baseline_margine", "baseline_created_at",
        ].join(","))
        .eq("id", data.commessa_id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      if (!c) throw new Error("Commessa non trovata");

      const { data: counts, error: e2 } = await context.supabase
        .from("commessa_budget_voci")
        .select("id, archived_at, is_locked")
        .eq("commessa_id", data.commessa_id)
        .eq("organization_id", orgId);
      if (e2) throw e2;
      const rows = counts ?? [];
      const numero_voci_attive = rows.filter((r: any) => !r.archived_at).length;
      const numero_voci_archiviate = rows.filter((r: any) => r.archived_at).length;
      const numero_voci_locked = rows.filter((r: any) => r.is_locked && !r.archived_at).length;

      return { ...(c as any), numero_voci_attive, numero_voci_archiviate, numero_voci_locked };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
const createVoceSchema = z.object({
  commessa_id: uuid,
  expected_updated_at: iso,
  tipo: z.enum(["ricavo", "costo"]),
  categoria: z.string().min(1),
  descrizione: z.string().trim().min(1).max(1000),
  sottocategoria: z.string().max(200).nullable().optional(),
  codice: z.string().max(100).nullable().optional(),
  unita_misura: z.string().max(20).nullable().optional(),
  quantita: numOptNull,
  prezzo_unitario: numOptNull,
  importo_previsto: num0.default(0),
  importo_impegnato: num0.default(0),
  importo_sostenuto: num0.default(0),
  costo_residuo_stimato: num0.default(0),
  cantiere_id: uuid.nullable().optional(),
  fase_id: uuid.nullable().optional(),
  fornitore_id: uuid.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const createCommessaBudgetVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createVoceSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await (context.supabase.rpc as any)("create_commessa_budget_voce", {
        _commessa_id: data.commessa_id,
        _expected_updated_at: data.expected_updated_at,
        _tipo: data.tipo,
        _categoria: data.categoria,
        _descrizione: data.descrizione,
        _sottocategoria: data.sottocategoria ?? null,
        _codice: data.codice ?? null,
        _unita: data.unita_misura ?? null,
        _quantita: data.quantita ?? null,
        _prezzo_unitario: data.prezzo_unitario ?? null,
        _importo_previsto: data.importo_previsto,
        _importo_impegnato: data.importo_impegnato,
        _importo_sostenuto: data.tipo === "ricavo" ? 0 : data.importo_sostenuto,
        _costo_residuo: data.tipo === "ricavo" ? 0 : data.costo_residuo_stimato,
        _cantiere_id: data.cantiere_id ?? null,
        _fase_id: data.fase_id ?? null,
        _fornitore_id: data.fornitore_id ?? null,
        _note: data.note ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return { id: row?.id as string, updated_at: row?.updated_at as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────────────────────
const updateVoceSchema = z.object({
  id: uuid,
  expected_updated_at: iso,
  categoria: z.string().min(1).optional(),
  descrizione: z.string().trim().min(1).max(1000).optional(),
  sottocategoria: z.string().max(200).nullable().optional(),
  codice: z.string().max(100).nullable().optional(),
  unita_misura: z.string().max(20).nullable().optional(),
  quantita: numOptNull,
  prezzo_unitario: numOptNull,
  importo_previsto: num0.optional(),
  importo_impegnato: num0.optional(),
  importo_sostenuto: num0.optional(),
  costo_residuo_stimato: num0.optional(),
  cantiere_id: uuid.nullable().optional(),
  fase_id: uuid.nullable().optional(),
  fornitore_id: uuid.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const updateCommessaBudgetVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateVoceSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await (context.supabase.rpc as any)("update_commessa_budget_voce", {
        _voce_id: data.id,
        _expected_updated_at: data.expected_updated_at,
        _categoria: data.categoria ?? null,
        _descrizione: data.descrizione ?? null,
        _sottocategoria: data.sottocategoria ?? null,
        _codice: data.codice ?? null,
        _unita: data.unita_misura ?? null,
        _quantita: data.quantita ?? null,
        _prezzo_unitario: data.prezzo_unitario ?? null,
        _importo_previsto: data.importo_previsto ?? null,
        _importo_impegnato: data.importo_impegnato ?? null,
        _importo_sostenuto: data.importo_sostenuto ?? null,
        _costo_residuo: data.costo_residuo_stimato ?? null,
        _cantiere_id: data.cantiere_id ?? null,
        _fase_id: data.fase_id ?? null,
        _fornitore_id: data.fornitore_id ?? null,
        _note: data.note ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return { id: row?.id as string, updated_at: row?.updated_at as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVE / RESTORE
// ─────────────────────────────────────────────────────────────────────────────
export const archiveCommessaBudgetVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: uuid, expected_updated_at: iso,
      motivazione: z.string().trim().max(500).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await (context.supabase.rpc as any)("archive_commessa_budget_voce", {
        _voce_id: data.id,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return { id: row?.id as string, updated_at: row?.updated_at as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const restoreCommessaBudgetVoce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: uuid, expected_updated_at: iso }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await (context.supabase.rpc as any)("restore_commessa_budget_voce", {
        _voce_id: data.id,
        _expected_updated_at: data.expected_updated_at,
      });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return { id: row?.id as string, updated_at: row?.updated_at as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// REORDER
// ─────────────────────────────────────────────────────────────────────────────
export const reorderCommessaBudgetVoci = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ commessa_id: uuid, expected_updated_at: iso, order: z.array(uuid).min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { error } = await (context.supabase.rpc as any)("reorder_commessa_budget_voci", {
        _commessa_id: data.commessa_id,
        _expected_updated_at: data.expected_updated_at,
        _ordered_ids: data.order,
      });
      if (error) throw error;
      return { ok: true as const };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT PREVENTIVO
// ─────────────────────────────────────────────────────────────────────────────
export const importBudgetFromPreventivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      commessa_id: uuid,
      expected_updated_at: iso,
      strategy: z.enum(["init_if_empty", "add_missing"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await (context.supabase.rpc as any)("import_budget_from_preventivo", {
        _commessa_id: data.commessa_id,
        _expected_updated_at: data.expected_updated_at,
        _strategy: data.strategy,
      });
      if (error) throw error;
      return res as {
        ricavi_creati: number;
        costi_creati: number;
        ricavi_ignorati: number;
        costi_ignorati: number;
        ignorati?: number;
        senza_costo: number;
        commessa_updated_at: string;
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// MODALITÀ BUDGET
// ─────────────────────────────────────────────────────────────────────────────
export const setCommessaBudgetMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      commessa_id: uuid,
      mode: z.enum(["manuale", "analitico"]),
      expected_updated_at: iso,
      motivazione: z.string().trim().max(500).nullable().optional(),
      confirm_empty: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await (context.supabase.rpc as any)("set_commessa_budget_mode", {
        _commessa_id: data.commessa_id,
        _mode: data.mode,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione ?? null,
        _confirm_empty: data.confirm_empty ?? false,
      });
      if (error) throw error;
      return { updated_at: newUpd as unknown as string, mode: data.mode };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE MANUALE
// ─────────────────────────────────────────────────────────────────────────────
const manualSchema = z.object({
  commessa_id: uuid,
  expected_updated_at: iso,
  ricavi_previsti: num0,
  ricavi_acquisiti: num0.nullable().optional(),
  extra_approvati: num0,
  extra_non_approvati: num0,
  costi_previsti: num0,
  costi_impegnati: num0,
  costi_sostenuti: num0,
  costi_residui_stimati: num0,
  motivazione: z.string().trim().max(500).nullable().optional(),
});
export const updateManualCommessaBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => manualSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await (context.supabase.rpc as any)("update_manual_commessa_budget", {
        _commessa_id: data.commessa_id,
        _expected_updated_at: data.expected_updated_at,
        _ricavi_previsti: data.ricavi_previsti,
        _ricavi_acquisiti: data.ricavi_acquisiti ?? null,
        _extra_approvati: data.extra_approvati,
        _extra_non_approvati: data.extra_non_approvati,
        _costi_previsti: data.costi_previsti,
        _costi_impegnati: data.costi_impegnati,
        _costi_sostenuti: data.costi_sostenuti,
        _costi_residui_stimati: data.costi_residui_stimati,
        _motivazione: data.motivazione ?? null,
      });
      if (error) throw error;
      return { updated_at: newUpd as unknown as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// BASELINE
// ─────────────────────────────────────────────────────────────────────────────
export const setCommessaBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      commessa_id: uuid,
      expected_updated_at: iso,
      motivazione: z.string().trim().min(1).max(500),
      replace: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await (context.supabase.rpc as any)("set_commessa_baseline", {
        _commessa_id: data.commessa_id,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione,
        _replace: data.replace ?? false,
      });
      if (error) throw error;
      return { updated_at: newUpd as unknown as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP: categorie, cantieri/fasi, fornitori
// ─────────────────────────────────────────────────────────────────────────────
export const listBudgetCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ costo: COSTO_CAT, ricavo: RICAVO_CAT }));

export const listBudgetAssignableCantieriFasi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const orgId = await currentOrgId(context);
      const [{ data: cants }, { data: fasi }] = await Promise.all([
        context.supabase.from("cantieri").select("id, codice, nome, archived_at")
          .eq("commessa_id", data.commessa_id).eq("organization_id", orgId)
          .is("archived_at", null).order("codice"),
        context.supabase.from("commessa_fasi").select("id, titolo, archived_at, stato")
          .eq("commessa_id", data.commessa_id).eq("organization_id", orgId)
          .is("archived_at", null).order("posizione"),
      ]);
      return {
        cantieri: (cants ?? []).map((c: any) => ({ id: c.id, label: c.codice ? `${c.codice} — ${c.nome ?? ""}` : (c.nome ?? "Cantiere") })),
        fasi: (fasi ?? []).filter((f: any) => f.stato !== "annullata").map((f: any) => ({ id: f.id, label: f.titolo })),
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const listBudgetFornitori = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const orgId = await currentOrgId(context);
      const { data, error } = await context.supabase
        .from("fornitori")
        .select("id, ragione_sociale")
        .eq("organization_id", orgId)
        .order("ragione_sociale");
      if (error) throw error;
      return (data ?? []).map((f: any) => ({ id: f.id, label: f.ragione_sociale ?? "Fornitore" }));
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// PREVENTIVO INFO (per dialog import)
// ─────────────────────────────────────────────────────────────────────────────
export const getBudgetPreventivoInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const orgId = await currentOrgId(context);
      const { data: c, error } = await context.supabase
        .from("commesse")
        .select("preventivo_id")
        .eq("id", data.commessa_id).eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      if (!c?.preventivo_id) return null;
      const { data: p } = await context.supabase
        .from("preventivi")
        .select("id, numero, versione, stato, totale, totale_ricavo, totale_costo")
        .eq("id", c.preventivo_id).eq("organization_id", orgId)
        .maybeSingle();
      if (!p) return null;
      const { count: nVoci } = await context.supabase
        .from("preventivo_voci")
        .select("id", { count: "exact", head: true })
        .eq("preventivo_id", p.id).eq("organization_id", orgId);
      return { ...p, numero_voci: nVoci ?? 0 };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
