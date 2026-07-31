import { describe, it, expect } from "vitest";
import {
  ERR_MIME,
  ERR_SIZE,
  MAX_FILE_SIZE,
  buildStoragePath,
  canPreview,
  documentoCapabilities,
  giorniAllaScadenza,
  isCategoriaValida,
  matchScadenzaFilter,
  sanitizeFileName,
  scadenzaLabel,
  scadenzaStato,
  sortByScadenza,
  validateFile,
} from "@/lib/documenti-model";

const TODAY = new Date("2026-07-31T10:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (n: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return iso(d);
};

describe("scadenze", () => {
  it("scaduto", () => {
    expect(scadenzaStato(plus(-5), TODAY)).toBe("scaduto");
    expect(scadenzaLabel(plus(-5), TODAY)).toBe("Scaduto da 5 giorni");
  });
  it("oggi", () => {
    expect(scadenzaStato(plus(0), TODAY)).toBe("in_scadenza");
    expect(scadenzaLabel(plus(0), TODAY)).toBe("Scade oggi");
  });
  it("domani", () => {
    expect(scadenzaLabel(plus(1), TODAY)).toBe("Scade domani");
    expect(giorniAllaScadenza(plus(1), TODAY)).toBe(1);
  });
  it("entro 7 giorni", () => {
    expect(scadenzaStato(plus(6), TODAY)).toBe("in_scadenza");
    expect(matchScadenzaFilter("7", plus(6), TODAY)).toBe(true);
    expect(matchScadenzaFilter("7", plus(9), TODAY)).toBe(false);
  });
  it("entro 30 giorni", () => {
    expect(scadenzaStato(plus(30), TODAY)).toBe("in_scadenza");
    expect(matchScadenzaFilter("30", plus(30), TODAY)).toBe(true);
  });
  it("valido", () => {
    expect(scadenzaStato(plus(90), TODAY)).toBe("valido");
    expect(scadenzaLabel(plus(90), TODAY)).toBe("Scade tra 90 giorni");
  });
  it("senza scadenza", () => {
    expect(scadenzaStato(null, TODAY)).toBe("senza_scadenza");
    expect(scadenzaLabel(null, TODAY)).toBe("Senza scadenza");
    expect(matchScadenzaFilter("senza_scadenza", null, TODAY)).toBe(true);
  });
  it("ordinamento urgenti prima, senza scadenza in fondo", () => {
    const rows = [
      { id: "a", data_scadenza: null },
      { id: "b", data_scadenza: plus(10) },
      { id: "c", data_scadenza: plus(-3) },
    ];
    expect(sortByScadenza(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("file", () => {
  it("sanitizza il nome file", () => {
    expect(sanitizeFileName("../../Relazione Tecnica àé.PDF")).toBe("relazione-tecnica-ae.pdf");
    expect(sanitizeFileName("C:\\tmp\\a b.png")).toBe("a-b.png");
  });
  it("costruisce il path Storage", () => {
    expect(buildStoragePath("org1", "doc1", 2, "DURC 2026.pdf")).toBe("org1/doc1/2/durc-2026.pdf");
  });
  it("accetta MIME ammessi", () => {
    expect(
      validateFile({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1000 }),
    ).toEqual({ ok: true });
    expect(validateFile({ fileName: "a.png", mimeType: "image/png", fileSize: 1000 })).toEqual({
      ok: true,
    });
  });
  it("rifiuta MIME vietati e incoerenti", () => {
    expect(validateFile({ fileName: "a.svg", mimeType: "image/svg+xml", fileSize: 10 })).toEqual({
      ok: false,
      error: ERR_MIME,
    });
    expect(validateFile({ fileName: "a.exe", mimeType: "application/pdf", fileSize: 10 })).toEqual({
      ok: false,
      error: ERR_MIME,
    });
    expect(validateFile({ fileName: "a.pdf", mimeType: "image/png", fileSize: 10 })).toEqual({
      ok: false,
      error: ERR_MIME,
    });
  });
  it("rifiuta file troppo grandi", () => {
    expect(
      validateFile({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: MAX_FILE_SIZE + 1 }),
    ).toEqual({
      ok: false,
      error: ERR_SIZE,
    });
  });
  it("rifiuta doppia estensione sospetta", () => {
    expect(
      validateFile({ fileName: "fattura.exe.pdf", mimeType: "application/pdf", fileSize: 10 }),
    ).toEqual({
      ok: false,
      error: ERR_MIME,
    });
  });
  it("preview solo per formati supportati", () => {
    expect(canPreview("application/pdf")).toBe(true);
    expect(canPreview("image/vnd.dwg")).toBe(false);
    expect(canPreview(null)).toBe(false);
  });
  it("valida la categoria", () => {
    expect(isCategoriaValida("Sicurezza")).toBe(true);
    expect(isCategoriaValida("Inventata")).toBe(false);
    expect(isCategoriaValida(null)).toBe(true);
  });
});

describe("capability ruoli", () => {
  it("proprietario ha tutti i permessi", () => {
    expect(documentoCapabilities(["proprietario"])).toEqual({
      canUpload: true,
      canManage: true,
      canAdmin: true,
    });
  });
  it("capocantiere può caricare ma non gestire", () => {
    expect(documentoCapabilities(["capocantiere"])).toEqual({
      canUpload: true,
      canManage: false,
      canAdmin: false,
    });
  });
  it("operaio non può caricare", () => {
    expect(documentoCapabilities(["operaio"])).toEqual({
      canUpload: false,
      canManage: false,
      canAdmin: false,
    });
  });
  it("nessun ruolo = nessuna capability", () => {
    expect(documentoCapabilities([])).toEqual({
      canUpload: false,
      canManage: false,
      canAdmin: false,
    });
  });
});
