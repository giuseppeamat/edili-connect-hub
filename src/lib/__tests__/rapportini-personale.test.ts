import { describe, it, expect } from "vitest";
import {
  costoRiga,
  totaliPersonale,
  validaRighe,
  membroSelezionabile,
  richiedeRicalcolo,
  righeRicalcolabili,
  mascheraCosti,
  aggregaCosti,
  righeAttive,
  STATO_PERSONALE_LABEL,
  oreAnomale,
  slotOrari,
  slotPause,
  arrotondaSlot,
  oreDaSlot,
  type RigaPersonale,
} from "@/lib/rapportini-personale";

const riga = (p: Partial<RigaPersonale>): RigaPersonale => ({
  id: p.id ?? crypto.randomUUID(),
  membro_id: p.membro_id ?? "m1",
  membro_nome: p.membro_nome ?? "Mario Rossi",
  ore: p.ore ?? 8,
  stato_contabilizzazione: p.stato_contabilizzazione ?? "contabilizzato",
  tariffa_oraria_congelata: p.tariffa_oraria_congelata ?? 25,
  costo_congelato: p.costo_congelato ?? 200,
  annullato_at: p.annullato_at ?? null,
  nota: p.nota ?? null,
});

describe("costo singola riga", () => {
  it("calcola ore × tariffa arrotondato", () => {
    expect(costoRiga(8, 25)).toBe(200);
    expect(costoRiga(6, 22)).toBe(132);
    expect(costoRiga(7.33, 21.777)).toBe(159.63);
  });
  it("senza tariffa restituisce null", () => {
    expect(costoRiga(8, null)).toBeNull();
    expect(costoRiga(8, undefined)).toBeNull();
  });
});

describe("totali rapportino", () => {
  it("un solo operaio", () => {
    const t = totaliPersonale([riga({ ore: 8, costo_congelato: 200 })]);
    expect(t).toMatchObject({ persone: 1, ore_totali: 8, costo_totale: 200, contabilizzate: 1 });
  });

  it("più operai: somma ore e costi", () => {
    const t = totaliPersonale([
      riga({ membro_id: "m1", ore: 8, costo_congelato: 200 }),
      riga({ membro_id: "m2", ore: 6, costo_congelato: 132 }),
    ]);
    expect(t.persone).toBe(2);
    expect(t.ore_totali).toBe(14);
    expect(t.costo_totale).toBe(332);
  });

  it("esclude le righe annullate dal totale", () => {
    const t = totaliPersonale([
      riga({ membro_id: "m1", ore: 8, costo_congelato: 200 }),
      riga({ membro_id: "m2", ore: 6, costo_congelato: 132, stato_contabilizzazione: "annullato", annullato_at: "2026-08-04" }),
    ]);
    expect(t.persone).toBe(1);
    expect(t.ore_totali).toBe(8);
    expect(t.costo_totale).toBe(200);
  });

  it("le righe senza tariffa contano nelle ore ma non nel costo", () => {
    const t = totaliPersonale([
      riga({ membro_id: "m1", ore: 8, costo_congelato: 200 }),
      riga({ membro_id: "m3", ore: 5, stato_contabilizzazione: "tariffa_mancante", costo_congelato: null, tariffa_oraria_congelata: null }),
      riga({ membro_id: "m4", ore: 4, stato_contabilizzazione: "conflitto_tariffa", costo_congelato: null }),
    ]);
    expect(t.ore_totali).toBe(17);
    expect(t.costo_totale).toBe(200);
    expect(t.tariffa_mancante).toBe(1);
    expect(t.conflitto_tariffa).toBe(1);
    expect(t.contabilizzate).toBe(1);
  });

  it("rimozione singolo operaio: totale aggiornato senza toccare l'altro", () => {
    const righe = [
      riga({ membro_id: "m1", ore: 8, costo_congelato: 200 }),
      riga({ membro_id: "m2", ore: 6, costo_congelato: 132 }),
    ];
    const dopo = righe.map((r) =>
      r.membro_id === "m2" ? { ...r, stato_contabilizzazione: "annullato" as const, annullato_at: "x" } : r,
    );
    expect(totaliPersonale(dopo).costo_totale).toBe(200);
    expect(righeAttive(dopo)).toHaveLength(1);
  });

  it("annullamento rapportino: nessun costo residuo", () => {
    const righe = [riga({ membro_id: "m1" }), riga({ membro_id: "m2" })].map((r) => ({
      ...r, stato_contabilizzazione: "annullato" as const, annullato_at: "x",
    }));
    expect(totaliPersonale(righe)).toMatchObject({ persone: 0, ore_totali: 0, costo_totale: 0 });
  });
});

