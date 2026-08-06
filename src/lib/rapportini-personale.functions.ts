import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";

/**
 * Personale multiplo nei rapportini.
 * Tutte le operazioni passano da RPC SECURITY DEFINER tenant-safe:
 * `organization_id` non è mai accettato dal client e i campi economici
 * sono filtrati lato server in base al ruolo.
 */

const uuid = z.string().uuid();

export const getRapportinoPersonale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: rows, error } = await context.supabase.rpc("get_rapportino_personale" as any, {
        _rapportino_id: data.rapportino_id,
      });
      if (error) throw error;
      return (rows ?? []) as any[];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

const rigaSchema = z.object({
  membro_id: uuid,
  ore: z.number().positive().max(24),
  nota: z.string().max(500).nullable().optional(),
  mansione: z.string().max(100).nullable().optional(),
});

export const saveRapportinoPersonale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rapportino_id: uuid,
        righe: z.array(rigaSchema).max(50),
        allow_recalc: z.boolean().optional(),
      })
      .superRefine((v, ctx) => {
        const seen = new Set<string>();
        for (const r of v.righe) {
          if (seen.has(r.membro_id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "La stessa persona è stata inserita due volte",
              path: ["righe"],
            });
          }
          seen.add(r.membro_id);
        }
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("save_rapportino_personale" as any, {
        _rapportino_id: data.rapportino_id,
        _righe: data.righe.map((r) => ({
          membro_id: r.membro_id,
          ore: r.ore,
          nota: r.nota ?? null,
          mansione: r.mansione?.trim() ? r.mansione.trim() : null,
        })),
        _allow_recalc: data.allow_recalc ?? false,
      });
      if (error) throw error;
      const row = Array.isArray(res) ? res[0] : res;
      return row ?? null;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const ricalcolaRighePersonaleMancanti = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        dry_run: z.boolean().optional(),
        riga_ids: z.array(uuid).nullable().optional(),
        rapportino_id: uuid.nullable().optional(),
        membro_id: uuid.nullable().optional(),
        date_from: z.string().nullable().optional(),
        date_to: z.string().nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: rows, error } = await context.supabase.rpc(
        "ricalcola_righe_personale_mancanti" as any,
        {
          _dry_run: data.dry_run ?? true,
          _riga_ids: data.riga_ids ?? null,
          _rapportino_id: data.rapportino_id ?? null,
          _membro_id: data.membro_id ?? null,
          _date_from: data.date_from ?? null,
          _date_to: data.date_to ?? null,
          _limit: 500,
        },
      );
      if (error) throw error;
      return (rows ?? []) as any[];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const contabilizzaRapportinoPersonale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rapportino_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc(
        "contabilizza_rapportino_personale" as any,
        { _rapportino_id: data.rapportino_id },
      );
      if (error) throw error;
      return (Array.isArray(res) ? res[0] : res) ?? null;
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
