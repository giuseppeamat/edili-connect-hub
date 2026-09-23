/**
 * Estrazione automatica bolle da PDF — regole pure (testabili, no I/O).
 * Nessun dato viene inventato: ogni campo porta con sé un livello di confidenza
 * e l'utente conferma sempre prima del salvataggio.
 */

export type LivelloConfidenza = "alta" | "media" | "bassa";

export type CampoEstratto = {
  value: string | null;
  confidence: number;
};

export type RigaEstratta = {
  codice_articolo: string | null;
  descrizione: string | null;
  quantita: number | null;
  unita_misura: string | null;
  prezzo_unitario: number | null;
  sconto_pct: number | null;
  iva_pct: number | null;
  totale_riga: number | null;
  confidence: number;
};

export type BollaEstratta = {
  numero_bolla: CampoEstratto;
  data_bolla: CampoEstratto;
  data_consegna: CampoEstratto;
  fornitore_ragione_sociale: CampoEstratto;
  partita_iva: CampoEstratto;
  codice_fiscale: CampoEstratto;
  riferimento_ordine: CampoEstratto;
  riferimento_commessa: CampoEstratto;
  riferimento_cantiere: CampoEstratto;
  note: CampoEstratto;
  totale_imponibile: number | null;
  totale_iva: number | null;
  totale_documento: number | null;
  righe: RigaEstratta[];
};

export const SOGLIA_ALTA = 0.8;
export const SOGLIA_MEDIA = 0.5;

/** Etichette UX: Alta confidenza / Da verificare / Non riconosciuto. */
export function livelloConfidenza(value: unknown, confidence: number | null | undefined): LivelloConfidenza {
  const vuoto =
    value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  if (vuoto) return "bassa";
  const c = confidence ?? 0;
  if (c >= SOGLIA_ALTA) return "alta";
  if (c >= SOGLIA_MEDIA) return "media";
  return "bassa";
}

export const LABEL_CONFIDENZA: Record<LivelloConfidenza, string> = {
  alta: "Alta confidenza",
  media: "Da verificare",
  bassa: "Non riconosciuto",
};

/* ── Normalizzazioni ─────────────────────────────────────────────────────── */

const FORME_SOCIETARIE = [
  "s.r.l.s.",
  "s.r.l.",
  "srls",
  "srl",
  "s.p.a.",
  "spa",
  "s.n.c.",
  "snc",
  "s.a.s.",
  "sas",
  "s.s.",
  "societa cooperativa",
  "cooperativa",
  "& c.",
  "di",
];

/** Ragione sociale confrontabile: minuscolo, senza forma societaria e punteggiatura. */
export function normalizzaRagioneSociale(v: string | null | undefined): string {
  if (!v) return "";
  let s = v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9&.\s]/g, " ");
  for (const f of FORME_SOCIETARIE) s = s.split(f).join(" ");
  return s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Solo cifre: gestisce prefisso IT e separatori. */
export function normalizzaPiva(v: string | null | undefined): string {
  if (!v) return "";
  return v.replace(/[^0-9]/g, "");
}

