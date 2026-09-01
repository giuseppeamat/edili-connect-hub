import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";

/**
 * Sprint 5 — Blocco 1
 * Server functions RAPPORTINI. Tutte le mutazioni passano dalle RPC
 * SECURITY DEFINER; le letture usano SELECT diretto sotto RLS.
 * `organization_id` non è mai accettato dal client.
 */

const uuid = z.string().uuid();
const iso = z.string().min(1, "expected_updated_at obbligatorio");

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
// Helpers di enrichment (utente, commessa, cantiere, fase)
// ─────────────────────────────────────────────────────────────────────────────
async function enrichRapportini(context: any, rows: any[]) {
  if (!rows?.length) return [];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
  const commIds = Array.from(new Set(rows.map((r) => r.commessa_id).filter(Boolean)));
  const cantIds = Array.from(new Set(rows.map((r) => r.cantiere_id).filter(Boolean)));
  const faseIds = Array.from(new Set(rows.map((r) => r.fase_id).filter(Boolean)));
  const rapIds = rows.map((r) => r.id).filter(Boolean);
  const [{ data: profs }, { data: comms }, { data: cants }, { data: fasi }, { data: pers }] = await Promise.all([
    userIds.length
      ? context.supabase.from("profiles").select("id, nome, cognome, email").in("id", userIds)
      : Promise.resolve({ data: [] as any[] }),
    commIds.length
      ? context.supabase.from("commesse").select("id, codice, denominazione").in("id", commIds)
      : Promise.resolve({ data: [] as any[] }),
    cantIds.length
      ? context.supabase.from("cantieri").select("id, codice, nome").in("id", cantIds)
      : Promise.resolve({ data: [] as any[] }),
    faseIds.length
      ? context.supabase.from("commessa_fasi").select("id, titolo").in("id", faseIds)
      : Promise.resolve({ data: [] as any[] }),
    Promise.resolve({ data: [] as any[] }),
  ]);
  // Le righe personale non sono leggibili in SELECT diretto (policy `false`):
  // l'aggregato serve solo a contare persone e ore massime sui rapportini
  // già filtrati da RLS, quindi si legge con il client server privilegiato.
  let pers: any[] = [];
  if (rapIds.length) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("rapportini_personale")
      .select("rapportino_id, ore")
      .in("rapportino_id", rapIds)
      .is("annullato_at", null);
    pers = (data ?? []) as any[];
  }
  const pm = new Map((profs ?? []).map((p: any) => [p.id, p]));
  const cm = new Map((comms ?? []).map((c: any) => [c.id, c]));
  const km = new Map((cants ?? []).map((k: any) => [k.id, k]));
  const fm = new Map((fasi ?? []).map((f: any) => [f.id, f]));
  // Aggregato personale: serve per valutare le ore per singola persona (anomalie)
  const perRap = new Map<string, { persone: number; ore_max: number }>();
  for (const p of (pers ?? []) as any[]) {
    const cur = perRap.get(p.rapportino_id) ?? { persone: 0, ore_max: 0 };
    cur.persone += 1;
    cur.ore_max = Math.max(cur.ore_max, Number(p.ore ?? 0));
    perRap.set(p.rapportino_id, cur);
  }
  return rows.map((r) => ({
    ...r,
    user: r.user_id ? pm.get(r.user_id) ?? null : null,
    commessa: r.commessa_id ? cm.get(r.commessa_id) ?? null : null,
    cantiere: r.cantiere_id ? km.get(r.cantiere_id) ?? null : null,
    fase: r.fase_id ? fm.get(r.fase_id) ?? null : null,
    persone: perRap.get(r.id)?.persone ?? 0,
    ore_max_persona: perRap.get(r.id)?.ore_max ?? null,
  }));
}


