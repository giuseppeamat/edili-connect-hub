import { describe, it, expect } from "vitest";
import {
  ERR_NON_RICONOSCIUTO,
  MSG_TOTALI_DA_VERIFICARE,
  estrazioneUtile,
  livelloConfidenza,
  matchFornitore,
  matchMateriale,
  normalizzaPiva,
  normalizzaRagioneSociale,
  parseDataIt,
  parseNumeroIt,
  richiedeOcr,
  rigaCoerente,
  verificaTotali,
} from "@/lib/bolle-estrazione";

describe("confidenza", () => {
  it("campo vuoto è sempre non riconosciuto", () => {
    expect(livelloConfidenza(null, 0.99)).toBe("bassa");
    expect(livelloConfidenza("   ", 0.99)).toBe("bassa");
  });
  it("soglie alta/media/bassa", () => {
    expect(livelloConfidenza("123", 0.9)).toBe("alta");
    expect(livelloConfidenza("123", 0.6)).toBe("media");
    expect(livelloConfidenza("123", 0.2)).toBe("bassa");
  });
});

describe("normalizzazioni", () => {
  it("ragione sociale senza forma societaria", () => {
    expect(normalizzaRagioneSociale("Edilizia Rossi S.r.l.")).toBe(
      normalizzaRagioneSociale("EDILIZIA ROSSI SRL"),
    );
  });
  it("partita iva con prefisso IT", () => {
    expect(normalizzaPiva("IT 01234567890")).toBe("01234567890");
  });
  it("numeri in formato italiano e internazionale", () => {
    expect(parseNumeroIt("1.234,56")).toBeCloseTo(1234.56);
    expect(parseNumeroIt("1,234.56")).toBeCloseTo(1234.56);
    expect(parseNumeroIt("€ 90,00")).toBeCloseTo(90);
    expect(parseNumeroIt("")).toBeNull();
  });
  it("date italiane e ISO", () => {
    expect(parseDataIt("05/09/2026")).toBe("2026-09-05");
    expect(parseDataIt("5-9-26")).toBe("2026-09-05");
    expect(parseDataIt("2026-09-05")).toBe("2026-09-05");
    expect(parseDataIt("non una data")).toBeNull();
  });
});

describe("match fornitore", () => {
  const forn = [
    { id: "a", ragione_sociale: "Edilizia Rossi S.r.l.", partita_iva: "01234567890" },
    { id: "b", ragione_sociale: "Ferramenta Bianchi SNC", partita_iva: "09876543210" },
  ];
  it("la partita IVA ha priorità", () => {
    const m = matchFornitore({ partita_iva: "IT01234567890", ragione_sociale: "Altro" }, forn);
    expect(m).toEqual({ fornitore_id: "a", criterio: "partita_iva", confidence: 0.98 });
  });
  it("ragione sociale esatta normalizzata", () => {
    const m = matchFornitore({ ragione_sociale: "EDILIZIA ROSSI SRL" }, forn);
    expect(m.fornitore_id).toBe("a");
    expect(m.criterio).toBe("ragione_sociale");
  });
  it("nessun match non inventa un fornitore", () => {
    expect(matchFornitore({ ragione_sociale: "Sconosciuta SpA" }, forn)).toEqual({
      fornitore_id: null,
      criterio: "nessuno",
      confidence: 0,
    });
  });
});

describe("match materiale", () => {
  const mat = [
    { id: "m1", nome: "Cemento 32.5", codice: "CEM325" },
    { id: "m2", nome: "Sabbia lavata", codice: "SAB01" },
  ];
  it("il codice articolo ha priorità", () => {
    expect(matchMateriale({ codice_articolo: "cem325" }, mat).materiale_id).toBe("m1");
  });
  it("descrizione esatta", () => {
    expect(matchMateriale({ descrizione: "SABBIA LAVATA" }, mat).materiale_id).toBe("m2");
  });
  it("descrizione ignota resta senza materiale", () => {
    expect(matchMateriale({ descrizione: "Boiacca speciale" }, mat).materiale_id).toBeNull();
  });
});

describe("coerenza matematica", () => {
  it("riga coerente con sconto", () => {
    expect(
      rigaCoerente({ quantita: 10, prezzo_unitario: 10, sconto_pct: 10, totale_riga: 90 }),
    ).toBe(true);
    expect(rigaCoerente({ quantita: 10, prezzo_unitario: 10, totale_riga: 150 })).toBe(false);
  });
  it("dati mancanti non sono un errore", () => {
    expect(rigaCoerente({ quantita: null, prezzo_unitario: 10, totale_riga: 90 })).toBe(true);
  });
  it("differenza sui totali produce un avviso, non un blocco", () => {
    const r = [{ totale_riga: 100 }];
    expect(verificaTotali(r, 100).avviso).toBeNull();
    const ko = verificaTotali(r, 500);
    expect(ko.ok).toBe(false);
    expect(ko.avviso).toBe(MSG_TOTALI_DA_VERIFICARE);
    expect(ko.sommaRighe).toBe(100);
  });
  it("senza totale documento non si avvisa", () => {
    expect(verificaTotali([{ totale_riga: 10 }], null).ok).toBe(true);
  });
});

describe("qualità estrazione", () => {
  it("poco testo significa scansione da leggere con OCR", () => {
    expect(richiedeOcr("poche parole")).toBe(true);
    expect(richiedeOcr("x".repeat(250))).toBe(false);
  });
  it("serve almeno numero o fornitore", () => {
    const vuoto = {
      numero_bolla: { value: null, confidence: 0 },
      fornitore_ragione_sociale: { value: "", confidence: 0 },
    };
    expect(estrazioneUtile(vuoto)).toBe(false);
    expect(
      estrazioneUtile({ ...vuoto, numero_bolla: { value: "123", confidence: 0.9 } }),
    ).toBe(true);
    expect(ERR_NON_RICONOSCIUTO).toContain("bolla");
  });
});
