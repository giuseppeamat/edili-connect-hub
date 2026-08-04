import { describe, expect, it } from "vitest";
import {
  costoCongelato,
  membroEffettivo,
  riepilogoRicalcolo,
  tariffeValide,
  valutaRapportino,
  type RapportinoRicalcolo,
  type TariffaMembro,
} from "@/lib/ricalcolo-costi";

const membri = [
  { id: "m1", user_id: "u1" },
  { id: "m2", user_id: null },
  { id: "m3", user_id: "u3", archived_at: "2026-01-01" },
];

const tariffa = (over: Partial<TariffaMembro> = {}): TariffaMembro => ({
  id: "t1",
  membro_id: "m1",
  costo_orario: 25,
  valido_dal: "2026-07-01",
  valido_al: null,
  archived_at: null,
  ...over,
});

const rap = (over: Partial<RapportinoRicalcolo> = {}): RapportinoRicalcolo => ({
  id: "r1",
  data: "2026-07-20",
  ore: 8,
  stato: "approvato",
  membro_id: "m1",
  user_id: "u1",
  ...over,
});

describe("membroEffettivo", () => {
  it("usa il membro del rapportino quando presente", () => {
    expect(membroEffettivo({ membro_id: "m2", user_id: "u1" }, membri)).toBe("m2");
  });
  it("risale al membro dall'account quando manca il collegamento", () => {
    expect(membroEffettivo({ membro_id: null, user_id: "u1" }, membri)).toBe("m1");
  });
  it("ignora i membri archiviati", () => {
    expect(membroEffettivo({ membro_id: null, user_id: "u3" }, membri)).toBeNull();
  });
});

describe("tariffeValide", () => {
  it("include la tariffa creata dopo ma valida alla data", () => {
    expect(tariffeValide([tariffa()], "m1", "2026-07-20")).toHaveLength(1);
  });
  it("esclude la tariffa futura", () => {
    expect(tariffeValide([tariffa({ valido_dal: "2026-08-01" })], "m1", "2026-07-20")).toHaveLength(0);
  });
  it("esclude la tariffa scaduta", () => {
    expect(tariffeValide([tariffa({ valido_al: "2026-07-10" })], "m1", "2026-07-20")).toHaveLength(0);
  });
  it("esclude le tariffe archiviate", () => {
    expect(tariffeValide([tariffa({ archived_at: "2026-07-15" })], "m1", "2026-07-20")).toHaveLength(0);
  });
  it("non attribuisce la tariffa di un altro membro", () => {
    expect(tariffeValide([tariffa({ membro_id: "m2" })], "m1", "2026-07-20")).toHaveLength(0);
  });
});

describe("costoCongelato", () => {
  it("calcola ore × tariffa al centesimo", () => {
    expect(costoCongelato(8, 25.5)).toBe(204);
    expect(costoCongelato(7.75, 23.333)).toBe(180.83);
  });
});

describe("valutaRapportino", () => {
  it("contabilizza con tariffa inserita successivamente", () => {
    const r = valutaRapportino(rap(), membri, [tariffa()]);
    expect(r.esito).toBe("contabilizzabile");
    expect(r.tariffa).toBe(25);
    expect(r.costo).toBe(200);
  });
  it("funziona per membro senza account con tariffa valida", () => {
    const r = valutaRapportino(rap({ membro_id: "m2", user_id: null }), membri, [
      tariffa({ membro_id: "m2", costo_orario: 30 }),
    ]);
    expect(r.esito).toBe("contabilizzabile");
    expect(r.costo).toBe(240);
  });
  it("segnala tariffa mancante senza modificare nulla", () => {
    const r = valutaRapportino(rap(), membri, []);
    expect(r.esito).toBe("tariffa_mancante");
    expect(r.costo).toBeNull();
  });
  it("segnala conflitto con due tariffe sovrapposte", () => {
    const r = valutaRapportino(rap(), membri, [tariffa(), tariffa({ id: "t2", costo_orario: 30 })]);
    expect(r.esito).toBe("conflitto_tariffa");
    expect(r.costo).toBeNull();
  });
  it("esclude i rapportini già contabilizzati", () => {
    const r = valutaRapportino(rap({ ha_costo_attivo: true }), membri, [tariffa()]);
    expect(r.esito).toBe("gia_contabilizzato");
  });
  it("esclude i rapportini annullati", () => {
    expect(valutaRapportino(rap({ stato: "annullato" }), membri, [tariffa()]).esito).toBe("annullato");
    expect(valutaRapportino(rap({ cancelled_at: "2026-07-25" }), membri, [tariffa()]).esito).toBe("annullato");
  });
  it("esclude i rapportini non approvati", () => {
    expect(valutaRapportino(rap({ stato: "inviato" }), membri, [tariffa()]).esito).toBe("escluso");
  });
  it("esclude i rapportini archiviati", () => {
    expect(valutaRapportino(rap({ archived_at: "2026-07-25" }), membri, [tariffa()]).esito).toBe("escluso");
  });
  it("è idempotente: dopo la contabilizzazione l'esito non genera nuovi costi", () => {
    const prima = valutaRapportino(rap(), membri, [tariffa()]);
    const dopo = valutaRapportino(rap({ ha_costo_attivo: true }), membri, [tariffa()]);
    expect(prima.esito).toBe("contabilizzabile");
    expect(dopo.esito).toBe("gia_contabilizzato");
    expect(dopo.costo).toBeNull();
  });
});

describe("riepilogoRicalcolo", () => {
  it("aggrega esiti e totale costo", () => {
    const righe = [
      valutaRapportino(rap(), membri, [tariffa()]),
      valutaRapportino(rap({ id: "r2", ore: 4 }), membri, [tariffa()]),
      valutaRapportino(rap({ id: "r3" }), membri, []),
      valutaRapportino(rap({ id: "r4", stato: "inviato" }), membri, [tariffa()]),
      valutaRapportino(rap({ id: "r5", ha_costo_attivo: true }), membri, [tariffa()]),
    ];
    const s = riepilogoRicalcolo(righe);
    expect(s.analizzati).toBe(5);
    expect(s.contabilizzabili).toBe(2);
    expect(s.senza_tariffa).toBe(1);
    expect(s.esclusi).toBe(1);
    expect(s.gia_contabilizzati).toBe(1);
    expect(s.totale_costo).toBe(300);
  });
});
