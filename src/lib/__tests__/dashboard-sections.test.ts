import { describe, it, expect } from "vitest";
import {
  periodRange,
  inPeriodo,
  countDaApprovare,
  docScadenzaStato,
  commessaAlerts,
} from "@/lib/dashboard-model";

const today = new Date("2026-03-15T10:00:00Z");

describe("rapportini nel periodo", () => {
  const range = periodRange("7", today); // 2026-03-09 → 2026-03-15

  it("rapportino inviato nel periodo è conteggiato", () => {
    const rows = [
      { data: "2026-03-10", stato: "inviato" },
      { data: "2026-03-12", stato: "bozza" },
    ].filter((r) => inPeriodo(r.data, range));
    expect(countDaApprovare(rows)).toBe(1);
  });

  it("rapportino fuori periodo è escluso", () => {
    expect(inPeriodo("2026-02-01", range)).toBe(false);
    expect(inPeriodo("2026-03-16", range)).toBe(false);
    expect(inPeriodo(null, range)).toBe(false);
  });

  it("conteggio solo su stato inviato", () => {
    expect(
      countDaApprovare([{ stato: "approvato" }, { stato: "bozza" }, { stato: "inviato" }]),
    ).toBe(1);
  });
});

describe("commessa sospesa", () => {
  it("genera alert anche senza altre criticità", () => {
    const a = commessaAlerts(
      { stato: "sospesa", responsabile_id: "x", data_fine_prevista: "2026-12-31" },
      today,
    );
    expect(a.some((x) => x.code === "sospesa" && x.severity === "attenzione")).toBe(true);
  });
});

describe("documenti", () => {
  it("documento scaduto", () => expect(docScadenzaStato("2026-03-01", today)).toBe("scaduto"));
  it("documento in scadenza entro 30 giorni", () =>
    expect(docScadenzaStato("2026-03-20", today)).toBe("in_scadenza"));
  it("documento non in scadenza", () => expect(docScadenzaStato("2026-09-01", today)).toBe("ok"));
  it("documento senza scadenza", () => expect(docScadenzaStato(null, today)).toBeNull());
});