// ─────────────────────────────────────────────────────────────────────────────
// LIST (RLS: filtro applicato dal DB)
// ─────────────────────────────────────────────────────────────────────────────
const listFiltersSchema = z.object({
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  commessa_id: uuid.nullable().optional(),
  cantiere_id: uuid.nullable().optional(),
  fase_id: uuid.nullable().optional(),
  user_id: uuid.nullable().optional(),
  stato: z.string().nullable().optional(),
  includeArchived: z.boolean().nullable().optional(),
});

export const listRapportini = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listFiltersSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    try {
      const org = await currentOrgId(context);
      let q = context.supabase
        .from("rapportini")
        .select("*")
        .eq("organization_id", org)
        .order("data", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (!data.includeArchived) q = q.is("archived_at", null);
      if (data.from) q = q.gte("data", data.from);
      if (data.to) q = q.lte("data", data.to);
      if (data.commessa_id) q = q.eq("commessa_id", data.commessa_id);
      if (data.cantiere_id) q = q.eq("cantiere_id", data.cantiere_id);
      if (data.fase_id) q = q.eq("fase_id", data.fase_id);
      if (data.user_id) q = q.eq("user_id", data.user_id);
      if (data.stato) q = q.eq("stato", data.stato);
      const { data: rows, error } = await q;
      if (error) throw error;
      return await enrichRapportini(context, rows ?? []);
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const listCommessaRapportini = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      commessa_id: uuid,
      includeArchived: z.boolean().optional(),
      stato: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const org = await currentOrgId(context);
      let q = context.supabase
        .from("rapportini")
        .select("*")
        .eq("organization_id", org)
        .eq("commessa_id", data.commessa_id)
        .order("data", { ascending: false })
        .limit(200);
      if (!data.includeArchived) q = q.is("archived_at", null);
      if (data.stato) q = q.eq("stato", data.stato);
      const { data: rows, error } = await q;
      if (error) throw error;
      return await enrichRapportini(context, rows ?? []);
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const org = await currentOrgId(context);
      const { data: row, error } = await context.supabase
        .from("rapportini").select("*")
        .eq("organization_id", org).eq("id", data.id).maybeSingle();
      if (error) throw error;
      if (!row) throw new Error("Rapportino non trovato");
      const [enriched] = await enrichRapportini(context, [row]);
      return enriched;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Assignable dropdowns
// ─────────────────────────────────────────────────────────────────────────────
export const listRapportinoAssignableCommesse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const org = await currentOrgId(context);
      // RLS filtra ulteriormente in base al ruolo
      const { data, error } = await context.supabase
        .from("commesse")
        .select("id, codice, denominazione, closed_at, archived_at, stato")
        .eq("organization_id", org)
        .is("archived_at", null)
        .is("closed_at", null)
        .order("codice", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).filter((c: any) => c.stato !== "annullata");
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const listRapportinoAssignableCantieri = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const org = await currentOrgId(context);
      const { data: rows, error } = await context.supabase
        .from("cantieri")
        .select("id, codice, nome, stato")
        .eq("organization_id", org)
        .eq("commessa_id", data.commessa_id)
        .is("archived_at", null)
        .order("codice", { ascending: true });
      if (error) throw error;
      return rows ?? [];
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const listRapportinoAssignableFasi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ commessa_id: uuid, cantiere_id: uuid.nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const org = await currentOrgId(context);
      let q = context.supabase
        .from("commessa_fasi")
        .select("id, titolo, cantiere_id, stato")
        .eq("organization_id", org)
        .eq("commessa_id", data.commessa_id)
        .is("archived_at", null)
        .order("posizione", { ascending: true });
      const { data: rows, error } = await q;
      if (error) throw error;
      // Se cantiere selezionato, escludi fasi legate a un cantiere diverso
      return (rows ?? []).filter((f: any) =>
        !data.cantiere_id || f.cantiere_id === null || f.cantiere_id === data.cantiere_id,
      );
    } catch (e) { throw new Error(mapServerError(e)); }
  });

// ─────────────────────────────────────────────────────────────────────────────
// MUTAZIONI (RPC SECURITY DEFINER)
// ─────────────────────────────────────────────────────────────────────────────
const OPERATIONAL_HOUR_LIMIT = 16;
/** Le ore di testata sono la somma delle persone impiegate: il limite per persona resta 16h. */
const MAX_ORE_TESTATA = 240;

