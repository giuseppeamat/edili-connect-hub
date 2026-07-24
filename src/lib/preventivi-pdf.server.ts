// Server-only PDF generator for preventivi. Uses pdf-lib's bundled ESM build to avoid Worker/CJS helper issues.
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib/dist/pdf-lib.esm.js";

type Voce = {
  ordine: number;
  descrizione: string;
  unita_misura: string | null;
  quantita: number;
  prezzo_unitario: number;
  sconto_pct: number;
  maggiorazione_pct: number;
  importo_netto: number;
  iva_pct: number;
};

type Categoria = {
  id: string;
  titolo: string;
  descrizione: string | null;
  posizione: number;
  subtotale_ricavo: number;
  voci: Voce[];
};

export type PreventivoPdfInput = {
  preventivo: {
    numero: string;
    versione: number;
    titolo: string | null;
    oggetto: string;
    data_preventivo: string;
    data_validita: string | null;
    stato: string;
    is_current_version: boolean;
    sconto_globale_pct: number;
    maggiorazione_globale_pct: number;
    spese_accessorie: number;
    iva_default_pct: number;
    totale_ricavo: number;
    totale_iva: number;
    totale: number;
    condizioni_pagamento: string | null;
    tempi_esecuzione: string | null;
    esclusioni: string | null;
    garanzie: string | null;
    condizioni_generali: string | null;
    note: string | null;
  };
  organizzazione: {
    nome: string;
    email?: string | null;
    telefono?: string | null;
    partita_iva?: string | null;
    indirizzo?: string | null;
  };
  cliente: {
    denominazione: string;
    partita_iva?: string | null;
    codice_fiscale?: string | null;
    indirizzo?: string | null;
    citta?: string | null;
    cap?: string | null;
    provincia?: string | null;
  } | null;
  categorie: Categoria[];
};

const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("it-IT") : "-");

// Latin-1 sanitization for standard Helvetica (no full Unicode).
function s(x: string | null | undefined): string {
  if (!x) return "";
  return String(x).replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "?");
}

