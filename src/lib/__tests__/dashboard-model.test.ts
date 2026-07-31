import { describe, it, expect } from "vitest";
import { periodRange, daysUntil, commessaAlerts, sortByCriticita, auditLabel } from "@/lib/dashboard-model";

const today = new Date("2026-03-15T10:00:00Z");

describe("periodRange", () => {
  it("oggi", () => expect(periodRange("oggi", today)).toEqual({ from: "2026-03-15", to: "2026-03-15" }));
  it("7 giorni", () => expect(periodRange("7", today)).toEqual({ from: "2026-03-09", to: "2026-03-15" }));
  it("30 giorni", () => expect(periodRange("30", today).from).toBe("2026-02-14"));
  it("mese corrente", () => expect(periodRange("mese", today).from).toBe("2026-03-01"));
});

describe("daysUntil", () => {
  it("futuro", () => expect(daysUntil("2026-03-20", today)).toBe(5));
  it("passato", () => expect(daysUntil("2026-03-10", today)).toBe(-5));
  it("null", () => expect(daysUntil(null, today)).toBeNull();
  );
});

describe("commessaAlerts", () => {
  it("ignora commesse non attive", () => {
    expect(commessaAlerts({ stato: "completata", data_fine_prevista: "2020-01-01" }, today)).toEqual([]);
  });
  it("segnala ritardo come critico", () => {
    const a = commessaAlerts({ stato: "in_corso", data_fine_prevista: "2026-03-01", responsabile_id: "x" }, today);
    expect(a.some((x) => x.code === "scaduta" && x.severity === "critico")).toBe(true);
  });
  it("segnala budget superato", () => {
    const a = commessaAlerts(
      { stato: "in_corso", responsabile_id: "x", costi_previsti: 100, costi_sostenuti: 150 },
      today,
    );
    expect(a.some((x) => x.code === "budget_superato")).toBe(true);
  });
  it("segnala responsabile mancante", () => {
    const a = commessaAlerts({ stato: "pianificata" }, today);
    expect(a.some((x) => x.code === "senza_responsabile" && x.severity === "info")).toBe(true);
  });
  it("nessun alert per commessa sana", () => {
    const a = commessaAlerts(
      { stato: "in_corso", responsabile_id: "x", data_fine_prevista: "2026-12-31", costi_previsti: 100, costi_sostenuti: 10 },
      today,
    );
    expect(a).toEqual([]);
  });
});

describe("sortByCriticita", () => {
  it("mette prima i critici", () => {
    const rows = [
      { id: "a", alerts: [{ code: "x", label: "x", severity: "info" as const }] },
      { id: "b", alerts: [{ code: "y", label: "y", severity: "critico" as const }] },
    ];
    expect(sortByCriticita(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("auditLabel", () => {
  it("traduce azioni note", () => expect(auditLabel("rapportino.approved")).toBe("Rapportino approvato"));
  it("fallback leggibile", () => expect(auditLabel("foo.bar")).toBe("foo bar"));
});
