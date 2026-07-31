import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  dedupeKey,
  entityLabel,
  isRouteValida,
  isUnread,
  normalizeSeverita,
  safeRoute,
  sortNotifiche,
  tempoRelativo,
  tipoLabel,
  SEVERITA_LABELS,
  TIPI_NOTIFICA,
  type NotificaDTO,
} from "@/lib/notifiche-model";

const base: NotificaDTO = {
  id: "1",
  tipo: "rapportino_respinto",
  severita: "critica",
  titolo: "T",
  messaggio: null,
  entity_type: "rapportino",
  entity_id: "r1",
  route: "/rapportini/r1",
  created_at: new Date().toISOString(),
  read_at: null,
  archived_at: null,
};

describe("severità", () => {
  it("normalizza valori sconosciuti a info", () => {
    expect(normalizeSeverita("boom")).toBe("info");
    expect(normalizeSeverita("critica")).toBe("critica");
  });
  it("ha una label testuale per ogni severità (non solo colore)", () => {
    expect(SEVERITA_LABELS.critica).toBe("Critica");
    expect(SEVERITA_LABELS.attenzione).toBe("Attenzione");
    expect(SEVERITA_LABELS.info).toBe("Informazione");
  });
});

describe("label", () => {
  it("mappa tutti i tipi noti", () => {
    for (const t of TIPI_NOTIFICA) expect(tipoLabel(t)).not.toBe(t);
  });
  it("fa fallback sul tipo grezzo", () => {
    expect(tipoLabel("tipo_ignoto")).toBe("tipo_ignoto");
  });
  it("mappa le entità", () => {
    expect(entityLabel("commessa")).toBe("Commessa");
    expect(entityLabel(null)).toBe("—");
  });
});

describe("route", () => {
  it("accetta solo route interne note", () => {
    expect(isRouteValida("/rapportini/abc")).toBe(true);
    expect(isRouteValida("/costi-personale")).toBe(true);
    expect(isRouteValida("https://evil.example")).toBe(false);
    expect(isRouteValida("//evil.example")).toBe(false);
    expect(isRouteValida("/sconosciuta")).toBe(false);
    expect(isRouteValida(null)).toBe(false);
  });
  it("safeRoute restituisce null su route non valide", () => {
    expect(safeRoute("/documenti/x")).toBe("/documenti/x");
    expect(safeRoute("/altro")).toBeNull();
  });
});

describe("badge", () => {
  it("nasconde il badge a zero", () => expect(badgeLabel(0)).toBeNull());
  it("mostra il conteggio", () => expect(badgeLabel(7)).toBe("7"));
  it("tronca a 99+", () => {
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
    expect(badgeLabel(4213)).toBe("99+");
  });
});

describe("stato letto", () => {
  it("riconosce non letta", () => expect(isUnread(base)).toBe(true));
  it("riconosce letta", () => expect(isUnread({ ...base, read_at: "2026-01-01" })).toBe(false));
});

describe("tempo relativo", () => {
  const now = new Date("2026-07-31T12:00:00Z");
  it("adesso", () => expect(tempoRelativo("2026-07-31T11:59:40Z", now)).toBe("adesso"));
  it("minuti", () => expect(tempoRelativo("2026-07-31T11:30:00Z", now)).toBe("30 min fa"));
  it("ore", () => expect(tempoRelativo("2026-07-31T09:00:00Z", now)).toBe("3 ore fa"));
  it("giorni", () => expect(tempoRelativo("2026-07-25T12:00:00Z", now)).toBe("6 giorni fa"));
  it("data invalida", () => expect(tempoRelativo("nope", now)).toBe("—"));
});

describe("deduplicazione", () => {
  it("stessa chiave per stesso tipo/entità/destinatario", () => {
    expect(dedupeKey("documento_scaduto", "d1", "u1")).toBe(dedupeKey("documento_scaduto", "d1", "u1"));
  });
  it("destinatari diversi → chiavi diverse", () => {
    expect(dedupeKey("documento_scaduto", "d1", "u1")).not.toBe(
      dedupeKey("documento_scaduto", "d1", "u2"),
    );
  });
  it("periodi diversi → chiavi diverse (nuova notifica ammessa)", () => {
    expect(dedupeKey("budget_superato", "c1:2026-07", "u1")).not.toBe(
      dedupeKey("budget_superato", "c1:2026-08", "u1"),
    );
  });
});

describe("ordinamento", () => {
  it("non lette prima, poi severità, poi data", () => {
    const rows: NotificaDTO[] = [
      { ...base, id: "a", read_at: "2026-07-30T10:00:00Z", severita: "critica" },
      { ...base, id: "b", severita: "info", created_at: "2026-07-30T10:00:00Z" },
      { ...base, id: "c", severita: "critica", created_at: "2026-07-29T10:00:00Z" },
      { ...base, id: "d", severita: "attenzione", created_at: "2026-07-31T10:00:00Z" },
    ];
    expect(sortNotifiche(rows).map((r) => r.id)).toEqual(["c", "d", "b", "a"]);
  });
  it("non muta l'array originale", () => {
    const rows = [base];
    sortNotifiche(rows);
    expect(rows[0].id).toBe("1");
  });
});
