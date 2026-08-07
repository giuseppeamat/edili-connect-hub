import { describe, it, expect } from "vitest";
import {
  quotaAnnua,
  costoAttivoNellAnno,
  totaleAnnualizzato,
  totaliPerCategoria,
  oreProduttiveAnnue,
  oreNonProduttivePerPersona,
  costoOrarioStruttura,
  costoIndustrialeOrario,
  costoPersonaleMedio,
  calcolaCostoStrutturaPreventivo,
  riepilogoPreventivo,
  prossimaVersione,
  versioneApplicabile,
  isVersioneModificabile,
  simulaCostoOrario,
  variazionePct,
  andamentoMensile,
  canReadCostiStruttura,
  canWriteCostiStruttura,
  ORE_CONFIG_DEFAULT,
  type CostoStrutturaInput,
} from "@/lib/costi-struttura";

const c = (o: Partial<CostoStrutturaInput>): CostoStrutturaInput => ({
  importo: 0,
  periodicita: "mensile",
  anno_riferimento: 2026,
  ...o,
});

describe("annualizzazione (FASE 5)", () => {
  it("mensile × 12", () => {
    expect(quotaAnnua(c({ importo: 1000, periodicita: "mensile" }))).toBe(12000);
  });
  it("trimestrale × 4", () => {
    expect(quotaAnnua(c({ importo: 1000, periodicita: "trimestrale" }))).toBe(4000);
  });
  it("semestrale × 2", () => {
    expect(quotaAnnua(c({ importo: 1500, periodicita: "semestrale" }))).toBe(3000);
  });
  it("annuale invariato", () => {
    expect(quotaAnnua(c({ importo: 2400, periodicita: "annuale" }))).toBe(2400);
  });
  it("una tantum imputata all'anno", () => {
    expect(quotaAnnua(c({ importo: 5000, periodicita: "una_tantum" }))).toBe(5000);
  });
  it("ammortizzato: importo / anni", () => {
    expect(
      quotaAnnua(c({ importo: 30000, periodicita: "ammortizzato", anni_ammortamento: 5 })),
    ).toBe(6000);
  });
  it("ammortizzato con valore residuo", () => {
    expect(
      quotaAnnua(
        c({ importo: 30000, periodicita: "ammortizzato", anni_ammortamento: 5, valore_residuo: 5000 }),
      ),
    ).toBe(5000);
  });
  it("ammortizzato senza anni → 0 (nessuna divisione per zero)", () => {
    expect(quotaAnnua(c({ importo: 30000, periodicita: "ammortizzato", anni_ammortamento: 0 }))).toBe(0);
  });
});

describe("competenza per anno / no doppio conteggio", () => {
  it("una tantum solo nell'anno di riferimento", () => {
    const x = c({ importo: 5000, periodicita: "una_tantum", anno_riferimento: 2025 });
    expect(costoAttivoNellAnno(x, 2025)).toBe(true);
    expect(costoAttivoNellAnno(x, 2026)).toBe(false);
  });
  it("ammortizzato attivo per la durata", () => {
    const x = c({
      importo: 30000,
      periodicita: "ammortizzato",
      anni_ammortamento: 3,
      data_inizio_ammortamento: "2025-01-01",
    });
    expect(costoAttivoNellAnno(x, 2025)).toBe(true);
    expect(costoAttivoNellAnno(x, 2027)).toBe(true);
    expect(costoAttivoNellAnno(x, 2028)).toBe(false);
  });
  it("ricorrente rispetta data_fine", () => {
    const x = c({ importo: 100, data_inizio: "2024-01-01", data_fine: "2025-12-31" });
    expect(costoAttivoNellAnno(x, 2025)).toBe(true);
    expect(costoAttivoNellAnno(x, 2026)).toBe(false);
  });
  it("costo archiviato o disattivo escluso", () => {
    expect(costoAttivoNellAnno(c({ importo: 100, archived_at: "2026-01-01" }), 2026)).toBe(false);
    expect(costoAttivoNellAnno(c({ importo: 100, is_active: false }), 2026)).toBe(false);
  });
  it("personale diretto escluso di default (già nei rapportini)", () => {
    const costi = [
      c({ importo: 1000, periodicita: "mensile" }),
      c({ importo: 2000, periodicita: "mensile", tipo_personale: "diretto" }),
    ];
    expect(totaleAnnualizzato(costi, 2026)).toBe(12000);
    expect(totaleAnnualizzato(costi, 2026, { includiPersonaleDiretto: true })).toBe(36000);
  });
});

