import { describe, it, expect } from "vitest";
import {
  totaleRiga,
  totaliBolla,
  validaRigheBolla,
  validaTestataBolla,
  importoSubappalto,
  validaSubappalto,
  riepilogoCosti,
  confrontoPrezzi, ultimiPrezziPerMateriale,
  rapportinoModificabile,
  bolleModificabili,
  BOLLE_ROLES_EDIT_EXTRA,
} from "@/lib/rapportini-extra";


const riga = (o: Partial<Parameters<typeof totaleRiga>[0]> = {}) => ({
  descrizione: "Cemento",
  quantita: 2,
  prezzo_unitario: 10,
  sconto_pct: 0,
  iva_pct: 22,
  ...o,
}) as any;

describe("bolle — calcoli", () => {
  it("calcola il totale riga con sconto", () => {
    expect(totaleRiga(riga())).toBe(20);
    expect(totaleRiga(riga({ sconto_pct: 10 }))).toBe(18);
  });

  it("restituisce null senza prezzo (ruolo non economico)", () => {
    expect(totaleRiga(riga({ prezzo_unitario: null }))).toBeNull();
  });

  it("somma imponibile, IVA e totale", () => {
    const t = totaliBolla([riga(), riga({ quantita: 1, prezzo_unitario: 100, iva_pct: 10 })]);
    expect(t.imponibile).toBe(120);
    expect(t.iva).toBe(14.4);
    expect(t.totale).toBe(134.4);
    expect(t.righe).toBe(2);
  });
});

describe("bolle — validazioni", () => {
  it("richiede almeno una riga valida", () => {
    expect(validaRigheBolla([])).toBeTruthy();
    expect(validaRigheBolla([riga({ descrizione: "" })])).toBeTruthy();
    expect(validaRigheBolla([riga({ quantita: 0 })])).toBeTruthy();
    expect(validaRigheBolla([riga()])).toBeNull();
  });

  it("richiede fornitore, numero e data in testata", () => {
    expect(validaTestataBolla({ fornitore_id: "", numero_bolla: "1", data_bolla: "2026-01-01" })).toBeTruthy();
    expect(validaTestataBolla({ fornitore_id: "f", numero_bolla: " ", data_bolla: "2026-01-01" })).toBeTruthy();
    expect(validaTestataBolla({ fornitore_id: "f", numero_bolla: "1", data_bolla: "" })).toBeTruthy();
    expect(validaTestataBolla({ fornitore_id: "f", numero_bolla: "1", data_bolla: "2026-01-01" })).toBeNull();
  });
});

describe("subappalti", () => {
  it("preferisce l'importo totale esplicito", () => {
    expect(importoSubappalto({ importo_totale: 500, quantita: 2, importo_unitario: 100 })).toBe(500);
  });

  it("calcola quantità per unitario quando manca il totale", () => {
    expect(importoSubappalto({ quantita: 2.5, importo_unitario: 40 })).toBe(100);
  });

  it("restituisce null senza dati economici", () => {
    expect(importoSubappalto({})).toBeNull();
  });

  it("valida ditta e lavorazione", () => {
    expect(validaSubappalto({ subappaltatore_id: "", lavorazione: "Posa" })).toBeTruthy();
    expect(validaSubappalto({ subappaltatore_id: "s", lavorazione: "" })).toBeTruthy();
    expect(validaSubappalto({ subappaltatore_id: "s", lavorazione: "Posa" })).toBeNull();
  });
});

describe("riepilogo costi giornata", () => {
  it("esclude bolle e righe annullate", () => {
    const r = riepilogoCosti({
      manodopera: 100,
      bolle: [{ imponibile: 50 }, { imponibile: 999, stato: "annullata" }],
      subappalti: [{ importo_congelato: 200 }, { importo_congelato: 999, annullato_at: "2026-01-01" }],
    });
    expect(r).toEqual({ manodopera: 100, materiali: 50, subappalti: 200, totale: 350 });
  });

  it("non conta due volte in assenza di dati", () => {
    expect(riepilogoCosti({}).totale).toBe(0);
  });
});