describe("validazione righe", () => {
  it("richiede almeno una persona", () => {
    expect(validaRighe([])).toMatch(/almeno una persona/);
  });
  it("blocca il membro duplicato", () => {
    expect(validaRighe([{ membro_id: "m1", ore: 8 }, { membro_id: "m1", ore: 4 }])).toMatch(/due volte/);
  });
  it("blocca ore nulle o negative", () => {
    expect(validaRighe([{ membro_id: "m1", ore: 0 }])).toMatch(/maggiori di zero/);
    expect(validaRighe([{ membro_id: "m1", ore: -3 }])).toMatch(/maggiori di zero/);
  });
  it("blocca ore oltre 24", () => {
    expect(validaRighe([{ membro_id: "m1", ore: 25 }])).toMatch(/massimo 24/);
  });
  it("accetta più persone valide", () => {
    expect(validaRighe([{ membro_id: "m1", ore: 8 }, { membro_id: "m2", ore: 6 }])).toBeNull();
  });
});

describe("selezione membri", () => {
  it("membro senza accesso (user_id nullo) è selezionabile", () => {
    expect(membroSelezionabile({ id: "m1", nome: "Luca", is_active: true })).toBe(true);
  });
  it("membro archiviato non è selezionabile", () => {
    expect(membroSelezionabile({ id: "m1", archived_at: "2026-01-01" })).toBe(false);
  });
  it("membro disattivato non è selezionabile", () => {
    expect(membroSelezionabile({ id: "m1", is_active: false })).toBe(false);
  });
  it("cross-tenant negato", () => {
    expect(membroSelezionabile({ id: "m1", is_active: true, organization_id: "orgB" }, "orgA")).toBe(false);
    expect(membroSelezionabile({ id: "m1", is_active: true, organization_id: "orgA" }, "orgA")).toBe(true);
  });
  it("autore diverso dagli operai: nessun membro implicito", () => {
    const righe = [riga({ membro_id: "operaio-1" }), riga({ membro_id: "operaio-2" })];
    expect(righe.some((r) => r.membro_id === "capocantiere-auth")).toBe(false);
  });
});

describe("ricalcolo e costo congelato", () => {
  it("modifica ore su riga contabilizzata richiede ricalcolo controllato", () => {
    expect(richiedeRicalcolo({ stato_contabilizzazione: "contabilizzato", ore: 8 }, 6)).toBe(true);
    expect(richiedeRicalcolo({ stato_contabilizzazione: "contabilizzato", ore: 8 }, 8)).toBe(false);
    expect(richiedeRicalcolo({ stato_contabilizzazione: "tariffa_mancante", ore: 8 }, 6)).toBe(false);
  });
  it("il costo congelato non cambia se la tariffa corrente cambia", () => {
    const r = riga({ ore: 8, tariffa_oraria_congelata: 25, costo_congelato: 200 });
    const tariffaCorrente = 30;
    expect(r.costo_congelato).toBe(200);
    expect(costoRiga(r.ore, tariffaCorrente)).toBe(240);
  });
  it("righe ricalcolabili: solo mancanti, conflitti e da contabilizzare", () => {
    const righe = [
      riga({ membro_id: "m1", stato_contabilizzazione: "contabilizzato" }),
      riga({ membro_id: "m2", stato_contabilizzazione: "tariffa_mancante" }),
      riga({ membro_id: "m3", stato_contabilizzazione: "conflitto_tariffa" }),
      riga({ membro_id: "m4", stato_contabilizzazione: "da_contabilizzare" }),
      riga({ membro_id: "m5", stato_contabilizzazione: "annullato", annullato_at: "x" }),
    ];
    expect(righeRicalcolabili(righe).map((r) => r.membro_id)).toEqual(["m2", "m3", "m4"]);
  });
  it("idempotenza: ricalcolare una riga già contabilizzata non la include", () => {
    const righe = [riga({ stato_contabilizzazione: "contabilizzato" })];
    expect(righeRicalcolabili(righe)).toHaveLength(0);
  });
  it("tariffa futura o scaduta equivale a tariffa mancante", () => {
    const t = totaliPersonale([
      riga({ ore: 8, stato_contabilizzazione: "tariffa_mancante", costo_congelato: null }),
    ]);
    expect(t.costo_totale).toBe(0);
    expect(STATO_PERSONALE_LABEL.tariffa_mancante).toBe("Tariffa mancante");
  });
});

