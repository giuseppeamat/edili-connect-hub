import { describe, it, expect } from "vitest";
import {
  bollaModificabile,
  bolleCapabilities,
  classificaDuplicati,
  collegamentoBadge,
  collegamentoStato,
  statoBadge,
  validaTestataArchivio,
} from "@/lib/bolle-archivio";

describe("collegamento rapportino", () => {
  it("bolla senza rapportino è non collegata", () => {
    expect(collegamentoStato({ rapportino_id: null })).toBe("non_collegata");
    expect(collegamentoBadge({ rapportino_id: null }).label).toBe("Non collegata");
  });
  it("bolla con rapportino è collegata", () => {
    expect(collegamentoStato({ rapportino_id: "r1" })).toBe("collegata");
    expect(collegamentoBadge({ rapportino_id: "r1" }).label).toBe("Collegata a rapportino");
  });
});

describe("badge stato", () => {
  it("archiviata prevale", () => {
    expect(statoBadge({ stato: "registrata", archived_at: "2026-01-01" }).label).toBe("Archiviata");
  });
  it("stati operativi", () => {
    expect(statoBadge({ stato: "da_verificare", archived_at: null }).label).toBe("Da verificare");
    expect(statoBadge({ stato: "verificata", archived_at: null }).label).toBe("Verificata");
    expect(statoBadge({ stato: "contabilizzata", archived_at: null }).label).toBe("Contabilizzata");
    expect(statoBadge({ stato: "annullata", archived_at: null }).label).toBe("Annullata");
  });
});

describe("permessi", () => {
  it("ruoli operativi possono gestire le bolle", () => {
    expect(bolleCapabilities(["capocantiere"])).toEqual({ canManage: true, canSeeEcon: false });
    expect(bolleCapabilities(["amministrazione"])).toEqual({ canManage: true, canSeeEcon: true });
  });
  it("operaio e cliente non possono", () => {
    expect(bolleCapabilities(["operaio"]).canManage).toBe(false);
    expect(bolleCapabilities([]).canManage).toBe(false);
  });
});

describe("modificabilità", () => {
  it("blocca annullate e archiviate", () => {
    expect(bollaModificabile({ stato: "registrata", archived_at: null })).toBe(true);
    expect(bollaModificabile({ stato: "annullata", archived_at: null })).toBe(false);
    expect(bollaModificabile({ stato: "registrata", archived_at: "2026-01-01" })).toBe(false);
  });
});

describe("duplicati", () => {
  it("separa stessa data dagli altri", () => {
    const res = classificaDuplicati(
      [
        { id: "a", numero_bolla: "123", data_bolla: "2026-09-01" },
        { id: "b", numero_bolla: "123", data_bolla: "2026-08-01" },
      ],
      "2026-09-01",
    );
    expect(res.certi.map((c) => c.id)).toEqual(["a"]);
    expect(res.possibili.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("validazione testata", () => {
  const base = { fornitore_id: "f1", numero_bolla: "123", data_bolla: "2026-09-01" };
  it("rapportino e commessa sono opzionali", () => {
    expect(validaTestataArchivio(base)).toBeNull();
  });
  it("campi obbligatori", () => {
    expect(validaTestataArchivio({ ...base, fornitore_id: null })).toBe("Seleziona il fornitore");
    expect(validaTestataArchivio({ ...base, numero_bolla: "  " })).toBe("Numero bolla obbligatorio");
    expect(validaTestataArchivio({ ...base, data_bolla: "" })).toBe("Data bolla obbligatoria");
  });
  it("cantiere richiede commessa coerente", () => {
    expect(validaTestataArchivio({ ...base, cantiere_id: "k1" })).toBe(
      "Seleziona prima la commessa",
    );
    expect(
      validaTestataArchivio({
        ...base,
        cantiere_id: "k1",
        commessa_id: "c1",
        cantiereCommessaId: "c2",
      }),
    ).toBe("Cantiere non coerente con la commessa");
  });
});
