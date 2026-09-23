import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapServerError } from "@/lib/server-error-mapper";
import {
  ERR_PDF_VUOTO,
  estrazioneUtile,
  matchFornitore,
  matchMateriale,
  verificaTotali,
  type BollaEstratta,
  type MatchFornitore,
} from "@/lib/bolle-estrazione";

const MAX_BYTES = 15 * 1024 * 1024;
const MIME_AMMESSI = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type EsitoEstrazione = {
  metodo: "testo_digitale" | "ocr_ai";
  estratto: BollaEstratta;
  fornitore: MatchFornitore & { suggerito_nome: string | null };
  righe_match: Array<{ materiale_id: string | null; confidence: number }>;
  totali: { ok: boolean; sommaRighe: number; avviso: string | null };
  riconosciuta: boolean;
  duplicati: Array<{ id: string; numero_bolla: string; data_bolla: string; fornitore_nome?: string | null }>;
};

/**
 * Analizza un PDF/immagine di bolla e propone i dati.
 * Nessun salvataggio: il file resta nel browser finché l'utente non conferma.
 */
export const estraiDatiBolla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_base64: z.string().min(1, ERR_PDF_VUOTO),
        file_name: z.string().min(1).max(300),
        mime_type: z.string().min(1).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<EsitoEstrazione> => {
    try {
      if (!MIME_AMMESSI.includes(data.mime_type)) {
        throw new Error("Formato non supportato: carica un PDF o una foto della bolla.");
      }
      const bytes = base64ToBytes(data.file_base64);
      if (bytes.byteLength === 0) throw new Error(ERR_PDF_VUOTO);
      if (bytes.byteLength > MAX_BYTES) throw new Error("File troppo grande: massimo 15 MB.");

      const { estraiBolla } = await import("@/lib/bolle-estrazione.server");
      const { estratto, metodo } = await estraiBolla({
        bytes,
        mimeType: data.mime_type,
        fileName: data.file_name,
      });

      const [fornRes, matRes] = await Promise.all([
        context.supabase
          .from("fornitori")
          .select("id, ragione_sociale, partita_iva, codice_fiscale")
          .is("archived_at", null)
          .limit(1000),
        context.supabase.from("materiali").select("id, codice, nome, descrizione").limit(1000),
      ]);
      if (fornRes.error) throw fornRes.error;
      if (matRes.error) throw matRes.error;

      const fornitori = (fornRes.data ?? []) as any[];
      const match = matchFornitore(
        {
          partita_iva: estratto.partita_iva.value,
          codice_fiscale: estratto.codice_fiscale.value,
          ragione_sociale: estratto.fornitore_ragione_sociale.value,
        },
        fornitori,
      );
      const righe_match = estratto.righe.map((r) => matchMateriale(r, (matRes.data ?? []) as any[]));
      const totali = verificaTotali(estratto.righe, estratto.totale_imponibile);

      let duplicati: EsitoEstrazione["duplicati"] = [];
      if (match.fornitore_id && estratto.numero_bolla.value && estratto.data_bolla.value) {
        const dup = await context.supabase.rpc("check_bolla_duplicati" as any, {
          _fornitore_id: match.fornitore_id,
          _numero: estratto.numero_bolla.value,
          _data: estratto.data_bolla.value,
          _exclude: null,
        });
        if (!dup.error) duplicati = (dup.data ?? []) as any[];
      }

      return {
        metodo,
        estratto,
        fornitore: {
          ...match,
          suggerito_nome:
            fornitori.find((f) => f.id === match.fornitore_id)?.ragione_sociale ?? null,
        },
        righe_match,
        totali,
        riconosciuta: estrazioneUtile(estratto),
        duplicati,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
  });
