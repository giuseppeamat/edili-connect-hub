import { describe, it, expect } from "vitest";
import {
  capabilitiesFor,
  commesseSelect,
  resolveDashboardContext,
  hasAnyRole,
} from "@/lib/dashboard-authz";

// ── Fake client Supabase RLS-like: ogni query DEVE essere scoped per tenant.
type Row = Record<string, any>;

function makeClient(db: { profiles: Row[]; user_roles: Row[]; commesse: Row[] }) {
  const calls: Array<{ table: string; filters: Record<string, any> }> = [];
  const q = (table: string) => {
    const filters: Record<string, any> = {};
    const rec = { table, filters };
    calls.push(rec);
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => {
        filters[k] = v;
        return api;
      },
      is: () => api,
      maybeSingle: async () => {
        const rows = apply(table, filters);
        return { data: rows[0] ?? null, error: null };
      },
      then: (res: any) => Promise.resolve({ data: apply(table, filters), error: null }).then(res),
    };
    return api;
  };
  const apply = (table: string, filters: Record<string, any>) =>
    ((db as any)[table] as Row[]).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
  return { client: { from: (t: string) => q(t) }, calls };
}

const DB = {
  profiles: [
    { id: "u-a", organization_id: "org-A", is_active: true },
    { id: "u-b", organization_id: "org-B", is_active: true },
    { id: "u-off", organization_id: "org-A", is_active: false },
    { id: "u-noorg", organization_id: null, is_active: true },
  ],
  user_roles: [
    { user_id: "u-a", organization_id: "org-A", role: "proprietario" },
    { user_id: "u-b", organization_id: "org-B", role: "capocantiere" },
    // ruolo residuo su un altro tenant: non deve essere raccolto
    { user_id: "u-a", organization_id: "org-B", role: "operaio" },
  ],
  commesse: [
    { id: "c1", organization_id: "org-A", codice: "A1" },
    { id: "c2", organization_id: "org-B", codice: "B1" },
  ],
};

describe("resolveDashboardContext — tenant", () => {
  it("1. organization_id non è accettato dal client (nessun parametro di input)", () => {
    expect(resolveDashboardContext.length).toBe(2); // (supabase, userId)
  });

  it("2. organization_id è derivato dal profilo dell'utente", async () => {
    const { client } = makeClient(DB);
    const ctx = await resolveDashboardContext(client, "u-a");
    expect(ctx.organizationId).toBe("org-A");
    expect(ctx.roles).toEqual(["proprietario"]);
  });

  it("3. profilo disattivato viene negato", async () => {
    const { client } = makeClient(DB);
    await expect(resolveDashboardContext(client, "u-off")).rejects.toThrow("Utente disattivato");
  });

  it("3b. organizzazione mancante viene negata", async () => {
    const { client } = makeClient(DB);
    await expect(resolveDashboardContext(client, "u-noorg")).rejects.toThrow("Organizzazione non trovata");
  });

  it("10. utente cross-tenant non riceve dati dell'altra organizzazione", async () => {
    const { client } = makeClient(DB);
    const ctxB = await resolveDashboardContext(client, "u-b");
    expect(ctxB.organizationId).toBe("org-B");
    const { data } = await (client.from("commesse") as any)
      .select("id")
      .eq("organization_id", ctxB.organizationId);
    expect(data.map((r: Row) => r.id)).toEqual(["c2"]);
    expect(JSON.stringify(data)).not.toContain("org-A");
  });

  it("10b. le query di contesto sono sempre filtrate per tenant", async () => {
    const { client, calls } = makeClient(DB);
    await resolveDashboardContext(client, "u-a");
    const roleCall = calls.find((c) => c.table === "user_roles")!;
    expect(roleCall.filters.organization_id).toBe("org-A");
  });
});

describe("capabilitiesFor — ruoli", () => {
  it("4. proprietario vede economia, audit e costi", () => {
    const c = capabilitiesFor(["proprietario"]);
    expect(c).toEqual({ canViewEconomics: true, canApprove: true, canReadAudit: true, canReadCosti: true });
  });

  it("5. capocantiere non vede economia", () => {
    const c = capabilitiesFor(["capocantiere"]);
    expect(c.canViewEconomics).toBe(false);
    expect(c.canApprove).toBe(true);
    expect(c.canReadAudit).toBe(false);
  });

  it("6. operaio non vede economia né audit né approvazioni", () => {
    const c = capabilitiesFor(["operaio"]);
    expect(c).toEqual({ canViewEconomics: false, canApprove: false, canReadAudit: false, canReadCosti: false });
  });

  it("7. ruolo non AUDIT non riceve il feed audit", () => {
    for (const r of ["ufficio_tecnico", "responsabile_commessa", "capocantiere", "operaio"]) {
      expect(capabilitiesFor([r]).canReadAudit).toBe(false);
    }
    expect(capabilitiesFor(["amministrazione"]).canReadAudit).toBe(true);
  });

  it("8. solo i ruoli COSTI accedono al conteggio manodopera aggregato", () => {
    expect(capabilitiesFor(["ufficio_tecnico"]).canReadCosti).toBe(false);
    expect(capabilitiesFor(["ufficio_tecnico"]).canViewEconomics).toBe(true);
    expect(capabilitiesFor(["amministratore"]).canReadCosti).toBe(true);
  });

  it("9. nessuna colonna economica nel select senza permesso", () => {
    const sel = commesseSelect(false);
    for (const col of ["costi_sostenuti", "costi_previsti", "budget_costi", "ricavi_previsti", "importo", "margine_previsto"]) {
      expect(sel).not.toContain(col);
    }
    expect(commesseSelect(true)).toContain("margine_previsto");
    // nessun costo individuale (tariffa/costo orario) è mai selezionato
    expect(commesseSelect(true)).not.toContain("costo_orario");
  });

  it("hasAnyRole ignora ruoli sconosciuti", () => {
    expect(hasAnyRole(["pippo"], ["proprietario"])).toBe(false);
  });
});
