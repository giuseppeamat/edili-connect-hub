import { describe, it, expect } from "vitest";
import {
  CATEGORIA_FILTER_OPTIONS,
  CATEGORIE_LEGACY,
  ERR_CLEANUP_TOO_RECENT,
  canCleanupStorage,
  categoriaLabel,
  categorieSelezionabili,
  chainCoerente,
  chainTuttaArchiviata,
  chainTuttaAttiva,
  isCategoriaLegacy,
  isCategoriaValida,
  isOrphanObject,
  orphanCleanupAllowed,
  uploadReconciliation,
  versioneCorrente,
} from "@/lib/documenti-model";

const NOW = new Date("2026-07-31T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600000).toISOString();

describe("categorie", () => {
  it("preventivo è una categoria stabile della whitelist", () => {
    expect(isCategoriaValida("preventivo")).toBe(true);
    expect(isCategoriaLegacy("preventivo")).toBe(false);
    expect(categoriaLabel("preventivo")).toBe("Preventivo");
    expect(CATEGORIA_FILTER_OPTIONS).toContain("preventivo");
  });
  it("le categorie storiche restano valide e modificabili", () => {
    for (const c of CATEGORIE_LEGACY) {
      expect(isCategoriaValida(c)).toBe(true);
      expect(isCategoriaLegacy(c)).toBe(true);
      expect(CATEGORIA_FILTER_OPTIONS).toContain(c);
      expect(categorieSelezionabili(c)[0]).toBe(c);
    }
  });
  it("categoria inventata resta non valida", () => {
    expect(isCategoriaValida("Inventata")).toBe(false);
  });
  it("la select non duplica una categoria già in whitelist", () => {
    const opts = categorieSelezionabili("Sicurezza");
    expect(opts.filter((c) => c === "Sicurezza")).toHaveLength(1);
  });
});

describe("catena versioni", () => {
  const chain = [
    { id: "v1", versione: 1, is_versione_corrente: false, archived_at: null },
    { id: "v2", versione: 2, is_versione_corrente: true, archived_at: null },
  ];
  it("una sola versione corrente", () => {
    expect(versioneCorrente(chain)?.id).toBe("v2");
    expect(chainCoerente(chain)).toBe(true);
    expect(chainCoerente([{ ...chain[0], is_versione_corrente: true }, chain[1]])).toBe(false);
  });
  it("archiviazione dell'intera catena", () => {
    const arch = chain.map((v) => ({ ...v, archived_at: NOW.toISOString() }));
    expect(chainTuttaArchiviata(arch)).toBe(true);
    expect(chainTuttaArchiviata([arch[0], chain[1]])).toBe(false);
  });
  it("ripristino dell'intera catena mantiene la versione corrente", () => {
    const restored = chain.map((v) => ({ ...v, archived_at: null }));
    expect(chainTuttaAttiva(restored)).toBe(true);
    expect(versioneCorrente(restored)?.id).toBe("v2");
    expect(restored.find((v) => v.id === "v1")?.is_versione_corrente).toBe(false);
  });
});

describe("cleanup orfani", () => {
  const referenced = ["org/doc/1/a.pdf"];
  it("identifica un oggetto orfano", () => {
    expect(isOrphanObject("org/doc/2/b.pdf", referenced)).toBe(true);
  });
  it("un file referenziato non è orfano", () => {
    expect(isOrphanObject("org/doc/1/a.pdf", referenced)).toBe(false);
  });
  it("rispetta la soglia temporale di 24 ore", () => {
    expect(orphanCleanupAllowed(hoursAgo(2), NOW)).toEqual({
      ok: false,
      error: ERR_CLEANUP_TOO_RECENT,
    });
    expect(orphanCleanupAllowed(hoursAgo(30), NOW)).toEqual({ ok: true });
  });
  it("la forzatura QA esplicita bypassa la soglia", () => {
    expect(orphanCleanupAllowed(hoursAgo(1), NOW, true)).toEqual({ ok: true });
  });
  it("è idempotente: un path già rimosso resta non orfano-rimovibile", () => {
    expect(isOrphanObject("org/doc/2/b.pdf", [])).toBe(true);
    expect(isOrphanObject("org/doc/2/b.pdf", ["org/doc/2/b.pdf"])).toBe(false);
  });
  it("solo proprietario e amministratore possono fare cleanup", () => {
    expect(canCleanupStorage(["proprietario"])).toBe(true);
    expect(canCleanupStorage(["amministratore"])).toBe(true);
    for (const r of [
      "capocantiere",
      "operaio",
      "responsabile_commessa",
      "ufficio_tecnico",
      "amministrazione",
    ]) {
      expect(canCleanupStorage([r])).toBe(false);
    }
    expect(canCleanupStorage([])).toBe(false);
  });
});

describe("riconciliazione upload interrotti", () => {
  it("preparato recente senza file: non toccare", () => {
    expect(
      uploadReconciliation({
        upload_stato: "preparato",
        created_at: hoursAgo(2),
        hasFile: false,
        now: NOW,
      }),
    ).toBe("nessuna_azione");
  });
  it("preparato oltre soglia senza file: può passare a fallito", () => {
    expect(
      uploadReconciliation({
        upload_stato: "preparato",
        created_at: hoursAgo(48),
        hasFile: false,
        now: NOW,
      }),
    ).toBe("marca_fallito");
  });
  it("upload completato ma finalize fallito: ritentabile", () => {
    expect(
      uploadReconciliation({
        upload_stato: "preparato",
        created_at: hoursAgo(48),
        hasFile: true,
        now: NOW,
      }),
    ).toBe("finalizzabile");
  });
  it("documento disponibile: nessuna riconciliazione", () => {
    expect(
      uploadReconciliation({
        upload_stato: "disponibile",
        created_at: hoursAgo(48),
        hasFile: true,
        now: NOW,
      }),
    ).toBe("gia_disponibile");
  });
});
