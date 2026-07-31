import { describe, it, expect } from "vitest";
import {
  costoManodopera, chiaveAggregazione, importoSostenuto, applicaStorno,
  esitoContabilizzazione, type RapportinoCosto,
} from "@/lib/manodopera-calc";
import { NONE_VALUE, toNullable, uniqueOptions, uniqueEntities } from "@/lib/select-options";

const riga = (id: string, ore: number, tariffa: number, stato: RapportinoCosto["stato"] = "contabilizzato"): RapportinoCosto =>
  ({ id, ore, costo_orario_applicato: tariffa, costo_totale: costoManodopera(ore, tariffa), stato });

describe("contabilizzazione manodopera", () => {
  it("8h × 25,50 = 204,00", () => expect(costoManodopera(8, 25.5)).toBe(204));
  it("4h × 25,50 = 102,00", () => expect(costoManodopera(4, 25.5)).toBe(102));

  it("aggrega 204 + 102 = 306 sulla stessa chiave", () => {
    const a = { commessa_id: "c", cantiere_id: "k", fase_id: "f", data: "2026-07-31" };
    const b = { ...a, data: "2026-07-02" };
    expect(chiaveAggregazione(a)).toBe(chiaveAggregazione(b));
    expect(importoSostenuto([riga("1", 8, 25.5), riga("2", 4, 25.5)])).toBe(306);
  });

  it("mesi diversi ⇒ chiavi diverse", () => {
    const a = { commessa_id: "c", cantiere_id: null, fase_id: null, data: "2026-07-31" };
    expect(chiaveAggregazione(a)).not.toBe(chiaveAggregazione({ ...a, data: "2026-08-01" }));
  });

  it("idempotenza: la stessa riga non incrementa due volte", () => {
    const costi = [riga("1", 8, 25.5)];
    expect(importoSostenuto(costi)).toBe(204);
    expect(importoSostenuto(costi)).toBe(204);
  });

  it("tariffa mancante ⇒ non_contabilizzato con warning", () => {
    expect(esitoContabilizzazione(null)).toEqual({
      stato: "non_contabilizzato",
      warning: "Non è presente una tariffa valida per la data del rapportino.",
    });
  });

  it("retry con tariffa valida ⇒ contabilizzato", () => {
    expect(esitoContabilizzazione(20).stato).toBe("contabilizzato");
    expect(costoManodopera(3, 20)).toBe(60);
  });

  it("costo congelato: una nuova tariffa non ricalcola lo storico", () => {
    const r = riga("1", 8, 25.5);
    const nuovaTariffa = 40;
    expect(r.costo_totale).toBe(204);
    expect(costoManodopera(r.ore, nuovaTariffa)).not.toBe(r.costo_totale);
    expect(importoSostenuto([r])).toBe(204);
  });

  it("storno 306 → 102 e secondo storno idempotente", () => {
    let costi = [riga("1", 8, 25.5), riga("2", 4, 25.5)];
    expect(importoSostenuto(costi)).toBe(306);
    costi = applicaStorno(costi, "1");
    expect(importoSostenuto(costi)).toBe(102);
    costi = applicaStorno(costi, "1");
    expect(importoSostenuto(costi)).toBe(102);
    expect(costi.length).toBe(2); // nessuna DELETE
  });
});

describe("select options", () => {
  it("dedupe: categorie costo+ricavo con 'altro' duplicato", () => {
    const opts = uniqueOptions([
      { value: "manodopera", label: "Manodopera" },
      { value: "altro", label: "Altro" },
      { value: "contratto", label: "Contratto" },
      { value: "altro", label: "Altro" },
    ]);
    expect(opts.map((o) => o.value)).toEqual(["manodopera", "altro", "contratto"]);
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
  });

  it("scarta option con value vuoto (niente duplicati di 'Nessuno')", () => {
    expect(uniqueEntities([{ id: "", label: "Nessuno" }, { id: "a", label: "A" }, { id: "a", label: "A bis" }]))
      .toEqual([{ id: "a", label: "A" }]);
  });

  it("mapping sentinel → null", () => {
    expect(toNullable(NONE_VALUE)).toBeNull();
    expect(toNullable("")).toBeNull();
    expect(toNullable(undefined)).toBeNull();
    expect(toNullable("uuid-1")).toBe("uuid-1");
  });
});