describe("totale annualizzato e categorie", () => {
  const costi = [
    c({ importo: 1200, periodicita: "mensile", categoria_id: "affitti" }),
    c({ importo: 3600, periodicita: "annuale", categoria_id: "assicurazioni" }),
    c({ importo: 6000, periodicita: "una_tantum", anno_riferimento: 2026, categoria_id: "attrezzature" }),
  ];
  it("somma corretta", () => {
    expect(totaleAnnualizzato(costi, 2026)).toBe(14400 + 3600 + 6000);
  });
  it("ripartizione per categoria ordinata e percentuali", () => {
    const t = totaliPerCategoria(costi, 2026);
    expect(t[0]!.categoria_id).toBe("affitti");
    expect(t[0]!.totale).toBe(14400);
    expect(t.reduce((s, x) => s + x.percentuale, 0)).toBeCloseTo(100, 1);
  });
  it("nessun costo → 0", () => {
    expect(totaleAnnualizzato([], 2026)).toBe(0);
  });
});

describe("ore produttive (FASE 7)", () => {
  const cfg = {
    ...ORE_CONFIG_DEFAULT,
    dipendenti_produttivi: 5,
    ore_teoriche_persona: 2080,
    ore_ferie: 160,
    ore_permessi: 40,
    ore_festivita: 80,
    ore_malattia: 40,
    ore_formazione: 20,
    ore_amministrative: 0,
    ore_non_produttive_altre: 20,
  };
  it("somma ore non produttive", () => {
    expect(oreNonProduttivePerPersona(cfg)).toBe(360);
  });
  it("ore produttive = (teoriche - assenze) × dipendenti", () => {
    expect(oreProduttiveAnnue(cfg)).toBe((2080 - 360) * 5);
  });
  it("inserimento manuale prevale", () => {
    expect(oreProduttiveAnnue({ ...cfg, usa_manuale: true, ore_produttive_manuali: 10000 })).toBe(10000);
  });
  it("mai negativo", () => {
    expect(oreProduttiveAnnue({ ...cfg, ore_teoriche_persona: 100 })).toBe(0);
  });
});

describe("costo orario struttura (FASE 8)", () => {
  it("300.000 / 10.000 = 30 €/h", () => {
    expect(costoOrarioStruttura(300000, 10000)).toBe(30);
  });
  it("divisione per zero → 0", () => {
    expect(costoOrarioStruttura(300000, 0)).toBe(0);
    expect(costoOrarioStruttura(300000, -5)).toBe(0);
    expect(Number.isFinite(costoOrarioStruttura(1, 0))).toBe(true);
  });
});

describe("costo industriale (FASE 9)", () => {
  const comp = { costoPersonaleMedio: 25, costoStruttura: 30, costoMezzi: 5, altriOverhead: 2 };
  it("somma solo componenti abilitate", () => {
    expect(
      costoIndustrialeOrario(comp, {
        includi_costo_personale_in_industriale: true,
        includi_costo_struttura_in_industriale: true,
        includi_costo_mezzi_in_industriale: false,
      }),
    ).toBe(57);
  });
  it("mezzi inclusi su richiesta", () => {
    expect(
      costoIndustrialeOrario(comp, {
        includi_costo_personale_in_industriale: true,
        includi_costo_struttura_in_industriale: true,
        includi_costo_mezzi_in_industriale: true,
      }),
    ).toBe(62);
  });
  it("media costo personale ignora tariffe nulle", () => {
    expect(costoPersonaleMedio([{ costo_orario: 20 }, { costo_orario: 30 }, { costo_orario: 0 }])).toBe(25);
    expect(costoPersonaleMedio([])).toBe(0);
  });
});

describe("preventivi (FASE 10/12)", () => {
  it("modalità €/ora", () => {
    expect(calcolaCostoStrutturaPreventivo({ modalita: "orario", ore: 120, tariffa: 30 })).toBe(3600);
  });
  it("modalità percentuale", () => {
    expect(
      calcolaCostoStrutturaPreventivo({ modalita: "percentuale", percentuale: 10, base_imponibile: 50000 }),
    ).toBe(5000);
  });
  it("modalità manuale", () => {
    expect(calcolaCostoStrutturaPreventivo({ modalita: "manuale", importo_manuale: 1234.56 })).toBe(1234.56);
  });
  it("nessuno → 0", () => {
    expect(calcolaCostoStrutturaPreventivo({ modalita: "nessuno", ore: 100, tariffa: 30 })).toBe(0);
  });
  it("costo struttura separato dalla manodopera nel riepilogo", () => {
    const r = riepilogoPreventivo({
      manodopera: 10000,
      materiali: 5000,
      mezzi: 1000,
      subappalti: 2000,
      altri: 500,
      costoStruttura: 3600,
      ricavo: 30000,
    });
    expect(r.costoTotale).toBe(22100);
    expect(r.margine).toBe(7900);
    expect(r.prezzoFinale).toBe(30000);
  });
  it("congelamento: il valore salvato non cambia se cambia la tariffa corrente", () => {
    const congelato = calcolaCostoStrutturaPreventivo({ modalita: "orario", ore: 100, tariffa: 30 });
    const nuovaTariffa = 45;
    const ricalcolato = calcolaCostoStrutturaPreventivo({ modalita: "orario", ore: 100, tariffa: nuovaTariffa });
    expect(congelato).toBe(3000);
    expect(ricalcolato).toBe(4500);
    expect(congelato).not.toBe(ricalcolato);
  });
});

