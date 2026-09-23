/**
 * Estrazione dati bolla da PDF — lato server.
 *
 * Strategia:
 * 1. testo digitale: estratto localmente con `unpdf` (nessun servizio esterno);
 * 2. scansione (poco testo): il PDF viene inviato a Lovable AI per la lettura OCR.
 *
 * Il file non viene mai salvato su Storage in questa fase e non viene loggato.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import {
  ERR_PDF_NON_LEGGIBILE,
  parseDataIt,
  parseNumeroIt,
  richiedeOcr,
  type BollaEstratta,
} from "@/lib/bolle-estrazione";

const campo = z.object({
  value: z.string().nullable(),
  confidence: z.number(),
});

const schema = z.object({
  numero_bolla: campo,
  data_bolla: campo,
  data_consegna: campo,
  fornitore_ragione_sociale: campo,
  partita_iva: campo,
  codice_fiscale: campo,
  riferimento_ordine: campo,
  riferimento_commessa: campo,
  riferimento_cantiere: campo,
  note: campo,
  totale_imponibile: z.string().nullable(),
  totale_iva: z.string().nullable(),
  totale_documento: z.string().nullable(),
  righe: z.array(
    z.object({
      codice_articolo: z.string().nullable(),
      descrizione: z.string().nullable(),
      quantita: z.string().nullable(),
      unita_misura: z.string().nullable(),
      prezzo_unitario: z.string().nullable(),
      sconto_pct: z.string().nullable(),
      iva_pct: z.string().nullable(),
      totale_riga: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
});

const PROMPT = `Sei un assistente che legge bolle di consegna e DDT di fornitori edili italiani.
Estrai SOLO i dati realmente presenti nel documento.
Regole tassative:
- non inventare mai un valore: se un dato non è presente usa null e confidence 0;
- confidence è la tua certezza sul singolo campo, da 0 a 1;
- numeri e importi vanno riportati come nel documento (es. "1.234,56");
- le date vanno riportate come nel documento (es. "21/09/2026");
- includi una riga per ogni materiale/articolo consegnato;
- se il documento non è una bolla o un DDT, restituisci tutti i campi null.`;

export type EstrazioneGrezza = {
  estratto: BollaEstratta;
  metodo: "testo_digitale" | "ocr_ai";
};

/** Estrae il testo digitale del PDF senza OCR. */
export async function estraiTestoPdf(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : (text as string[]).join("\n");
  } catch {
    return "";
  }
}

function toCampo(c: { value: string | null; confidence: number } | undefined) {
  return { value: c?.value?.trim() || null, confidence: Number(c?.confidence ?? 0) };
}

export async function estraiBolla(input: {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}): Promise<EstrazioneGrezza> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Servizio di lettura documenti non configurato.");

  const isPdf = input.mimeType === "application/pdf";
  const testo = isPdf ? await estraiTestoPdf(input.bytes) : "";
  const usaFile = !isPdf || richiedeOcr(testo);

  const lovable = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });

  const content: any[] = [{ type: "text", text: PROMPT }];
  if (usaFile) {
    content.push({
      type: "file",
      data: input.bytes,
      mediaType: input.mimeType,
      filename: input.fileName,
    });
  } else {
    content.push({ type: "text", text: `Testo del documento:\n\n${testo.slice(0, 60000)}` });
  }

  let raw: z.infer<typeof schema>;
  try {
    const result = streamText({
      model: lovable.responses("openai/gpt-6-astra"),
      output: Output.object({ schema }),
      messages: [{ role: "user", content }],
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    raw = (await result.output) as z.infer<typeof schema>;
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) throw new Error(ERR_PDF_NON_LEGGIBILE);
    throw e;
  }

  const estratto: BollaEstratta = {
    numero_bolla: toCampo(raw.numero_bolla),
    data_bolla: (() => {
      const c = toCampo(raw.data_bolla);
      return { value: parseDataIt(c.value), confidence: parseDataIt(c.value) ? c.confidence : 0 };
    })(),
    data_consegna: (() => {
      const c = toCampo(raw.data_consegna);
      return { value: parseDataIt(c.value), confidence: parseDataIt(c.value) ? c.confidence : 0 };
    })(),
    fornitore_ragione_sociale: toCampo(raw.fornitore_ragione_sociale),
    partita_iva: toCampo(raw.partita_iva),
    codice_fiscale: toCampo(raw.codice_fiscale),
    riferimento_ordine: toCampo(raw.riferimento_ordine),
    riferimento_commessa: toCampo(raw.riferimento_commessa),
    riferimento_cantiere: toCampo(raw.riferimento_cantiere),
    note: toCampo(raw.note),
    totale_imponibile: parseNumeroIt(raw.totale_imponibile),
    totale_iva: parseNumeroIt(raw.totale_iva),
    totale_documento: parseNumeroIt(raw.totale_documento),
    righe: (raw.righe ?? []).slice(0, 200).map((r) => ({
      codice_articolo: r.codice_articolo?.trim() || null,
      descrizione: r.descrizione?.trim() || null,
      quantita: parseNumeroIt(r.quantita),
      unita_misura: r.unita_misura?.trim() || null,
      prezzo_unitario: parseNumeroIt(r.prezzo_unitario),
      sconto_pct: parseNumeroIt(r.sconto_pct),
      iva_pct: parseNumeroIt(r.iva_pct),
      totale_riga: parseNumeroIt(r.totale_riga),
      confidence: Number(r.confidence ?? 0),
    })),
  };

  return { estratto, metodo: usaFile ? "ocr_ai" : "testo_digitale" };
}
