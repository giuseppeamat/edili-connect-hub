import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";
import { ECON_ROLES, hasAnyRole, resolveDashboardContext } from "@/lib/dashboard-authz";

/**
 * Subappaltatori: anagrafica (condivisa con i fornitori), contratti
 * e presenze giornaliere nel rapportino. Importi congelati al salvataggio.
 */

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();

async function orgId(context: any): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("organization_id, is_active")
    .eq("id", context.userId)
    .maybeSingle();
  if (!prof?.organization_id) throw new Error("Organizzazione non trovata");
  if (prof.is_active === false) throw new Error("Utente disattivato");
  return prof.organization_id as string;
}

/** Anagrafica soggetti: fornitori, subappaltatori o entrambi. */
export const listSoggetti = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ tipo: z.enum(["fornitore", "subappaltatore", "tutti"]).optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const org = await orgId(context);
      let q = context.supabase
        .from("fornitori")
        .select(
          "id, ragione_sociale, categoria, tipo_soggetto, specializzazioni, stato_qualifica, partita_iva, email, telefono, referente, citta, is_active, note_operative",
        )
        .eq("organization_id", org)
        .is("archived_at", null)
        .order("ragione_sociale", { ascending: true })
        .limit(1000);
      if (data.tipo === "fornitore") q = q.in("tipo_soggetto", ["fornitore", "entrambi"]);
      if (data.tipo === "subappaltatore") q = q.in("tipo_soggetto", ["subappaltatore", "entrambi"]);
      const { data: rows, error } = await q;
      if (error) throw error;
      return rows ?? [];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getRapportinoSubappalti = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("get_rapportino_subappalti" as any, {
        _rapportino_id: data.rapportino_id,
      });
      if (error) throw error;
      return (res ?? []) as any[];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const saveRapportinoSubappalto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rapportino_id: uuid,
        riga: z.object({
          id: nullableUuid,
          subappaltatore_id: uuid,
          contratto_id: nullableUuid,
          cantiere_id: nullableUuid,
          fase_id: nullableUuid,
          lavorazione: z.string().trim().min(1, "Lavorazione obbligatoria").max(300),
          descrizione: z.string().max(2000).nullable().optional(),
          quantita: z.number().positive().nullable().optional(),
          unita_misura: z.string().max(20).nullable().optional(),
          modalita_compenso: z.enum(["a_corpo", "a_giornata", "a_quantita", "a_sal", "a_ore_ditta", "altro"]),
          importo_unitario: z.number().min(0).nullable().optional(),
          importo_totale: z.number().min(0).nullable().optional(),
          iva_pct: z.number().min(0).max(100).nullable().optional(),
          ritenuta_pct: z.number().min(0).max(100).nullable().optional(),
          note: z.string().max(2000).nullable().optional(),
          documento_id: nullableUuid,
        }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const r = data.riga;
      const { data: res, error } = await context.supabase.rpc("save_rapportino_subappalto" as any, {
        _rapportino_id: data.rapportino_id,
        _riga: {
          id: r.id ?? null,
          subappaltatore_id: r.subappaltatore_id,
          contratto_id: r.contratto_id ?? null,
          cantiere_id: r.cantiere_id ?? null,
          fase_id: r.fase_id ?? null,
          lavorazione: r.lavorazione,
          descrizione: r.descrizione ?? null,
          quantita: r.quantita ?? null,
          unita_misura: r.unita_misura ?? null,
          modalita_compenso: r.modalita_compenso,
          importo_unitario: r.importo_unitario ?? null,
          importo_totale: r.importo_totale ?? null,
          iva_pct: r.iva_pct ?? null,
          ritenuta_pct: r.ritenuta_pct ?? null,
          note: r.note ?? null,
          documento_id: r.documento_id ?? null,
        },
      });
      if (error) throw error;
      return { id: res as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const annullaRapportinoSubappalto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: uuid, motivo: z.string().trim().min(3, "Motivazione obbligatoria").max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("annulla_rapportino_subappalto" as any, {
        _id: data.id,
        _motivo: data.motivo,
      });
      if (error) throw error;
      return { id: res as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Contratti di subappalto (solo ruoli economici, garantito da RLS)
// ─────────────────────────────────────────────────────────────────────────────
export const listContrattiSubappalto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        subappaltatore_id: nullableUuid,
        commessa_id: nullableUuid,
        stato: z.string().nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const org = await orgId(context);
      let q = context.supabase
        .from("subappalti_contratti")
        .select("*")
        .eq("organization_id", org)
        .order("data_inizio", { ascending: false })
        .limit(500);
      if (data.subappaltatore_id) q = q.eq("subappaltatore_id", data.subappaltatore_id);
      if (data.commessa_id) q = q.eq("commessa_id", data.commessa_id);
      if (data.stato) q = q.eq("stato", data.stato);
      const { data: rows, error } = await q;
      if (error) throw error;
      if (!rows?.length) return [];
      const subIds = Array.from(new Set(rows.map((r: any) => r.subappaltatore_id)));
      const commIds = Array.from(new Set(rows.map((r: any) => r.commessa_id)));
      const [{ data: subs }, { data: comms }] = await Promise.all([
        context.supabase.from("fornitori").select("id, ragione_sociale").in("id", subIds),
        context.supabase.from("commesse").select("id, codice, denominazione").in("id", commIds),
      ]);
      const sm = new Map((subs ?? []).map((s: any) => [s.id, s]));
      const cm = new Map((comms ?? []).map((c: any) => [c.id, c]));
      return rows.map((r: any) => ({
        ...r,
        subappaltatore: sm.get(r.subappaltatore_id) ?? null,
        commessa: cm.get(r.commessa_id) ?? null,
      }));
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const saveContrattoSubappalto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: nullableUuid,
        subappaltatore_id: uuid,
        commessa_id: uuid,
        cantiere_id: nullableUuid,
        oggetto: z.string().trim().min(1, "Oggetto obbligatorio").max(300),
        data_inizio: z.string().min(10, "Data inizio obbligatoria"),
        data_fine: z.string().nullable().optional(),
        importo_contratto: z.number().min(0),
        stato: z.enum(["bozza", "attivo", "sospeso", "completato", "chiuso", "annullato"]),
        note: z.string().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const org = await orgId(context);
      const payload = {
        subappaltatore_id: data.subappaltatore_id,
        commessa_id: data.commessa_id,
        cantiere_id: data.cantiere_id ?? null,
        oggetto: data.oggetto,
        data_inizio: data.data_inizio,
        data_fine: data.data_fine || null,
        importo_contratto: data.importo_contratto,
        stato: data.stato,
        note: data.note || null,
      };
      if (data.id) {
        const { error } = await context.supabase
          .from("subappalti_contratti")
          .update(payload)
          .eq("id", data.id)
          .eq("organization_id", org);
        if (error) throw error;
        return { id: data.id };
      }
      const { data: row, error } = await context.supabase
        .from("subappalti_contratti")
        .insert({ ...payload, organization_id: org, created_by: context.userId })
        .select("id")
        .single();
      if (error) throw error;
      return { id: row!.id as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getCommessaCostiExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commessa_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("get_commessa_costi_extra" as any, {
        _commessa_id: data.commessa_id,
      });
      if (error) throw error;
      return (res ?? { visibile: false }) as any;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

/* ─────────── Scheda soggetto (fornitore / subappaltatore) ───────────
 * Blocchi C ed E: contratti, bolle, storico prezzi e documenti della ditta.
 * Gli importi sono esposti solo ai ruoli economici.
 */

export const getSoggettoScheda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ fornitore_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { organizationId: org, roles } = await resolveDashboardContext(
        context.supabase,
        context.userId,
      );
      const canEcon = hasAnyRole(roles, ECON_ROLES);
      const fid = data.fornitore_id;

      const { data: sog, error: sogErr } = await context.supabase
        .from("fornitori")
        .select(
          "id, ragione_sociale, tipo_soggetto, specializzazioni, categoria, partita_iva, email, telefono, referente, citta, stato_qualifica, is_active, note_operative",
        )
        .eq("id", fid)
        .eq("organization_id", org)
        .maybeSingle();
      if (sogErr) throw sogErr;
      if (!sog) throw new Error("Soggetto non trovato");

      const [bolleQ, prezziQ, docQ, contrQ] = await Promise.all([
        context.supabase
          .from("rapportini_bolle")
          .select(
            "id, numero_bolla, data_bolla, stato, imponibile, totale, commessa_id, rapportino_id",
          )
          .eq("organization_id", org)
          .eq("fornitore_id", fid)
          .order("data_bolla", { ascending: false })
          .limit(100),
        context.supabase
          .from("materiali_prezzi_fornitori")
          .select(
            "id, data_prezzo, prezzo_unitario, unita_misura, descrizione, materiale_id, quantita_riferimento",
          )
          .eq("organization_id", org)
          .eq("fornitore_id", fid)
          .order("data_prezzo", { ascending: false })
          .limit(100),
        context.supabase
          .from("documenti")
          .select("id, nome, categoria, data_scadenza, stato, is_versione_corrente")
          .eq("organization_id", org)
          .or(`fornitore_id.eq.${fid},subappaltatore_id.eq.${fid}`)
          .is("archived_at", null)
          .eq("is_versione_corrente", true)
          .order("data_scadenza", { ascending: true, nullsFirst: false })
          .limit(100),
        context.supabase
          .from("subappalti_contratti")
          .select("*")
          .eq("organization_id", org)
          .eq("subappaltatore_id", fid)
          .order("data_inizio", { ascending: false })
          .limit(100),
      ]);

      const bolle = (bolleQ.data ?? []) as any[];
      const prezzi = (prezziQ.data ?? []) as any[];
      const contratti = (contrQ.data ?? []) as any[];

      const commIds = Array.from(
        new Set([...bolle, ...contratti].map((r: any) => r.commessa_id).filter(Boolean)),
      );
      const matIds = Array.from(new Set(prezzi.map((p) => p.materiale_id).filter(Boolean)));
      const [commQ, matQ] = await Promise.all([
        commIds.length
          ? context.supabase.from("commesse").select("id, codice, denominazione").in("id", commIds)
          : Promise.resolve({ data: [] as any[] }),
        matIds.length
          ? context.supabase.from("materiali").select("id, codice, descrizione, unita_misura").in("id", matIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const cm = new Map(((commQ.data ?? []) as any[]).map((c) => [c.id, c]));
      const mm = new Map(((matQ.data ?? []) as any[]).map((m) => [m.id, m]));

      const bolleAttive = bolle.filter((b) => b.stato !== "annullata");
      const totaleBolle = bolleAttive.reduce((s, b) => s + Number(b.imponibile ?? 0), 0);
      const totaleContratti = contratti
        .filter((c) => c.stato !== "annullato")
        .reduce((s, c) => s + Number(c.importo_contratto ?? 0), 0);
      const totaleMaturato = contratti
        .filter((c) => c.stato !== "annullato")
        .reduce((s, c) => s + Number(c.importo_maturato ?? 0), 0);

      return {
        soggetto: sog,
        canSeeEconomics: canEcon,
        totali: canEcon
          ? {
              bolle: bolleAttive.length,
              totaleBolle,
              contratti: contratti.length,
              totaleContratti,
              totaleMaturato,
            }
          : null,
        bolle: bolle.map((b) => ({
          id: b.id,
          numero_bolla: b.numero_bolla,
          data_bolla: b.data_bolla,
          stato: b.stato,
          rapportino_id: b.rapportino_id,
          commessa: cm.get(b.commessa_id) ?? null,
          imponibile: canEcon ? Number(b.imponibile ?? 0) : null,
          totale: canEcon ? Number(b.totale ?? 0) : null,
        })),
        prezzi: canEcon
          ? prezzi.map((p) => ({
              id: p.id,
              data_prezzo: p.data_prezzo,
              prezzo_unitario: Number(p.prezzo_unitario ?? 0),
              unita_misura: p.unita_misura ?? mm.get(p.materiale_id)?.unita_misura ?? null,
              descrizione: p.descrizione ?? mm.get(p.materiale_id)?.descrizione ?? "—",
              materiale: mm.get(p.materiale_id) ?? null,
            }))
          : [],
        documenti: (docQ.data ?? []) as any[],
        contratti: contratti.map((c) => ({
          ...c,
          importo_contratto: canEcon ? Number(c.importo_contratto ?? 0) : null,
          importo_maturato: canEcon ? Number(c.importo_maturato ?? 0) : null,
          importo_pagato: canEcon ? Number(c.importo_pagato ?? 0) : null,
          commessa: cm.get(c.commessa_id) ?? null,
        })),
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

/** Panoramica subappaltatori: contratti attivi e stato documenti obbligatori. */
export const listSubappaltatoriOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { organizationId: org, roles } = await resolveDashboardContext(
        context.supabase,
        context.userId,
      );
      const canEcon = hasAnyRole(roles, ECON_ROLES);

      const { data: soggetti, error } = await context.supabase
        .from("fornitori")
        .select("id, ragione_sociale, specializzazioni, stato_qualifica, partita_iva, telefono, email, is_active")
        .eq("organization_id", org)
        .is("archived_at", null)
        .in("tipo_soggetto", ["subappaltatore", "entrambi"])
        .order("ragione_sociale");
      if (error) throw error;
      const ids = (soggetti ?? []).map((s: any) => s.id);
      if (!ids.length) return { canSeeEconomics: canEcon, righe: [] as any[] };

      const [contrQ, docQ] = await Promise.all([
        context.supabase
          .from("subappalti_contratti")
          .select("subappaltatore_id, stato, importo_contratto, importo_maturato")
          .eq("organization_id", org)
          .in("subappaltatore_id", ids),
        context.supabase
          .from("documenti")
          .select("id, subappaltatore_id, fornitore_id, data_scadenza, stato")
          .eq("organization_id", org)
          .is("archived_at", null)
          .eq("is_versione_corrente", true)
          .not("data_scadenza", "is", null)
          .or(`subappaltatore_id.in.(${ids.join(",")}),fornitore_id.in.(${ids.join(",")})`),
      ]);

      const contratti = (contrQ.data ?? []) as any[];
      const documenti = (docQ.data ?? []) as any[];
      const oggi = new Date().toISOString().slice(0, 10);
      const fra30 = new Date();
      fra30.setDate(fra30.getDate() + 30);
      const limite = fra30.toISOString().slice(0, 10);

      const righe = (soggetti ?? []).map((s: any) => {
        const cs = contratti.filter((c) => c.subappaltatore_id === s.id);
        const ds = documenti.filter(
          (d) => d.subappaltatore_id === s.id || d.fornitore_id === s.id,
        );
        const scaduti = ds.filter((d) => String(d.data_scadenza).slice(0, 10) < oggi).length;
        const inScadenza = ds.filter((d) => {
          const x = String(d.data_scadenza).slice(0, 10);
          return x >= oggi && x <= limite;
        }).length;
        return {
          ...s,
          contrattiAttivi: cs.filter((c) => c.stato === "attivo").length,
          contrattiTotali: cs.length,
          importoContratti: canEcon
            ? cs.filter((c) => c.stato !== "annullato").reduce((a, c) => a + Number(c.importo_contratto ?? 0), 0)
            : null,
          importoMaturato: canEcon
            ? cs.filter((c) => c.stato !== "annullato").reduce((a, c) => a + Number(c.importo_maturato ?? 0), 0)
            : null,
          documentiTotali: ds.length,
          documentiScaduti: scaduti,
          documentiInScadenza: inScadenza,
        };
      });

      return { canSeeEconomics: canEcon, righe };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