describe("permessi economici", () => {
  it("la maschera rimuove tariffa e costo", () => {
    const out = mascheraCosti([riga({ tariffa_oraria_congelata: 25, costo_congelato: 200 })]);
    expect(out[0]?.tariffa_oraria_congelata).toBeNull();
    expect(out[0]?.costo_congelato).toBeNull();
    expect(out[0]?.ore).toBe(8);
    expect(out[0]?.stato_contabilizzazione).toBe("contabilizzato");
  });
});

describe("aggregati", () => {
  const costi = [
    { commessa_id: "c1", cantiere_id: "k1", fase_id: "f1", membro_id: "m1", data: "2026-08-01", costo: 200 },
    { commessa_id: "c1", cantiere_id: "k1", fase_id: "f1", membro_id: "m2", data: "2026-08-01", costo: 132 },
    { commessa_id: "c1", cantiere_id: "k2", fase_id: "f2", membro_id: "m1", data: "2026-08-02", costo: 100 },
    { commessa_id: "c2", cantiere_id: "k3", fase_id: "f3", membro_id: "m3", data: "2026-08-02", costo: 50 },
  ];
  it("per commessa", () => {
    expect(aggregaCosti(costi, (r) => r.commessa_id, (r) => r.costo)).toEqual({ c1: 432, c2: 50 });
  });
  it("per cantiere", () => {
    expect(aggregaCosti(costi, (r) => r.cantiere_id, (r) => r.costo)).toEqual({ k1: 332, k2: 100, k3: 50 });
  });
  it("per persona e per giornata, senza duplicazioni", () => {
    expect(aggregaCosti(costi, (r) => r.membro_id, (r) => r.costo)).toEqual({ m1: 300, m2: 132, m3: 50 });
    expect(aggregaCosti(costi, (r) => r.data, (r) => r.costo)).toEqual({ "2026-08-01": 332, "2026-08-02": 150 });
    const tot = Object.values(aggregaCosti(costi, (r) => r.commessa_id, (r) => r.costo)).reduce((a, b) => a + b, 0);
    expect(tot).toBe(482);
  });
  it("per fase", () => {
    expect(aggregaCosti(costi, (r) => r.fase_id, (r) => r.costo)).toEqual({ f1: 332, f2: 100, f3: 50 });
  });
});

describe("ore anomale per persona", () => {
  it("multi-operaio: 24h totali su 3 persone non è anomalo", () => {
    expect(oreAnomale({ ore: 24, persone: 3, ore_max_persona: 8 })).toBe(false);
  });
  it("una persona oltre 16h è anomala anche in un rapportino multiplo", () => {
    expect(oreAnomale({ ore: 30, persone: 3, ore_max_persona: 18 })).toBe(true);
  });
  it("senza righe personale vale il totale di testata", () => {
    expect(oreAnomale({ ore: 18, persone: 0 })).toBe(true);
    expect(oreAnomale({ ore: 8, persone: 0 })).toBe(false);
  });
  it("senza ore massime usa la media per persona", () => {
    expect(oreAnomale({ ore: 24, persone: 3 })).toBe(false);
    expect(oreAnomale({ ore: 51, persone: 3 })).toBe(true);
  });
});

describe("slot da 30 minuti", () => {
  it("genera 48 slot giornalieri", () => {
    const s = slotOrari(30);
    expect(s).toHaveLength(48);
    expect(s[0]).toBe("00:00");
    expect(s[1]).toBe("00:30");
    expect(s[47]).toBe("23:30");
  });
  it("arrotonda allo slot più vicino", () => {
    expect(arrotondaSlot("08:10")).toBe("08:00");
    expect(arrotondaSlot("08:20")).toBe("08:30");
    expect(arrotondaSlot("23:59")).toBe("23:30");
  });
  it("pause solo a multipli di 30", () => {
    expect(slotPause(120, 30)).toEqual([0, 30, 60, 90, 120]);
  });
  it("calcola le ore nette al netto della pausa", () => {
    expect(oreDaSlot("08:00", "17:00", 60)).toBe(8);
    expect(oreDaSlot("08:00", "12:30", 30)).toBe(4);
    expect(oreDaSlot("08:00", "08:00", 0)).toBeNull();
    expect(oreDaSlot(null, "12:00", 0)).toBeNull();
  });
});
