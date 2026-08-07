/**
 * FEATURE — Costi della struttura: server functions.
 * organization_id è SEMPRE ricavato server-side dal profilo dell'utente.
 * I valori economici sono accessibili solo ai ruoli abilitati (FASE 17).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";
import {
  canReadCostiStruttura,
  canWriteCostiStruttura,
  totaleAnnualizzato,
  oreProduttiveAnnue,
  costoOrarioStruttura,
  costoPersonaleMedio,
  costoIndustrialeOrario,
  prossimaVersione,
  versioneApplicabile,
  versioneLabel,
  ORE_CONFIG_DEFAULT,
  type OreProduttiveConfig,
} from "@/lib/costi-struttura";

const uuid = z.string().uuid();
const anno = z.number().int().min(1990).max(2200);

async function ctxOrgRoles(context: any) {
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
    roles: (roles ?? []).map((r: any) => String(r.role)),
  };
}

async function requireRead(context: any) {
  const r = await ctxOrgRoles(context);
  if (!canReadCostiStruttura(r.roles)) {
    throw new Error("Non sei autorizzato a consultare i costi della struttura");
  }
  return r;
}
async function requireWrite(context: any) {
  const r = await ctxOrgRoles(context);
  if (!canWriteCostiStruttura(r.roles)) {
    throw new Error("Non sei autorizzato a modificare i costi della struttura");
  }
  return r;
}

function toOreCfg(row: any): OreProduttiveConfig {
  if (!row) return { ...ORE_CONFIG_DEFAULT };
  return {
    dipendenti_produttivi: Number(row.dipendenti_produttivi ?? 0),
    ore_teoriche_persona: Number(row.ore_teoriche_persona ?? 0),
    ore_ferie: Number(row.ore_ferie ?? 0),
    ore_permessi: Number(row.ore_permessi ?? 0),
    ore_festivita: Number(row.ore_festivita ?? 0),
    ore_malattia: Number(row.ore_malattia ?? 0),
    ore_formazione: Number(row.ore_formazione ?? 0),
    ore_amministrative: Number(row.ore_amministrative ?? 0),
    ore_non_produttive_altre: Number(row.ore_non_produttive_altre ?? 0),
    ore_produttive_manuali:
      row.ore_produttive_manuali === null || row.ore_produttive_manuali === undefined
        ? null
        : Number(row.ore_produttive_manuali),
    usa_manuale: Boolean(row.usa_manuale),
  };
}

// ═════════════════════════ OVERVIEW ═════════════════════════
export const getCostiStrutturaOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ anno: anno.optional(), includeArchived: z.boolean().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const { org, roles } = await requireRead(context);
      const year = data.anno ?? new Date().getFullYear();

      await context.supabase.rpc("ensure_costi_struttura_categorie", { _org: org });

      const [catRes, costiRes, oreRes, cfgRes, verRes, tariffeRes, fornRes] = await Promise.all([
        context.supabase
          .from("costi_struttura_categorie")
          .select("*")
          .eq("organization_id", org)
          .is("archived_at", null)
          .order("ordine", { ascending: true }),
        context.supabase
          .from("costi_struttura")
          .select("*")
          .eq("organization_id", org)
          .order("created_at", { ascending: false })
          .limit(2000),
        context.supabase
          .from("ore_produttive_config")
          .select("*")
          .eq("organization_id", org)
          .eq("anno", year)
          .maybeSingle(),
        context.supabase
          .from("costi_struttura_config")
          .select("*")
          .eq("organization_id", org)
          .maybeSingle(),
        context.supabase
          .from("costo_orario_versioni")
          .select("*")
          .eq("organization_id", org)
          .order("anno", { ascending: false })
          .order("versione", { ascending: false })
          .limit(300),
        context.supabase
          .from("personale_costi_orari")
          .select("costo_orario, archived_at")
          .eq("organization_id", org)
          .is("archived_at", null),
        context.supabase
          .from("fornitori")
          .select("id, ragione_sociale")
          .eq("organization_id", org)
          .limit(500),
      ]);

      const categorie = catRes.data ?? [];
      const tuttiCosti = (costiRes.data ?? []).map((r: any) => ({
        ...r,
        importo: Number(r.importo ?? 0),
        quota_annua: Number(r.quota_annua ?? 0),
        valore_residuo: r.valore_residuo === null ? null : Number(r.valore_residuo),
      }));
      const costi = data.includeArchived ? tuttiCosti : tuttiCosti.filter((c: any) => !c.archived_at);
      const oreCfg = toOreCfg(oreRes.data);
      const cfg = cfgRes.data ?? {
        organization_id: org,
        includi_personale_diretto: false,
        includi_costo_personale_in_industriale: true,
        includi_costo_struttura_in_industriale: true,
        includi_costo_mezzi_in_industriale: false,
        costo_mezzi_orario: 0,
        altri_overhead_orario: 0,
      };
      const versioni = (verRes.data ?? []).map((v: any) => ({
        ...v,
        totale_costi_annualizzati: Number(v.totale_costi_annualizzati ?? 0),
        ore_produttive: Number(v.ore_produttive ?? 0),
        costo_orario_struttura: Number(v.costo_orario_struttura ?? 0),
        costo_personale_medio: Number(v.costo_personale_medio ?? 0),
        costo_industriale_orario: Number(v.costo_industriale_orario ?? 0),
      }));

      const opts = { includiPersonaleDiretto: Boolean(cfg.includi_personale_diretto) };
      const totale = totaleAnnualizzato(tuttiCosti, year, opts);
      const totalePrec = totaleAnnualizzato(tuttiCosti, year - 1, opts);
      const ore = oreProduttiveAnnue(oreCfg);
      const cs = costoOrarioStruttura(totale, ore);
      const cpm = costoPersonaleMedio(tariffeRes.data ?? []);
      const industriale = costoIndustrialeOrario(
        {
          costoPersonaleMedio: cpm,
          costoStruttura: cs,
          costoMezzi: Number(cfg.costo_mezzi_orario ?? 0),
          altriOverhead: Number(cfg.altri_overhead_orario ?? 0),
        },
        {
          includi_costo_personale_in_industriale: Boolean(cfg.includi_costo_personale_in_industriale),
          includi_costo_struttura_in_industriale: Boolean(cfg.includi_costo_struttura_in_industriale),
          includi_costo_mezzi_in_industriale: Boolean(cfg.includi_costo_mezzi_in_industriale),
        },
      );

      return {
        anno: year,
        canWrite: canWriteCostiStruttura(roles),
        categorie,
        costi,
        oreConfig: { ...oreCfg, anno: year },
        config: cfg,
        versioni,
        fornitori: fornRes.data ?? [],
        kpi: {
          totaleAnnualizzato: totale,
          totaleAnnoPrecedente: totalePrec,
          oreProduttive: ore,
          costoOrarioStruttura: cs,
          costoPersonaleMedio: cpm,
          costoIndustrialeOrario: industriale,
        },
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ═════════════════════════ COSTI ═════════════════════════
const costoSchema = z.object({
  id: uuid.optional().nullable(),
  categoria_id: uuid,
  descrizione: z.string().trim().min(2, "Descrizione obbligatoria").max(300),
  importo: z.number().nonnegative(),
  periodicita: z.enum(["mensile", "trimestrale", "semestrale", "annuale", "una_tantum", "ammortizzato"]),
  data_inizio: z.string().min(4),
  data_fine: z.string().min(4).nullable().optional(),
  anno_riferimento: anno,
  mese_riferimento: z.number().int().min(1).max(12).nullable().optional(),
  fornitore_id: uuid.nullable().optional(),
  documento_id: uuid.nullable().optional(),
  tipo_personale: z
    .enum(["non_applicabile", "diretto", "indiretto", "amministrazione", "titolari", "tecnico"])
    .default("non_applicabile"),
  anni_ammortamento: z.number().int().positive().nullable().optional(),
  data_inizio_ammortamento: z.string().min(4).nullable().optional(),
  valore_residuo: z.number().nonnegative().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const saveCostoStruttura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => costoSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      if (data.periodicita === "ammortizzato" && !data.anni_ammortamento) {
        throw new Error("Per un costo ammortizzato indica il numero di anni");
      }
      const payload: any = {
        categoria_id: data.categoria_id,
        descrizione: data.descrizione,
        importo: data.importo,
        periodicita: data.periodicita,
        data_inizio: data.data_inizio,
        data_fine: data.data_fine ?? null,
        anno_riferimento: data.anno_riferimento,
        mese_riferimento: data.mese_riferimento ?? null,
        fornitore_id: data.fornitore_id ?? null,
        documento_id: data.documento_id ?? null,
        tipo_personale: data.tipo_personale,
        anni_ammortamento: data.periodicita === "ammortizzato" ? (data.anni_ammortamento ?? null) : null,
        data_inizio_ammortamento:
          data.periodicita === "ammortizzato"
            ? (data.data_inizio_ammortamento ?? data.data_inizio)
            : null,
        valore_residuo: data.periodicita === "ammortizzato" ? (data.valore_residuo ?? null) : null,
        note: data.note ?? null,
        is_active: data.is_active ?? true,
        updated_by: context.userId,
      };

      if (data.id) {
        const { data: row, error } = await context.supabase
          .from("costi_struttura")
          .update(payload)
          .eq("id", data.id)
          .eq("organization_id", org)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!row) throw new Error("Costo non trovato o permessi insufficienti");
        return { id: row.id as string };
      }
      const { data: row, error } = await context.supabase
        .from("costi_struttura")
        .insert({ ...payload, organization_id: org, created_by: context.userId })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new Error("Creazione non consentita");
      return { id: row.id as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const setCostoStrutturaArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, archived: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      const { data: row, error } = await context.supabase
        .from("costi_struttura")
        .update({
          archived_at: data.archived ? new Date().toISOString() : null,
          archived_by: data.archived ? context.userId : null,
          updated_by: context.userId,
        })
        .eq("id", data.id)
        .eq("organization_id", org)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new Error("Costo non trovato o permessi insufficienti");
      return { ok: true };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ═════════════════════════ CATEGORIE ═════════════════════════
export const saveCategoriaStruttura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: uuid.optional().nullable(),
        gruppo: z.string().trim().min(2).max(60),
        nome: z.string().trim().min(2).max(120),
        descrizione: z.string().max(500).nullable().optional(),
        ordine: z.number().int().min(0).max(9999).optional(),
        is_active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      const payload = {
        gruppo: data.gruppo,
        nome: data.nome,
        descrizione: data.descrizione ?? null,
        ordine: data.ordine ?? 500,
        is_active: data.is_active ?? true,
        updated_by: context.userId,
      };
      if (data.id) {
        const { data: row, error } = await context.supabase
          .from("costi_struttura_categorie")
          .update(payload)
          .eq("id", data.id)
          .eq("organization_id", org)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!row) throw new Error("Categoria non trovata o permessi insufficienti");
        return { id: row.id as string };
      }
      const { data: row, error } = await context.supabase
        .from("costi_struttura_categorie")
        .insert({ ...payload, organization_id: org, created_by: context.userId })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new Error("Creazione non consentita");
      return { id: row.id as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const archiveCategoriaStruttura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      const { count } = await context.supabase
        .from("costi_struttura")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org)
        .eq("categoria_id", data.id)
        .is("archived_at", null);
      if ((count ?? 0) > 0) {
        throw new Error("Categoria utilizzata da costi attivi: archivia prima i costi collegati");
      }
      const { error } = await context.supabase
        .from("costi_struttura_categorie")
        .update({ archived_at: new Date().toISOString(), archived_by: context.userId, is_active: false })
        .eq("id", data.id)
        .eq("organization_id", org);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ═════════════════════════ ORE PRODUTTIVE ═════════════════════════
export const saveOreProduttive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        anno,
        dipendenti_produttivi: z.number().nonnegative(),
        ore_teoriche_persona: z.number().nonnegative(),
        ore_ferie: z.number().nonnegative(),
        ore_permessi: z.number().nonnegative(),
        ore_festivita: z.number().nonnegative(),
        ore_malattia: z.number().nonnegative(),
        ore_formazione: z.number().nonnegative(),
        ore_amministrative: z.number().nonnegative(),
        ore_non_produttive_altre: z.number().nonnegative(),
        ore_produttive_manuali: z.number().nonnegative().nullable().optional(),
        usa_manuale: z.boolean(),
        note: z.string().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      const { error } = await context.supabase
        .from("ore_produttive_config")
        .upsert(
          {
            ...data,
            ore_produttive_manuali: data.usa_manuale ? (data.ore_produttive_manuali ?? 0) : null,
            note: data.note ?? null,
            organization_id: org,
            created_by: context.userId,
            updated_by: context.userId,
          },
          { onConflict: "organization_id,anno" },
        );
      if (error) throw error;
      return { ok: true, oreProduttive: oreProduttiveAnnue(toOreCfg(data)) };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ═════════════════════════ CONFIG ═════════════════════════
export const saveCostiStrutturaConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        includi_personale_diretto: z.boolean(),
        includi_costo_personale_in_industriale: z.boolean(),
        includi_costo_struttura_in_industriale: z.boolean(),
        includi_costo_mezzi_in_industriale: z.boolean(),
        costo_mezzi_orario: z.number().nonnegative(),
        altri_overhead_orario: z.number().nonnegative(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      const { error } = await context.supabase
        .from("costi_struttura_config")
        .upsert({ ...data, organization_id: org, updated_by: context.userId }, { onConflict: "organization_id" });
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

// ═════════════════════════ VERSIONI COSTO ORARIO ═════════════════════════
async function calcolaValori(context: any, org: string, year: number) {
  const [costiRes, oreRes, cfgRes, tariffeRes] = await Promise.all([
    context.supabase.from("costi_struttura").select("*").eq("organization_id", org).limit(2000),
    context.supabase
      .from("ore_produttive_config")
      .select("*")
      .eq("organization_id", org)
      .eq("anno", year)
      .maybeSingle(),
    context.supabase.from("costi_struttura_config").select("*").eq("organization_id", org).maybeSingle(),
    context.supabase
      .from("personale_costi_orari")
      .select("costo_orario")
      .eq("organization_id", org)
      .is("archived_at", null),
  ]);
  const cfg = cfgRes.data ?? {};
  const opts = { includiPersonaleDiretto: Boolean(cfg.includi_personale_diretto) };
  const totale = totaleAnnualizzato(
    (costiRes.data ?? []).map((r: any) => ({ ...r, importo: Number(r.importo ?? 0) })),
    year,
    opts,
  );
  const ore = oreProduttiveAnnue(toOreCfg(oreRes.data));
  const cs = costoOrarioStruttura(totale, ore);
  const cpm = costoPersonaleMedio(tariffeRes.data ?? []);
  const mezzi = Number(cfg.costo_mezzi_orario ?? 0);
  const overhead = Number(cfg.altri_overhead_orario ?? 0);
  const componentiCfg = {
    includi_costo_personale_in_industriale: cfg.includi_costo_personale_in_industriale !== false,
    includi_costo_struttura_in_industriale: cfg.includi_costo_struttura_in_industriale !== false,
    includi_costo_mezzi_in_industriale: Boolean(cfg.includi_costo_mezzi_in_industriale),
  };
  const industriale = costoIndustrialeOrario(
    { costoPersonaleMedio: cpm, costoStruttura: cs, costoMezzi: mezzi, altriOverhead: overhead },
    componentiCfg,
  );
  return { totale, ore, cs, cpm, mezzi, overhead, industriale, componentiCfg, opts };
}

export const calcolaCostoOrarioVersione = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        anno,
        note: z.string().max(1000).nullable().optional(),
        override: z
          .object({
            totale_costi_annualizzati: z.number().nonnegative(),
            ore_produttive: z.number().nonnegative(),
          })
          .nullable()
          .optional(),
        origine: z.enum(["calcolo", "simulazione"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      const v = await calcolaValori(context, org, data.anno);

      const totale = data.override?.totale_costi_annualizzati ?? v.totale;
      const ore = data.override?.ore_produttive ?? v.ore;
      const cs = costoOrarioStruttura(totale, ore);
      const industriale = costoIndustrialeOrario(
        { costoPersonaleMedio: v.cpm, costoStruttura: cs, costoMezzi: v.mezzi, altriOverhead: v.overhead },
        v.componentiCfg,
      );

      const { data: esistenti } = await context.supabase
        .from("costo_orario_versioni")
        .select("anno, versione")
        .eq("organization_id", org)
        .eq("anno", data.anno);
      const versione = prossimaVersione(esistenti ?? [], data.anno);

      const { data: row, error } = await context.supabase
        .from("costo_orario_versioni")
        .insert({
          organization_id: org,
          anno: data.anno,
          versione,
          totale_costi_annualizzati: totale,
          ore_produttive: ore,
          costo_orario_struttura: cs,
          costo_personale_medio: v.cpm,
          costo_mezzi_orario: v.mezzi,
          altri_overhead_orario: v.overhead,
          costo_industriale_orario: industriale,
          componenti: { ...v.componentiCfg, includi_personale_diretto: v.opts.includiPersonaleDiretto },
          origine: data.origine ?? "calcolo",
          stato: "calcolato",
          note: data.note ?? null,
          created_by: context.userId,
        })
        .select("id, versione")
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new Error("Creazione versione non consentita");

      await context.supabase.rpc("_log_audit", {
        _org: org,
        _action: data.origine === "simulazione" ? "simulazione_salvata" : "costo_orario_calcolato",
        _entity: "costo_orario_versioni",
        _entity_id: row.id,
        _meta: { anno: data.anno, versione: row.versione, costo_orario: cs },
      });
      return { id: row.id as string, versione: row.versione as number, costo_orario_struttura: cs };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const approvaCostoOrarioVersione = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { org } = await requireWrite(context);
      const { data: current } = await context.supabase
        .from("costo_orario_versioni")
        .select("id, anno, versione, stato")
        .eq("id", data.id)
        .eq("organization_id", org)
        .maybeSingle();
      if (!current) throw new Error("Versione non trovata");
      if (current.stato === "approvato") throw new Error("Versione già approvata");
      if (current.stato === "archiviato") throw new Error("Versione archiviata");

      // archivia le precedenti approvate dello stesso anno
      const { data: prev } = await context.supabase
        .from("costo_orario_versioni")
        .select("id")
        .eq("organization_id", org)
        .eq("anno", current.anno)
        .eq("stato", "approvato");
      for (const p of prev ?? []) {
        await context.supabase
          .from("costo_orario_versioni")
          .update({ stato: "archiviato" })
          .eq("id", p.id)
          .eq("organization_id", org);
      }

      const { error } = await context.supabase
        .from("costo_orario_versioni")
        .update({ stato: "approvato", approvato_da: context.userId, approvato_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("organization_id", org);
      if (error) throw error;

      await context.supabase.rpc("_log_audit", {
        _org: org,
        _action: "costo_orario_approvato",
        _entity: "costo_orario_versioni",
        _entity_id: data.id,
        _meta: { anno: current.anno, versione: current.versione },
      });
      return { ok: true };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

/** Tariffa struttura corrente utilizzabile nei preventivi (ultima versione approvata). */
export const getCostoStrutturaCorrente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ anno: anno.optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    try {
      const { org } = await requireRead(context);
      const year = data.anno ?? new Date().getFullYear();
      const { data: versioni } = await context.supabase
        .from("costo_orario_versioni")
        .select("id, anno, versione, stato, costo_orario_struttura")
        .eq("organization_id", org)
        .eq("anno", year);
      const v = versioneApplicabile(
        (versioni ?? []).map((x: any) => ({ ...x, costo_orario_struttura: Number(x.costo_orario_struttura) })),
        year,
      );
      if (!v) return { versione_id: null, label: null, costo_orario_struttura: 0, anno: year };
      return {
        versione_id: v.id ?? null,
        label: versioneLabel(v),
        costo_orario_struttura: v.costo_orario_struttura,
        anno: year,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
