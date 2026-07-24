import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";

/**
 * Blocco 5.1b — Server functions delle FASI DI COMMESSA.
 *
 * Regole:
 * - Tutte le mutazioni passano ESCLUSIVAMENTE tramite RPC SECURITY DEFINER lato DB.
 *   Non c'è più NESSUN INSERT/UPDATE/DELETE diretto su `commessa_fasi` da qui.
 * - `organization_id` NON viene mai accettato dal client: è derivato server-side
 *   dal profilo dell'utente autenticato o dalla RPC stessa.
 * - Optimistic locking obbligatorio (`expected_updated_at`) su tutte le mutazioni
 *   di record esistenti.
 * - Motivazione richiesta per: riapertura da completata, annullamento, riduzione
 *   avanzamento, archiviazione di fasi in corso/completate, cambio modalità
 *   avanzamento con perdita di dati.
 * - Errori mappati con `mapServerError` per non esporre dettagli SQL.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

const iso = z.string().min(1, "expectedUpdatedAt obbligatorio");
const uuid = z.string().uuid();

// ─────────────────────────────────────────────────────────────────────────────
// LIST (lettura: usa RLS/SELECT diretto — nessuna mutazione)
// ─────────────────────────────────────────────────────────────────────────────
export const listCommessaFasi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { commessa_id: string; includeArchived?: boolean }) =>
    z.object({ commessa_id: uuid, includeArchived: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    try {
      const organizationId = await currentOrgId(context);
      let q = context.supabase
        .from("commessa_fasi")
        .select("*")
        .eq("commessa_id", data.commessa_id)
        .eq("organization_id", organizationId)
        .order("posizione", { ascending: true })
        .order("created_at", { ascending: true });
      if (!data.includeArchived) q = q.is("archived_at", null);
      const { data: rows, error } = await q;
      if (error) throw error;

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
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
const createSchema = z.object({
  commessa_id: uuid,
  titolo: z.string().trim().min(1).max(200),
  descrizione: z.string().max(2000).nullable().optional(),
  cantiere_id: uuid.nullable().optional(),
  responsabile_id: uuid.nullable().optional(),
  peso_percentuale: z.number().min(0).max(100).optional(),
  data_inizio_prevista: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});

export const createCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.data_inizio_prevista && data.data_fine_prevista &&
        data.data_fine_prevista < data.data_inizio_prevista) {
      throw new Error("La data di fine prevista non può essere antecedente alla data di inizio prevista");
    }
    try {
      const { data: res, error } = await context.supabase.rpc("create_commessa_fase", {
        _commessa_id: data.commessa_id,
        _titolo: data.titolo,
        _descrizione: data.descrizione ?? null,
        _cantiere_id: data.cantiere_id ?? null,
        _responsabile_id: data.responsabile_id ?? null,
        _peso_percentuale: data.peso_percentuale ?? 0,
        _data_inizio_prevista: data.data_inizio_prevista ?? null,
        _data_fine_prevista: data.data_fine_prevista ?? null,
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
// UPDATE — solo campi anagrafici/pianificazione; NO stato/avanzamento qui
// ─────────────────────────────────────────────────────────────────────────────
const updateSchema = z.object({
  id: uuid,
  expected_updated_at: iso,
  titolo: z.string().trim().min(1).max(200).optional(),
  descrizione: z.string().max(2000).nullable().optional(),
  cantiere_id: uuid.nullable().optional(),
  responsabile_id: uuid.nullable().optional(),
  peso_percentuale: z.number().min(0).max(100).optional(),
  data_inizio_prevista: z.string().nullable().optional(),
  data_fine_prevista: z.string().nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});

export const updateCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.data_inizio_prevista && data.data_fine_prevista &&
        data.data_fine_prevista < data.data_inizio_prevista) {
      throw new Error("La data di fine prevista non può essere antecedente alla data di inizio prevista");
    }
    try {
      const { data: res, error } = await context.supabase.rpc("update_commessa_fase", {
        _id: data.id,
        _expected_updated_at: data.expected_updated_at,
        _titolo: data.titolo ?? null,
        _descrizione: data.descrizione === undefined ? null : data.descrizione,
        _cantiere_id: data.cantiere_id ?? null,
        _clear_cantiere: data.cantiere_id === null,
        _responsabile_id: data.responsabile_id ?? null,
        _clear_responsabile: data.responsabile_id === null,
        _peso_percentuale: data.peso_percentuale ?? null,
        _data_inizio_prevista: data.data_inizio_prevista ?? null,
        _clear_data_inizio_prevista: data.data_inizio_prevista === null,
        _data_fine_prevista: data.data_fine_prevista ?? null,
        _clear_data_fine_prevista: data.data_fine_prevista === null,
        _note: data.note ?? null,
        _clear_note: data.note === null,
      });
      if (error) throw error;
      return { id: data.id, updated_at: res as unknown as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// AVANZAMENTO FASE
// ─────────────────────────────────────────────────────────────────────────────
const avanzSchema = z.object({
  id: uuid,
  expected_updated_at: iso,
  avanzamento_percentuale: z.number().min(0).max(100),
  motivazione: z.string().trim().max(500).optional().nullable(),
});
export const updateFaseAvanzamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => avanzSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await context.supabase.rpc("update_fase_avanzamento", {
        _fase_id: data.id,
        _nuovo_avanzamento: data.avanzamento_percentuale,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione ?? null,
      });
      if (error) throw error;
      return { id: data.id, updated_at: newUpd as unknown as string, avanzamento: data.avanzamento_percentuale };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CAMBIO STATO FASE
// ─────────────────────────────────────────────────────────────────────────────
const STATI = ["non_iniziata", "in_corso", "sospesa", "completata", "annullata"] as const;
const stateSchema = z.object({
  id: uuid,
  expected_updated_at: iso,
  stato: z.enum(STATI),
  motivazione: z.string().trim().max(500).optional().nullable(),
});
export const changeFaseStato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => stateSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await context.supabase.rpc("change_fase_stato", {
        _fase_id: data.id,
        _nuovo_stato: data.stato,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione ?? null,
      });
      if (error) throw error;
      return { id: data.id, updated_at: newUpd as unknown as string, stato: data.stato };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVE / RESTORE
// ─────────────────────────────────────────────────────────────────────────────
const archiveSchema = z.object({
  id: uuid,
  expected_updated_at: iso,
  motivazione: z.string().trim().max(500).optional().nullable(),
});
export const archiveCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => archiveSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await context.supabase.rpc("archive_commessa_fase", {
        _id: data.id,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione ?? null,
      });
      if (error) throw error;
      return { id: data.id, updated_at: newUpd as unknown as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const restoreSchema = z.object({ id: uuid, expected_updated_at: iso });
export const restoreCommessaFase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => restoreSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await context.supabase.rpc("restore_commessa_fase", {
        _id: data.id,
        _expected_updated_at: data.expected_updated_at,
      });
      if (error) throw error;
      return { id: data.id, updated_at: newUpd as unknown as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// RIORDINO
// ─────────────────────────────────────────────────────────────────────────────
const reorderSchema = z.object({
  commessa_id: uuid,
  order: z.array(uuid).min(1),
});
export const reorderCommessaFasi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reorderSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { error } = await context.supabase.rpc("reorder_commessa_fasi", {
        _commessa_id: data.commessa_id,
        _ordered_ids: data.order,
      });
      if (error) throw error;
      return { ok: true as const };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// DISTRIBUZIONE PESI
// ─────────────────────────────────────────────────────────────────────────────
export const distribuisciPesiEqualmente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: peso, error } = await context.supabase.rpc("distribuisci_pesi_equamente", {
        _commessa_id: data.commessa_id,
      });
      if (error) throw error;
      return { ok: true as const, peso: Number(peso ?? 0) };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// MODALITÀ AVANZAMENTO COMMESSA (RPC-only)
// ─────────────────────────────────────────────────────────────────────────────
const modalitaSchema = z.object({
  commessa_id: uuid,
  modalita: z.enum(["manuale", "fasi"]),
  expected_updated_at: iso,
  motivazione: z.string().trim().max(500).optional().nullable(),
  conferma_peso_zero: z.boolean().optional(),
});
export const setCommessaAvanzamentoModalita = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => modalitaSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: newUpd, error } = await context.supabase.rpc("set_commessa_progress_mode", {
        _commessa_id: data.commessa_id,
        _modalita: data.modalita,
        _expected_updated_at: data.expected_updated_at,
        _motivazione: data.motivazione ?? null,
        _conferma_peso_zero: data.conferma_peso_zero ?? false,
      });
      if (error) throw error;
      return { ok: true as const, modalita: data.modalita, updated_at: newUpd as unknown as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