/** Numeri in formato italiano (1.234,56) o internazionale (1,234.56). */
export function parseNumeroIt(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = v.trim().replace(/[€\s]/g, "");
  if (s === "") return null;
  const virgola = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  if (virgola > punto) s = s.replace(/\./g, "").replace(",", ".");
  else if (punto > virgola) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Date italiane (gg/mm/aaaa, gg-mm-aa) o ISO → ISO yyyy-mm-dd. */
export function parseDataIt(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (!m) return null;
  const g = Number(m[1]);
  const mm = Number(m[2]);
  let a = Number(m[3]);
  if (a < 100) a += 2000;
  if (g < 1 || g > 31 || mm < 1 || mm > 12) return null;
  return `${a}-${String(mm).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
}

/* ── Match fornitore ─────────────────────────────────────────────────────── */

export type FornitoreRef = {
  id: string;
  ragione_sociale: string;
  partita_iva?: string | null;
  codice_fiscale?: string | null;
};

export type MatchFornitore = {
  fornitore_id: string | null;
  criterio: "partita_iva" | "codice_fiscale" | "ragione_sociale" | "nessuno";
  confidence: number;
};

/** Ordine: partita IVA → codice fiscale → ragione sociale normalizzata. */
export function matchFornitore(
  estratto: { partita_iva?: string | null; codice_fiscale?: string | null; ragione_sociale?: string | null },
  fornitori: FornitoreRef[],
): MatchFornitore {
  const piva = normalizzaPiva(estratto.partita_iva);
  if (piva.length >= 8) {
    const hit = fornitori.find((f) => normalizzaPiva(f.partita_iva) === piva);
    if (hit) return { fornitore_id: hit.id, criterio: "partita_iva", confidence: 0.98 };
  }
  const cf = (estratto.codice_fiscale ?? "").trim().toUpperCase();
  if (cf.length >= 11) {
    const hit = fornitori.find(
      (f) => (f.codice_fiscale ?? "").trim().toUpperCase() === cf || normalizzaPiva(f.partita_iva) === normalizzaPiva(cf),
    );
    if (hit) return { fornitore_id: hit.id, criterio: "codice_fiscale", confidence: 0.92 };
  }
  const nome = normalizzaRagioneSociale(estratto.ragione_sociale);
  if (nome.length >= 3) {
    const esatto = fornitori.find((f) => normalizzaRagioneSociale(f.ragione_sociale) === nome);
    if (esatto) return { fornitore_id: esatto.id, criterio: "ragione_sociale", confidence: 0.85 };
    const parziale = fornitori.filter((f) => {
      const n = normalizzaRagioneSociale(f.ragione_sociale);
      return n.length >= 3 && (n.includes(nome) || nome.includes(n));
    });
    if (parziale.length === 1) {
      return { fornitore_id: parziale[0].id, criterio: "ragione_sociale", confidence: 0.6 };
    }
  }
  return { fornitore_id: null, criterio: "nessuno", confidence: 0 };
}

/* ── Match materiale ─────────────────────────────────────────────────────── */

export type MaterialeRef = {
  id: string;
  nome: string;
  codice?: string | null;
  descrizione?: string | null;
};

export type MatchMateriale = { materiale_id: string | null; confidence: number };

export function matchMateriale(
  riga: { codice_articolo?: string | null; descrizione?: string | null },
  materiali: MaterialeRef[],
): MatchMateriale {
  const cod = (riga.codice_articolo ?? "").trim().toLowerCase();
  if (cod) {
    const hit = materiali.find((m) => (m.codice ?? "").trim().toLowerCase() === cod);
    if (hit) return { materiale_id: hit.id, confidence: 0.95 };
  }
  const desc = normalizzaRagioneSociale(riga.descrizione);
  if (desc.length >= 3) {
    const esatto = materiali.find((m) => normalizzaRagioneSociale(m.nome) === desc);
    if (esatto) return { materiale_id: esatto.id, confidence: 0.85 };
    const parziale = materiali.filter((m) => {
      const n = normalizzaRagioneSociale(m.nome);
      return n.length >= 3 && (desc.includes(n) || n.includes(desc));
    });
    if (parziale.length === 1) return { materiale_id: parziale[0].id, confidence: 0.6 };
  }
  return { materiale_id: null, confidence: 0 };
}

/* ── Coerenza matematica ─────────────────────────────────────────────────── */

export const TOLLERANZA_RIGA = 0.02;
export const TOLLERANZA_DOCUMENTO = 0.05; // 5% per trasporto/accessori/arrotondamenti

export function totaleRigaAtteso(r: {
  quantita?: number | null;
  prezzo_unitario?: number | null;
  sconto_pct?: number | null;
}): number | null {
  if (r.quantita == null || r.prezzo_unitario == null) return null;
  const lordo = r.quantita * r.prezzo_unitario;
  return lordo * (1 - (r.sconto_pct ?? 0) / 100);
}

export function rigaCoerente(r: {
  quantita?: number | null;
  prezzo_unitario?: number | null;
  sconto_pct?: number | null;
  totale_riga?: number | null;
}): boolean {
  const atteso = totaleRigaAtteso(r);
  if (atteso == null || r.totale_riga == null) return true; // dato mancante: non è un errore
  return Math.abs(atteso - r.totale_riga) <= Math.max(TOLLERANZA_RIGA, Math.abs(atteso) * 0.01);
}

export const MSG_TOTALI_DA_VERIFICARE = "Totali da verificare";

/** Confronto somma righe / totale documento: avviso, mai blocco. */
export function verificaTotali(
  righe: Array<{ quantita?: number | null; prezzo_unitario?: number | null; sconto_pct?: number | null; totale_riga?: number | null }>,
  totaleImponibile: number | null | undefined,
): { ok: boolean; sommaRighe: number; avviso: string | null } {
  const somma = righe.reduce((acc, r) => acc + (r.totale_riga ?? totaleRigaAtteso(r) ?? 0), 0);
  if (totaleImponibile == null || totaleImponibile === 0) {
    return { ok: true, sommaRighe: somma, avviso: null };
  }
  const diff = Math.abs(somma - totaleImponibile);
  const ok = diff <= Math.max(0.05, Math.abs(totaleImponibile) * TOLLERANZA_DOCUMENTO);
  return { ok, sommaRighe: somma, avviso: ok ? null : MSG_TOTALI_DA_VERIFICARE };
}

/* ── Qualità estrazione ──────────────────────────────────────────────────── */

/** Un PDF con poco testo estraibile è probabilmente una scansione. */
export function richiedeOcr(testo: string | null | undefined, minCaratteri = 200): boolean {
  return (testo ?? "").replace(/\s+/g, "").length < minCaratteri;
}

export const ERR_PDF_VUOTO = "Il file è vuoto.";
export const ERR_PDF_NON_LEGGIBILE =
  "Non è stato possibile leggere il PDF: potrebbe essere protetto o danneggiato. Puoi comunque inserire i dati manualmente.";
export const ERR_NON_RICONOSCIUTO =
  "Il documento non sembra una bolla o un DDT: verifica i campi proposti prima di salvare.";

/** Il documento è utilizzabile se almeno numero o fornitore sono stati letti. */
export function estrazioneUtile(e: Pick<BollaEstratta, "numero_bolla" | "fornitore_ragione_sociale">): boolean {
  return !!(e.numero_bolla.value?.trim() || e.fornitore_ragione_sociale.value?.trim());
}
