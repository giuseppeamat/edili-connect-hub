import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";

/**
 * Anagrafica materiali e storico prezzi fornitori.
 * I materiali sono leggibili da tutta l'organizzazione (RLS);
 * i prezzi solo dai ruoli economici (RPC con controllo di ruolo).
 */

const uuid = z.string().uuid();

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

export const listMateriali = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const org = await orgId(context);
      const { data, error } = await context.supabase
        .from("materiali")
        .select("id, codice, nome, descrizione, categoria, unita_misura_predefinita, is_active")
        .eq("organization_id", org)
        .order("nome", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const saveMateriale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: uuid.nullable().optional(),
        nome: z.string().trim().min(1, "Nome materiale obbligatorio").max(200),
        codice: z.string().trim().max(60).nullable().optional(),
        descrizione: z.string().max(1000).nullable().optional(),
        categoria: z.string().max(100).nullable().optional(),
        unita_misura_predefinita: z.string().max(20).nullable().optional(),
        is_active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const org = await orgId(context);
      const payload = {
        nome: data.nome,
        codice: data.codice?.trim() || null,
        descrizione: data.descrizione || null,
        categoria: data.categoria || null,
        unita_misura_predefinita: data.unita_misura_predefinita || null,
        is_active: data.is_active ?? true,
      };
      if (data.id) {
        const { error } = await context.supabase
          .from("materiali")
          .update(payload)
          .eq("id", data.id)
          .eq("organization_id", org);
        if (error) throw error;
        return { id: data.id };
      }
      const { data: row, error } = await context.supabase
        .from("materiali")
        .insert({ ...payload, organization_id: org, created_by: context.userId })
        .select("id")
        .single();
      if (error) throw error;
      return { id: row!.id as string };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });

export const listPrezziMateriali = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        materiale_id: uuid.nullable().optional(),
        fornitore_id: uuid.nullable().optional(),
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
        q: z.string().max(200).nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: res, error } = await context.supabase.rpc("get_materiali_prezzi" as any, {
        _materiale_id: data.materiale_id ?? null,
        _fornitore_id: data.fornitore_id ?? null,
        _from: data.from || null,
        _to: data.to || null,
        _q: data.q || null,
      });
      if (error) throw error;
      return (res ?? []) as any[];
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
