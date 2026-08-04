import { describe, it, expect } from "vitest";
import {
  costiSostenutiCommessa,
  costiSostenutiTotali,
  manodoperaDaSommare,
  manodoperaPerCantiere,
  manodoperaPerCommessa,
  normalizzaPendente,
  type CostoManodoperaRow,
} from "@/lib/costi-propagazione";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const rows: CostoManodoperaRow[] = [
  { commessa_id: A, cantiere_id: "c1", costo: 1000, gia_nel_budget: false },
  { commessa_id: A, cantiere_id: "c2", costo: 160.5, gia_nel_budget: false },
  { commessa_id: A, cantiere_id: null, costo: "39.5", gia_nel_budget: false },
  { commessa_id: B, cantiere_id: "c9", costo: 500, gia_nel_budget: true },
];

describe("propagazione costi manodopera", () => {
  it("aggrega per commessa", () => {
    expect(manodoperaPerCommessa(rows)).toEqual({ [A]: 1200, [B]: 500 });
  });

  it("aggrega per cantiere di una commessa", () => {
    expect(manodoperaPerCantiere(rows, A)).toEqual({ c1: 1000, c2: 160.5, __senza_cantiere__: 39.5 });
  });

  it("non somma la manodopera già inclusa nel budget analitico", () => {
    expect(manodoperaDaSommare(rows)).toBe(1200);
    expect(manodoperaDaSommare(rows, [B])).toBe(0);
  });

  it("somma la manodopera una sola volta ai costi sostenuti", () => {
    const commesse = [
      { id: A, costi_sostenuti: 0 },
      { id: B, costi_sostenuti: 500 },
    ];
    expect(costiSostenutiTotali(commesse, rows)).toBe(1700);
  });

  it("calcola i costi sostenuti della singola commessa manuale", () => {
    expect(costiSostenutiCommessa({ id: A, costi_sostenuti: 250 }, rows)).toBe(1450);
  });

  it("è idempotente su input vuoti", () => {
    expect(manodoperaDaSommare([])).toBe(0);
    expect(costiSostenutiTotali([], [])).toBe(0);
  });

  it("normalizza il KPI pendente", () => {
    expect(normalizzaPendente([{ righe: 3, rapportini: 2, persone: 2 }])).toEqual({
      righe: 3,
      rapportini: 2,
      persone: 2,
    });
    expect(normalizzaPendente(null)).toEqual({ righe: 0, rapportini: 0, persone: 0 });
  });
});