export async function generatePreventivoPdf(input: PreventivoPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4 = { w: 595.28, h: 841.89 };
  const margin = 40;
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - margin;

  const addPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - margin;
    drawWatermark();
  };

  const drawWatermark = () => {
    let wm: string | null = null;
    if (!input.preventivo.is_current_version) wm = "VERSIONE SUPERATA";
    else if (input.preventivo.stato === "annullato") wm = "ANNULLATO";
    else if (input.preventivo.stato === "bozza") wm = "BOZZA";
    if (!wm) return;
    page.drawText(wm, {
      x: 80, y: A4.h / 2, size: 72, font: bold, color: rgb(0.85, 0.85, 0.85),
      rotate: degrees(30), opacity: 0.35,
    });
  };
  drawWatermark();

  const line = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number } = {}) => {
    const size = opts.size ?? 10;
    if (y < margin + 40) addPage();
    page.drawText(s(text), {
      x: opts.x ?? margin, y,
      size, font: opts.bold ? bold : font,
      color: opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.15),
    });
    y -= size + 4;
  };
  const spacer = (h = 6) => { y -= h; };
  const hr = () => {
    if (y < margin + 20) addPage();
    page.drawLine({ start: { x: margin, y }, end: { x: A4.w - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.75) });
    y -= 8;
  };

  // Header
  line(input.organizzazione.nome, { size: 16, bold: true });
  const orgLine = [
    input.organizzazione.indirizzo,
    input.organizzazione.partita_iva ? `P.IVA ${input.organizzazione.partita_iva}` : null,
    input.organizzazione.email,
    input.organizzazione.telefono,
  ].filter(Boolean).join(" · ");
  if (orgLine) line(orgLine, { size: 9, color: [0.4, 0.4, 0.45] });
  spacer(4);
  hr();

  // Titolo preventivo
  line(`PREVENTIVO ${input.preventivo.numero} · v${input.preventivo.versione}`, { size: 14, bold: true });
  line(input.preventivo.titolo || input.preventivo.oggetto, { size: 11, bold: true });
  line(`Data: ${dt(input.preventivo.data_preventivo)}   Validità: ${dt(input.preventivo.data_validita)}   Stato: ${input.preventivo.stato}`, { size: 9, color: [0.4, 0.4, 0.45] });
  spacer(6);

  // Cliente
  if (input.cliente) {
    line("Cliente", { size: 10, bold: true });
    line(input.cliente.denominazione);
    const addr = [input.cliente.indirizzo, [input.cliente.cap, input.cliente.citta, input.cliente.provincia].filter(Boolean).join(" ")].filter(Boolean).join(" - ");
    if (addr) line(addr, { size: 9 });
    const fisc = [input.cliente.partita_iva ? `P.IVA ${input.cliente.partita_iva}` : null, input.cliente.codice_fiscale ? `CF ${input.cliente.codice_fiscale}` : null].filter(Boolean).join(" · ");
    if (fisc) line(fisc, { size: 9 });
    spacer(6);
  }
  hr();

  // Voci per categoria
  const colX = { desc: margin, qty: 320, um: 360, prezzo: 395, sconto: 445, netto: 495 };
  const drawVociHeader = () => {
    if (y < margin + 40) addPage();
    page.drawText("Descrizione", { x: colX.desc, y, size: 9, font: bold });
    page.drawText("Q.tà", { x: colX.qty, y, size: 9, font: bold });
    page.drawText("UM", { x: colX.um, y, size: 9, font: bold });
    page.drawText("Prezzo", { x: colX.prezzo, y, size: 9, font: bold });
    page.drawText("Sc.%", { x: colX.sconto, y, size: 9, font: bold });
    page.drawText("Netto", { x: colX.netto, y, size: 9, font: bold });
    y -= 12;
    hr();
  };

  for (const cat of input.categorie) {
    if (y < margin + 60) addPage();
    line(cat.titolo, { size: 11, bold: true, color: [0.1, 0.2, 0.5] });
    if (cat.descrizione) line(cat.descrizione, { size: 9, color: [0.4, 0.4, 0.45] });
    drawVociHeader();
    for (const v of cat.voci) {
      if (y < margin + 30) { addPage(); drawVociHeader(); }
      const desc = s(v.descrizione);
      // wrap descrizione a ~50 chars
      const chunks = desc.match(/.{1,55}(\s|$)/g) ?? [desc];
      page.drawText(chunks[0] ?? "", { x: colX.desc, y, size: 9, font });
      page.drawText(String(Number(v.quantita).toFixed(2)), { x: colX.qty, y, size: 9, font });
      page.drawText(s(v.unita_misura ?? ""), { x: colX.um, y, size: 9, font });
      page.drawText(eur(v.prezzo_unitario), { x: colX.prezzo, y, size: 9, font });
      page.drawText(String(Number(v.sconto_pct).toFixed(0)), { x: colX.sconto, y, size: 9, font });
      page.drawText(eur(v.importo_netto), { x: colX.netto, y, size: 9, font });
      y -= 12;
      for (let i = 1; i < chunks.length; i++) {
        if (y < margin + 20) { addPage(); drawVociHeader(); }
        page.drawText(chunks[i] ?? "", { x: colX.desc, y, size: 9, font });
        y -= 12;
      }
    }
    spacer(2);
    line(`Subtotale ${cat.titolo}: ${eur(cat.subtotale_ricavo)}`, { size: 10, bold: true });
    spacer(6);
  }

  hr();
  // Totali
  const totRight = (label: string, value: string, b = false) => {
    if (y < margin + 20) addPage();
    page.drawText(label, { x: 340, y, size: 10, font: b ? bold : font });
    page.drawText(value, { x: 480, y, size: 10, font: b ? bold : font });
    y -= 14;
  };
  totRight("Imponibile", eur(input.preventivo.totale_ricavo));
  if (input.preventivo.sconto_globale_pct) totRight(`Sconto globale ${input.preventivo.sconto_globale_pct}%`, "");
  if (input.preventivo.maggiorazione_globale_pct) totRight(`Magg. globale ${input.preventivo.maggiorazione_globale_pct}%`, "");
  if (input.preventivo.spese_accessorie) totRight("Spese accessorie", eur(input.preventivo.spese_accessorie));
  totRight("IVA", eur(input.preventivo.totale_iva));
  totRight("TOTALE", eur(input.preventivo.totale), true);
  spacer(8);

  const block = (title: string, body?: string | null) => {
    if (!body) return;
    if (y < margin + 60) addPage();
    line(title, { size: 10, bold: true });
    for (const raw of body.split("\n")) {
      const wrapped = raw.match(/.{1,95}(\s|$)/g) ?? [raw];
      for (const w of wrapped) line(w, { size: 9 });
    }
    spacer(4);
  };
  block("Condizioni di pagamento", input.preventivo.condizioni_pagamento);
  block("Tempi di esecuzione", input.preventivo.tempi_esecuzione);
  block("Esclusioni", input.preventivo.esclusioni);
  block("Garanzie", input.preventivo.garanzie);
  block("Condizioni generali", input.preventivo.condizioni_generali);
  block("Note", input.preventivo.note);

  return await doc.save();
}