describe("confronto prezzi", () => {
  it("aggrega per fornitore e ordina dal più conveniente", () => {
    const res = confrontoPrezzi([
      { fornitore_id: "a", fornitore_nome: "Alfa", prezzo_unitario: 10, data_prezzo: "2026-01-01" },
      { fornitore_id: "a", fornitore_nome: "Alfa", prezzo_unitario: 12, data_prezzo: "2026-02-01" },
      { fornitore_id: "b", fornitore_nome: "Beta", prezzo_unitario: 9, data_prezzo: "2026-01-15" },
    ]);
    expect(res.map((r) => r.fornitore_id)).toEqual(["b", "a"]);
    const alfa = res.find((r) => r.fornitore_id === "a")!;
    expect(alfa.ultimo).toBe(12);
    expect(alfa.minimo).toBe(10);
    expect(alfa.medio).toBe(11);
    expect(alfa.rilevazioni).toBe(2);
  });
});

describe("modificabilità rapportino", () => {
  it("blocca archiviati, approvati e annullati", () => {
    expect(rapportinoModificabile(null)).toBe(false);
    expect(rapportinoModificabile({ archived_at: "2026-01-01", stato: "bozza" })).toBe(false);
    expect(rapportinoModificabile({ stato: "approvato" })).toBe(false);
    expect(rapportinoModificabile({ stato: "annullato" })).toBe(false);
    expect(rapportinoModificabile({ stato: "bozza" })).toBe(true);
  });
});

describe("modificabilità bolle", () => {
  it("permette bozza, inviato e respinto a tutti i ruoli edit-extra", () => {
    for (const stato of ["bozza", "inviato", "respinto"]) {
      for (const ruolo of BOLLE_ROLES_EDIT_EXTRA) {
        expect(bolleModificabili({ stato }, [ruolo])).toBe(true);
      }
    }
  });

  it("permette approvato solo ai ruoli operativi abilitati", () => {
    for (const ruolo of BOLLE_ROLES_EDIT_EXTRA) {
      expect(bolleModificabili({ stato: "approvato" }, [ruolo])).toBe(true);
    }
    expect(bolleModificabili({ stato: "approvato" }, ["operaio"])).toBe(false);
    expect(bolleModificabili({ stato: "approvato" }, ["cliente"])).toBe(false);
    expect(bolleModificabili({ stato: "approvato" }, [])).toBe(false);
  });

  it("blocca archiviati e annullati indipendentemente dal ruolo", () => {
    for (const ruolo of BOLLE_ROLES_EDIT_EXTRA) {
      expect(bolleModificabili({ stato: "bozza", archived_at: "2026-01-01" }, [ruolo])).toBe(false);
      expect(bolleModificabili({ stato: "annullato" }, [ruolo])).toBe(false);
      expect(bolleModificabili({ stato: "approvato", archived_at: "2026-01-01" }, [ruolo])).toBe(false);
    }
  });
});


describe("ultimiPrezziPerMateriale", () => {
  it("prende la rilevazione più recente per materiale e ignora righe senza materiale", () => {
    const r = ultimiPrezziPerMateriale([
      { materiale_id: "m1", prezzo_unitario: 10, data_prezzo: "2026-01-01", fornitore_nome: "A" },
      { materiale_id: "m1", prezzo_unitario: "12.345", data_prezzo: "2026-03-01", fornitore_nome: "B", unita_misura: "kg" },
      { materiale_id: null, prezzo_unitario: 99, data_prezzo: "2026-05-01" },
      { materiale_id: "m2", prezzo_unitario: 5, data_prezzo: "2026-02-01" },
    ]);
    expect(r["m1"]).toEqual({ prezzo: 12.35, data: "2026-03-01", fornitore: "B", unita_misura: "kg" });
    expect(r["m2"]!.prezzo).toBe(5);
    expect(Object.keys(r)).toHaveLength(2);
  });
});
