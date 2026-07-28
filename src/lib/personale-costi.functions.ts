/**
 * Sprint 5 · Blocco 3 — Server functions costi orari del personale
 * e contabilizzazione manodopera dei rapportini.
 * Tutte le mutazioni passano da RPC SECURITY DEFINER con optimistic locking.
 * organization_id non è mai accettato dal client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";

const uuid = z.string().uuid();
const iso = z.string().min(1, "expected_updated_at obbligatorio");

async function currentOrgAndRole(context: any) {
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("organization_id, is_active")
    .eq("id", context.userId)
    .maybeSingle();
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  if (prof.is_active === false) throw new Error("Utente disattivato");
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("organization_id", prof.organization_id);
  return {
    org: prof.organization_id as string,
    roles: (roles ?? []).map((r: any) => r.role as string),
  };
}

function assertCanManageCosti(roles: string[]) {
  const ok = roles.some((r) => ["proprietario", "amministratore", "amministrazione"].includes(r));
  if (!ok) throw new Error("Non sei autorizzato a gestire i costi orari");
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST tariffe
// ─────────────────────────────────────────────────────────────────────────────
export const listPersonaleCostiOrari = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      user_id: uuid.nullable().optional(),
      includeArchived: z.boolean().optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const { org, roles } = await currentOrgAndRole(context);
      assertCanManageCosti(roles);
      let q = context.supabase
        .from("personale_costi_orari")
        .select("*")
        .eq("organization_id", org)
        .order("valido_dal", { ascending: false })
        .limit(500);
      if (data.user_id) q = q.eq("user_id", data.user_id);
      if (!data.includeArchived) q = q.is("archived_at", null);
      const { data: rows, error } = await q;
      if (error) throw error;

      // enrich con profili
      const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
      const { data: profs } = userIds.length
        ? await context.supabase.from("profiles").select("id, nome, cognome, email").in("id", userIds)
        : { data: [] as any[] };
      const pm = new Map((profs ?? []).map((p: any) => [p.id, p]));
      return (rows ?? []).map((r: any) => ({ ...r, user: pm.get(r.user_id) ?? null }));
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// Elenco utenti gestibili (per select nel form)
export const listUtentiGestibiliCostoOrario = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { org, roles } = await currentOrgAndRole(context);
      assertCanManageCosti(roles);
      const { data, error } = await context.supabase
        .from("profiles")
        .select("id, nome, cognome, email, is_active")
        .eq("organization_id", org)
        .order("cognome", { ascending: true });
      if (error) throw error;
      return data ?? [];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getPersonaleCostoAttuale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: uuid, data: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { org, roles } = await currentOrgAndRole(context);
      assertCanManageCosti(roles);
      const at = data.data ?? new Date().toISOString().slice(0, 10);
      const { data: row, error } = await context.supabase.rpc(
        "get_personale_costo_orario_at_date" as any,
        { _user_id: data.user_id, _org: org, _data: at },
      );
      if (error) throw error;
      return Array.isArray(row) ? row[0] ?? null : row ?? null;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// MUTAZIONI TARIFFA
// ─────────────────────────────────────────────────────────────────────────────
const createSchema = z.object({
  user_id: uuid,
  costo_orario: z.number().min(0).max(10000),
  valido_dal: z.string().min(10),
  valido_al: z.string().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

export const createPersonaleCostoOrario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("create_personale_costo_orario" as any, {
        _user_id: data.user_id,
        _costo_orario: data.costo_orario,
        _valido_dal: data.valido_dal,
        _valido_al: data.valido_al ?? null,
        _note: data.note ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return { id: row.id as string, updated_at: row.updated_at as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const updateSchema = z.object({
  id: uuid,
  expected_updated_at: iso,
  costo_orario: z.number().min(0).max(10000),
  valido_dal: z.string().min(10),
  valido_al: z.string().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

export const updatePersonaleCostoOrario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: upd, error } = await context.supabase.rpc("update_personale_costo_orario" as any, {
        _id: data.id,
        _expected_updated_at: data.expected_updated_at,
        _costo_orario: data.costo_orario,
        _valido_dal: data.valido_dal,
        _valido_al: data.valido_al ?? null,
        _note: data.note ?? null,
      });
      if (error) throw error;
      return { updated_at: upd as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const archivePersonaleCostoOrario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, expected_updated_at: iso }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: upd, error } = await context.supabase.rpc("archive_personale_costo_orario" as any, {
        _id: data.id, _expected_updated_at: data.expected_updated_at,
      });
      if (error) throw error;
      return { updated_at: upd as string };
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const restorePersonaleCostoOrario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, expected_updated_at: iso }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: upd, error } = await context.supabase.rpc("restore_personale_costo_orario" as any, {
        _id: data.id, _expected_updated_at: data.expected_updated_at,
      });
      if (error) throw error;
      return { updated_at: upd as string };
    } catch (e) { throw new Error(mapServerError(e)); }
  });

// ─────────────────────────────────────────────────────────────────────────────
// CONTABILIZZAZIONI
// ─────────────────────────────────────────────────────────────────────────────
export const listRapportiniCostiPendenti = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { org, roles } = await currentOrgAndRole(context);
      assertCanManageCosti(roles);
      // Rapportini approvati senza contabilizzazione attiva o con non_contabilizzato
      const { data: rap, error } = await context.supabase
        .from("rapportini")
        .select("id, data, ore, user_id, commessa_id, cantiere_id, fase_id, updated_at, approved_at")
        .eq("organization_id", org)
        .eq("stato", "approvato")
        .is("archived_at", null)
        .order("data", { ascending: false })
        .limit(500);
      if (error) throw error;
      const ids = (rap ?? []).map((r: any) => r.id);
      if (!ids.length) return [];
      // Lettura rapportini_costi via supabaseAdmin: la tabella non è accessibile
      // direttamente al ruolo authenticated (hardening Blocco 3.4). Il gate di
      // ruolo è già stato applicato sopra via assertCanManageCosti().
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: costi } = await supabaseAdmin
        .from("rapportini_costi")
        .select("rapportino_id, stato, stornato_at")
        .eq("organization_id", org)
        .in("rapportino_id", ids);
      const contMap = new Map<string, string>();
      (costi ?? []).forEach((c: any) => {
        if (c.stato === "contabilizzato" && !c.stornato_at) contMap.set(c.rapportino_id, "contabilizzato");
        else if (c.stato === "non_contabilizzato" && !contMap.has(c.rapportino_id)) contMap.set(c.rapportino_id, "non_contabilizzato");
      });
      return (rap ?? [])
        .filter((r: any) => contMap.get(r.id) !== "contabilizzato")
        .map((r: any) => ({ ...r, stato_contabilizzazione: contMap.get(r.id) ?? "assente" }));
    } catch (e) { throw new Error(mapServerError(e)); }
  });


export const contabilizzaRapportinoManodopera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc(
        "contabilizza_rapportino_manodopera" as any,
        { _rapportino_id: data.rapportino_id },
      );
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return {
        rapportino_costo_id: row?.rapportino_costo_id as string,
        stato: row?.stato as string,
        warning: (row?.warning ?? null) as string | null,
      };
    } catch (e) { throw new Error(mapServerError(e)); }
  });

export const contabilizzaRapportiniPendenti = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      user_id: uuid.nullable().optional(),
      commessa_id: uuid.nullable().optional(),
      date_from: z.string().nullable().optional(),
      date_to: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc(
        "contabilizza_rapportini_pendenti" as any,
        {
          _user_id: data.user_id ?? null,
          _commessa_id: data.commessa_id ?? null,
          _date_from: data.date_from ?? null,
          _date_to: data.date_to ?? null,
          _limit: data.limit ?? 100,
        },
      );
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return row ?? null;
    } catch (e) { throw new Error(mapServerError(e)); }
  });

// Costo di un singolo rapportino (card dettaglio) — visibile SOLO a
// proprietario/amministratore/amministrazione (Sprint 5 Blocco 3.4).
// Ufficio tecnico, responsabile commessa, capocantiere, operaio, cliente,
// fornitore: nessun accesso al dato individuale. Lettura via supabaseAdmin
// perché la tabella non è più accessibile direttamente al ruolo authenticated.
export const getRapportinoCosto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { org, roles } = await currentOrgAndRole(context);
      const admin = roles.some((r: string) =>
        ["proprietario", "amministratore", "amministrazione"].includes(r),
      );
      if (!admin) return null;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows, error } = await supabaseAdmin
        .from("rapportini_costi")
        .select("*")
        .eq("organization_id", org)
        .eq("rapportino_id", data.rapportino_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return rows ?? [];
    } catch (e) { throw new Error(mapServerError(e)); }
  });