describe("versionamento (FASE 11)", () => {
  const versioni = [
    { id: "a", anno: 2026, versione: 1, stato: "approvato" as const, costo_orario_struttura: 30 },
    { id: "b", anno: 2026, versione: 2, stato: "bozza" as const, costo_orario_struttura: 35 },
    { id: "c", anno: 2025, versione: 1, stato: "approvato" as const, costo_orario_struttura: 28 },
  ];
  it("prossima versione per anno", () => {
    expect(prossimaVersione(versioni, 2026)).toBe(3);
    expect(prossimaVersione(versioni, 2027)).toBe(1);
  });
  it("versione applicabile = ultima approvata dell'anno", () => {
    expect(versioneApplicabile(versioni, 2026)?.id).toBe("a");
    expect(versioneApplicabile(versioni, 2024)).toBeNull();
  });
  it("una versione approvata non è modificabile", () => {
    expect(isVersioneModificabile({ stato: "approvato" })).toBe(false);
    expect(isVersioneModificabile({ stato: "bozza" })).toBe(true);
    expect(isVersioneModificabile({ stato: "calcolato" })).toBe(true);
    expect(isVersioneModificabile({ stato: "archiviato" })).toBe(false);
  });
});

describe("simulatore (FASE 14)", () => {
  const costi = [c({ importo: 25000, periodicita: "mensile" })];
  const cfg = { ...ORE_CONFIG_DEFAULT, dipendenti_produttivi: 5, ore_teoriche_persona: 2000 };
  it("calcola senza modificare i dati reali", () => {
    const r = simulaCostoOrario({ costi, anno: 2026, oreConfig: cfg });
    expect(r.totaleAnnualizzato).toBe(300000);
    expect(r.oreProduttive).toBe(10000);
    expect(r.costoOrarioStruttura).toBe(30);
    expect(totaleAnnualizzato(costi, 2026)).toBe(300000);
  });
  it("assenteismo riduce le ore e alza il costo orario", () => {
    const r = simulaCostoOrario({ costi, anno: 2026, oreConfig: cfg, assenteismoPct: 20 });
    expect(r.oreProduttive).toBe(8000);
    expect(r.costoOrarioStruttura).toBe(37.5);
  });
  it("investimenti aggiuntivi aumentano il totale", () => {
    const r = simulaCostoOrario({ costi, anno: 2026, oreConfig: cfg, costiAggiuntivi: 50000 });
    expect(r.totaleAnnualizzato).toBe(350000);
    expect(r.costoOrarioStruttura).toBe(35);
  });
  it("idempotenza: stesso input, stesso output", () => {
    const a = simulaCostoOrario({ costi, anno: 2026, oreConfig: cfg, assenteismoPct: 10 });
    const b = simulaCostoOrario({ costi, anno: 2026, oreConfig: cfg, assenteismoPct: 10 });
    expect(a).toEqual(b);
  });
});

describe("dashboard (FASE 13)", () => {
  it("variazione anno precedente", () => {
    expect(variazionePct(110, 100)).toBe(10);
    expect(variazionePct(90, 100)).toBe(-10);
    expect(variazionePct(100, 0)).toBeNull();
  });
  it("andamento mensile in dodicesimi", () => {
    const m = andamentoMensile([c({ importo: 1000, periodicita: "mensile" })], 2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe(1000);
    expect(m.reduce((s, v) => s + v, 0)).toBeCloseTo(12000, 2);
  });
  it("una tantum imputata al mese indicato", () => {
    const m = andamentoMensile(
      [c({ importo: 6000, periodicita: "una_tantum", anno_riferimento: 2026, mese_riferimento: 3 })],
      2026,
    );
    expect(m[2]).toBe(6000);
    expect(m[0]).toBe(0);
  });
});

describe("permessi (FASE 17)", () => {
  it("lettura per proprietario, amministratore, amministrazione", () => {
    expect(canReadCostiStruttura(["amministrazione"])).toBe(true);
    expect(canReadCostiStruttura(["proprietario"])).toBe(true);
    expect(canReadCostiStruttura(["responsabile_commessa"])).toBe(false);
    expect(canReadCostiStruttura(["capocantiere"])).toBe(false);
    expect(canReadCostiStruttura(["operaio"])).toBe(false);
    expect(canReadCostiStruttura(["cliente"])).toBe(false);
    expect(canReadCostiStruttura(["fornitore"])).toBe(false);
    expect(canReadCostiStruttura([])).toBe(false);
  });
  it("scrittura solo proprietario e amministratore", () => {
    expect(canWriteCostiStruttura(["proprietario"])).toBe(true);
    expect(canWriteCostiStruttura(["amministratore"])).toBe(true);
    expect(canWriteCostiStruttura(["amministrazione"])).toBe(false);
    expect(canWriteCostiStruttura(["ufficio_tecnico"])).toBe(false);
  });
});
