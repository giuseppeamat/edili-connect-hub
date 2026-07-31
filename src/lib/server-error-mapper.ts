/**
 * Centralized mapper for PostgreSQL/RPC errors -> user-friendly Italian messages.
 * Never expose SQL details, SQLSTATE codes, constraint names or stack traces to the client.
 * Detailed technical errors are logged server-side (without sensitive data).
 */

export type ServerErrorLike =
  | { code?: string; message?: string; details?: string; hint?: string }
  | Error
  | unknown;

const MAP_BY_CODE: Record<string, string> = {
  "40001": "La fase è stata modificata da un altro utente. Ricarica i dati e riprova.",
  "P0002": "Il record richiesto non è più disponibile.",
  "42501": "Non sei autorizzato a completare questa operazione.",
  "23505": "Esiste già un record con questi dati.",
  "23503": "Riferimento non valido: il record collegato non esiste.",
  "22023": "Dati non validi per completare l'operazione.",
};

const PATTERNS: Array<{ re: RegExp; msg: string }> = [
  { re: /conflitto di concorrenza/i, msg: "La fase è stata modificata da un altro utente. Ricarica i dati e riprova." },
  { re: /modificata da un altro utente/i, msg: "La fase è stata modificata da un altro utente. Ricarica i dati e riprova." },
  { re: /transizione stato non consentita|passaggio di stato/i, msg: "Il passaggio di stato richiesto non è consentito." },
  { re: /motivazione obbligatoria/i, msg: "Inserisci una motivazione per completare questa operazione." },
  { re: /fase annullata/i, msg: "La fase è annullata e non può essere modificata." },
  { re: /fase archiviata/i, msg: "La fase è archiviata. Ripristinala prima di modificarla." },
  { re: /responsabile.*non valido/i, msg: "Il responsabile selezionato non è disponibile per questa fase." },
  { re: /cantiere.*non appartiene alla commessa/i, msg: "Il cantiere selezionato non appartiene alla commessa." },
  { re: /non è modificabile nello stato attuale/i, msg: "La commessa non è modificabile nello stato attuale." },
  { re: /commessa chiusa|commessa è chiusa/i, msg: "La commessa non è modificabile nello stato attuale." },
  { re: /commessa archiviata|commessa è archiviata/i, msg: "La commessa non è modificabile nello stato attuale." },

  { re: /modalità.*non manuale|avanzamento manuale/i, msg: "L'avanzamento manuale non è disponibile quando il calcolo deriva dalle fasi." },
  { re: /avanzamento fuori range/i, msg: "L'avanzamento deve essere compreso tra 0 e 100." },
  { re: /peso fuori range/i, msg: "Il peso deve essere compreso tra 0 e 100." },
  { re: /data di fine prevista/i, msg: "La data di fine prevista non può essere antecedente alla data di inizio." },
  { re: /organizzazione non trovata/i, msg: "Organizzazione non trovata." },
  { re: /utente disattivato/i, msg: "Utente disattivato: contatta un amministratore." },
  { re: /non autenticato/i, msg: "Sessione scaduta: effettua nuovamente l'accesso." },
  { re: /non autorizzato/i, msg: "Non sei autorizzato a completare questa operazione." },
  { re: /NOTIFICA_NON_TROVATA|notifica non trovata/i, msg: "La notifica è già stata aggiornata." },
  { re: /fase non trovata/i, msg: "La fase richiesta non è più disponibile." },
  { re: /commessa non trovata/i, msg: "La commessa richiesta non è più disponibile." },
];

const FALLBACK = "Impossibile completare l'operazione. Riprova più tardi.";

function extractCodeAndMessage(err: ServerErrorLike): { code?: string; message: string } {
  if (!err) return { message: FALLBACK };
  const anyErr = err as any;
  const code: string | undefined = anyErr?.code ?? anyErr?.cause?.code;
  const raw: string = (anyErr?.message ?? String(err) ?? "").toString();
  return { code, message: raw };
}

export function mapServerError(err: ServerErrorLike): string {
  const { code, message } = extractCodeAndMessage(err);
  // Log tecnico solo lato server. Non includere payload utente.
  try {
    if (typeof process !== "undefined" && process?.stdout) {
      // eslint-disable-next-line no-console
      console.error("[server-error]", { code, message: message?.slice(0, 500) });
    }
  } catch { /* noop */ }

  if (code && MAP_BY_CODE[code]) return MAP_BY_CODE[code];
  for (const p of PATTERNS) if (p.re.test(message)) return p.msg;
  // Non esporre dettagli tecnici: se sembra un messaggio Postgres grezzo, restituisci fallback.
  if (/^ERROR:|constraint|relation ".*" does not exist|permission denied for/i.test(message)) return FALLBACK;
  // I messaggi che le RPC costruiscono in italiano sono già user-friendly.
  return message?.trim() || FALLBACK;
}

/**
 * Wrap a server-function handler body: throws a clean Error with mapped message.
 */
export function throwMapped(err: ServerErrorLike): never {
  throw new Error(mapServerError(err));
}
