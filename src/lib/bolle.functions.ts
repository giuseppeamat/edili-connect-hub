import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";

/**
 * Bolle e materiali consegnati nel rapportino.
 * Tutte le operazioni passano da RPC SECURITY DEFINER tenant-safe:
 * `organization_id` non è mai accettato dal client e i campi economici
 * sono filtrati lato server in base al ruolo.
 */

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();

export const getRapportinoBolle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("get_rapportino_bolle" as any, {
        _rapportino_id: data.rapportino_id,
      });
      if (error) throw error;
      return (res ?? []) as any[];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const rigaSchema = z.object({
  materiale_id: nullableUuid,
  descrizione: z.string().trim().min(1, "Descrizione riga obbligatoria").max(500),
  codice_articolo: z.string().max(100).nullable().optional(),
  quantita: z.number().positive("Quantità non valida"),
  unita_misura: z.string().max(20).nullable().optional(),
  prezzo_unitario: z.number().min(0).nullable().optional(),
  sconto_pct: z.number().min(0).max(100).nullable().optional(),
  iva_pct: z.number().min(0).max(100).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const saveRapportinoBolla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rapportino_id: uuid,
        bolla: z.object({
          id: nullableUuid,
          fornitore_id: uuid,
          cantiere_id: nullableUuid,
          numero_bolla: z.string().trim().min(1, "Numero bolla obbligatorio").max(100),
          data_bolla: z.string().min(10, "Data bolla obbligatoria"),
          data_consegna: z.string().nullable().optional(),
          note: z.string().max(2000).nullable().optional(),
          stato: z.string().max(40).nullable().optional(),
          documento_id: nullableUuid,
        }),
        righe: z.array(rigaSchema).min(1, "Inserisci almeno una riga materiale").max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("save_rapportino_bolla" as any, {
        _rapportino_id: data.rapportino_id,
        _bolla: {
          id: data.bolla.id ?? null,
          fornitore_id: data.bolla.fornitore_id,
          cantiere_id: data.bolla.cantiere_id ?? null,
          numero_bolla: data.bolla.numero_bolla,
          data_bolla: data.bolla.data_bolla,
          data_consegna: data.bolla.data_consegna ?? null,
          note: data.bolla.note ?? null,
          stato: data.bolla.stato ?? null,
          documento_id: data.bolla.documento_id ?? null,
        },
        _righe: data.righe.map((r) => ({
          materiale_id: r.materiale_id ?? null,
          descrizione: r.descrizione,
          codice_articolo: r.codice_articolo ?? null,
          quantita: r.quantita,
          unita_misura: r.unita_misura ?? null,
          prezzo_unitario: r.prezzo_unitario ?? null,
          sconto_pct: r.sconto_pct ?? 0,
          iva_pct: r.iva_pct ?? null,
          note: r.note ?? null,
        })),
      });
      if (error) throw error;
      return { id: res as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const annullaRapportinoBolla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: uuid, motivo: z.string().trim().min(3, "Motivazione obbligatoria").max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("annulla_rapportino_bolla" as any, {
        _id: data.id,
        _motivo: data.motivo,
      });
      if (error) throw error;
      return { id: res as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getRapportinoRiepilogoCosti = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc(
        "get_rapportino_costi_riepilogo" as any,
        { _rapportino_id: data.rapportino_id },
      );
      if (error) throw error;
      return (res ?? { visibile: false }) as any;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

/* ──────────────────────────────────────────────────────────────────────────
 * Archivio bolle (Documenti → Bolle): la bolla può esistere senza rapportino.
 * ────────────────────────────────────────────────────────────────────────── */

const bollaTestata = z.object({
  id: nullableUuid,
  rapportino_id: nullableUuid,
  commessa_id: nullableUuid,
  cantiere_id: nullableUuid,
  fornitore_id: uuid,
  numero_bolla: z.string().trim().min(1, "Numero bolla obbligatorio").max(100),
  data_bolla: z.string().min(10, "Data bolla obbligatoria"),
  data_consegna: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  documento_id: nullableUuid,
});

export const listBolle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        q: z.string().nullable().optional(),
        fornitore_id: nullableUuid,
        commessa_id: nullableUuid,
        collegamento: z.enum(["collegata", "non_collegata"]).nullable().optional(),
        stato: z.string().max(40).nullable().optional(),
        includeArchived: z.boolean().optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("list_bolle" as any, {
        _filters: {
          q: data.q ?? null,
          fornitore_id: data.fornitore_id ?? null,
          commessa_id: data.commessa_id ?? null,
          collegamento: data.collegamento ?? null,
          stato: data.stato ?? null,
          includeArchived: data.includeArchived ?? false,
          page: data.page ?? 1,
          pageSize: data.pageSize ?? 25,
        },
      });
      if (error) throw error;
      return (res ?? { items: [], total: 0, capabilities: {} }) as any;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const getBolla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("get_bolla" as any, { _id: data.id });
      if (error) throw error;
      return res as any;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const saveBolla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ bolla: bollaTestata, righe: z.array(rigaSchema).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("save_bolla" as any, {
        _bolla: {
          id: data.bolla.id ?? null,
          rapportino_id: data.bolla.rapportino_id ?? null,
          commessa_id: data.bolla.commessa_id ?? null,
          cantiere_id: data.bolla.cantiere_id ?? null,
          fornitore_id: data.bolla.fornitore_id,
          numero_bolla: data.bolla.numero_bolla,
          data_bolla: data.bolla.data_bolla,
          data_consegna: data.bolla.data_consegna ?? null,
          note: data.bolla.note ?? null,
          documento_id: data.bolla.documento_id ?? null,
        },
        _righe: data.righe.map((r) => ({
          materiale_id: r.materiale_id ?? null,
          descrizione: r.descrizione,
          codice_articolo: r.codice_articolo ?? null,
          quantita: r.quantita,
          unita_misura: r.unita_misura ?? null,
          prezzo_unitario: r.prezzo_unitario ?? null,
          sconto_pct: r.sconto_pct ?? 0,
          iva_pct: r.iva_pct ?? null,
          note: r.note ?? null,
        })),
      });
      if (error) throw error;
      return { id: res as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const collegaBollaRapportino = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("collega_bolla_rapportino" as any, {
        _id: data.id,
        _rapportino_id: data.rapportino_id,
      });
      if (error) throw error;
      return { id: res as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const archiveBolla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, archive: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("archive_bolla" as any, {
        _id: data.id,
        _archive: data.archive,
      });
      if (error) throw error;
      return { id: res as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const checkBolleDuplicati = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        fornitore_id: uuid,
        numero_bolla: z.string().trim().min(1),
        data_bolla: z.string().min(10),
        exclude_id: nullableUuid,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("check_bolla_duplicati" as any, {
        _fornitore_id: data.fornitore_id,
        _numero: data.numero_bolla,
        _data: data.data_bolla,
        _exclude: data.exclude_id ?? null,
      });
      if (error) throw error;
      return (res ?? []) as any[];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

/** Opzioni commesse/cantieri/rapportini per il form bolla (filtrate da RLS). */
export const listBollaOpzioni = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ commessa_id: nullableUuid, cantiere_id: nullableUuid }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const commesse = await context.supabase
        .from("commesse")
        .select("id, codice, titolo")
        .is("archived_at", null)
        .order("codice", { ascending: false })
        .limit(500);
      if (commesse.error) throw commesse.error;

      let cantieri: any[] = [];
      let rapportini: any[] = [];
      if (data.commessa_id) {
        const c = await context.supabase
          .from("cantieri")
          .select("id, codice, nome")
          .eq("commessa_id", data.commessa_id)
          .order("nome");
        if (c.error) throw c.error;
        cantieri = c.data ?? [];

        let rq = context.supabase
          .from("rapportini")
          .select("id, data, stato, cantiere_id, lavorazione")
          .eq("commessa_id", data.commessa_id)
          .is("archived_at", null)
          .neq("stato", "annullato")
          .order("data", { ascending: false })
          .limit(200);
        if (data.cantiere_id) rq = rq.eq("cantiere_id", data.cantiere_id);
        const r = await rq;
        if (r.error) throw r.error;
        rapportini = r.data ?? [];
      }
      return { commesse: commesse.data ?? [], cantieri, rapportini };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