const createSchema = z.object({
  commessa_id: uuid,
  user_id: uuid,
  data: z.string().min(10),
  ore: z.number().positive().max(MAX_ORE_TESTATA),
  descrizione_lavori: z.string().trim().min(1, "Descrizione lavori obbligatoria").max(2000),
  cantiere_id: uuid.nullable().optional(),
  fase_id: uuid.nullable().optional(),
  ora_inizio: z.string().nullable().optional(),
  ora_fine: z.string().nullable().optional(),
  pausa_minuti: z.number().int().min(0).max(24 * 60).optional(),
  note: z.string().max(4000).nullable().optional(),
  foto_urls: z.array(z.string()).nullable().optional(),
  override_ore: z.boolean().optional(),
  override_motivo: z.string().nullable().optional(),
  /** Numero di persone impiegate: usato solo per validare le ore medie per persona. */
  persone: z.number().int().positive().optional(),
}).superRefine((v, ctx) => {
  if (v.ora_inizio && v.ora_fine && v.ora_fine < v.ora_inizio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ora fine antecedente all'ora inizio", path: ["ora_fine"] });
  }
  // limite operativo per persona: massimo 16h; oltre serve override esplicito
  const orePersona = v.ore / Math.max(1, v.persone ?? 1);
  if (orePersona > OPERATIONAL_HOUR_LIMIT && !v.override_ore) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Ore oltre il limite operativo di ${OPERATIONAL_HOUR_LIMIT} per persona: richiedi un override amministratore.`, path: ["ore"] });
  }
  if (orePersona > OPERATIONAL_HOUR_LIMIT && v.override_ore && !v.override_motivo?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Motivazione override obbligatoria", path: ["override_motivo"] });
  }
  // data futura: max domani (data server-side ricontrollata dalla RPC)
  const max = new Date();
  max.setDate(max.getDate() + 1);
  const maxIso = max.toISOString().slice(0, 10);
  if (v.data > maxIso) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Data futura oltre il limite consentito (max domani)", path: ["data"] });
  }
});


export const createRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      // sanity: authenticated org fetch (per errori chiari precoci)
      await currentOrgId(context);
      const { data: res, error } = await context.supabase.rpc("create_rapportino" as any, {
        _commessa_id: data.commessa_id,
        _user_id: data.user_id,
        _data: data.data,
        _ore: data.ore,
        _descrizione_lavori: data.descrizione_lavori,
        _cantiere_id: data.cantiere_id ?? null,
        _fase_id: data.fase_id ?? null,
        _ora_inizio: data.ora_inizio ?? null,
        _ora_fine: data.ora_fine ?? null,
        _pausa_minuti: data.pausa_minuti ?? 0,
        _note: data.note ?? null,
        _foto_urls: data.foto_urls ?? null,
        _override_ore: data.override_ore ?? false,
        _override_motivo: data.override_motivo ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      if (!row?.id) throw new Error("Creazione fallita: nessun ID restituito");
      return { id: row.id as string, updated_at: row.updated_at as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const updateSchema = z.object({
  id: uuid,
  expected_updated_at: iso,
  cantiere_id: uuid.nullable().optional(),
  clear_cantiere: z.boolean().optional(),
  fase_id: uuid.nullable().optional(),
  clear_fase: z.boolean().optional(),
  data: z.string().nullable().optional(),
  ora_inizio: z.string().nullable().optional(),
  clear_ora_inizio: z.boolean().optional(),
  ora_fine: z.string().nullable().optional(),
  clear_ora_fine: z.boolean().optional(),
  pausa_minuti: z.number().int().min(0).max(24 * 60).nullable().optional(),
  ore: z.number().positive().max(MAX_ORE_TESTATA).nullable().optional(),
  descrizione_lavori: z.string().max(2000).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
  clear_note: z.boolean().optional(),
  override_ore: z.boolean().optional(),
  override_motivo: z.string().nullable().optional(),
});

export const updateRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      await currentOrgId(context);
      const { data: newUpd, error } = await context.supabase.rpc("update_rapportino" as any, {
        _id: data.id,
        _expected_updated_at: data.expected_updated_at,
        _cantiere_id: data.cantiere_id ?? null,
        _clear_cantiere: !!data.clear_cantiere,
        _fase_id: data.fase_id ?? null,
        _clear_fase: !!data.clear_fase,
        _data: data.data ?? null,
        _ora_inizio: data.ora_inizio ?? null,
        _clear_ora_inizio: !!data.clear_ora_inizio,
        _ora_fine: data.ora_fine ?? null,
        _clear_ora_fine: !!data.clear_ora_fine,
        _pausa_minuti: data.pausa_minuti ?? null,
        _ore: data.ore ?? null,
        _descrizione_lavori: data.descrizione_lavori ?? null,
        _note: data.note ?? null,
        _clear_note: !!data.clear_note,
        _override_ore: !!data.override_ore,
        _override_motivo: data.override_motivo ?? null,
      });
      if (error) throw error;
      return { updated_at: newUpd as string };
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const archiveRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: uuid,
      expected_updated_at: iso,
      motivazione: z.string().trim().min(1, "Motivazione obbligatoria").max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      await currentOrgId(context);
      const { data: newUpd, error } = await context.supabase.rpc("archive_rapportino" as any, {
        _id: data.id,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione,
      });
      if (error) throw error;
      return { updated_at: newUpd as string };
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const restoreRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: uuid, expected_updated_at: iso }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      await currentOrgId(context);
      const { data: newUpd, error } = await context.supabase.rpc("restore_rapportino" as any, {
        _id: data.id,
        _expected_updated_at: data.expected_updated_at,
      });
      if (error) throw error;
      return { updated_at: newUpd as string };
    } catch (e) { throw new Error(mapServerError(e)); }
  });

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW (Sprint 5 · Blocco 2)
// ─────────────────────────────────────────────────────────────────────────────
const idAndExpected = z.object({ id: uuid, expected_updated_at: iso });
const idExpectedReason = idAndExpected.extend({
  reason: z.string().trim().min(5, "Motivazione: minimo 5 caratteri").max(1000),
});

type WorkflowResult = {
  id: string;
  stato: string;
  updated_at: string;
  transition_at: string | null;
  transition_by: string | null;
};

async function callWorkflowRpc(context: any, fn: string, args: Record<string, any>): Promise<WorkflowResult> {
  await currentOrgId(context);
  const { data, error } = await context.supabase.rpc(fn as any, args);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new Error("Operazione fallita");
  return {
    id: row.id,
    stato: row.stato,
    updated_at: row.updated_at,
    transition_at: row.transition_at ?? null,
    transition_by: row.transition_by ?? null,
  };
}

export const submitRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idAndExpected.parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await callWorkflowRpc(context, "submit_rapportino", {
        _id: data.id, _expected_updated_at: data.expected_updated_at,
      });
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const approveRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    idAndExpected.extend({ note: z.string().trim().max(1000).nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      return await callWorkflowRpc(context, "approve_rapportino", {
        _id: data.id, _expected_updated_at: data.expected_updated_at, _note: data.note ?? null,
      });
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const rejectRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idExpectedReason.parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await callWorkflowRpc(context, "reject_rapportino", {
        _id: data.id, _expected_updated_at: data.expected_updated_at, _reason: data.reason,
      });
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const reopenRejectedRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idAndExpected.parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await callWorkflowRpc(context, "reopen_rejected_rapportino", {
        _id: data.id, _expected_updated_at: data.expected_updated_at,
      });
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const cancelRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idExpectedReason.parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await callWorkflowRpc(context, "cancel_rapportino", {
        _id: data.id, _expected_updated_at: data.expected_updated_at, _reason: data.reason,
      });
    } catch (e) { throw new Error(mapServerError(e)); }
  });
