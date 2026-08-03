import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_MEMBER_ROLES,
  canAssignRole,
  canInviteMember,
  canManageMembers,
  deriveAccessState,
  memberFullName,
  normalizeEmail,
  validateMemberInput,
} from "../organization-members-model";

describe("permessi membri", () => {
  it("solo proprietario e amministratore gestiscono i membri", () => {
    expect(canManageMembers(["proprietario"])).toBe(true);
    expect(canManageMembers(["amministratore"])).toBe(true);
    expect(canManageMembers(["capocantiere", "operaio"])).toBe(false);
  });

  it("il ruolo proprietario non è mai assegnabile", () => {
    expect(ASSIGNABLE_MEMBER_ROLES).not.toContain("proprietario");
    expect(canAssignRole("proprietario" as any, ["proprietario"])).toBe(false);
  });

  it("solo il proprietario può assegnare amministratore", () => {
    expect(canAssignRole("amministratore", ["proprietario"])).toBe(true);
    expect(canAssignRole("amministratore", ["amministratore"])).toBe(false);
    expect(canAssignRole("operaio", ["amministratore"])).toBe(true);
  });
});

describe("validazione anagrafica membro", () => {
  it("richiede il nome", () => {
    const r = validateMemberInput({ nome: "  ", ruolo_organizzativo: "operaio" }, ["proprietario"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("Il nome è obbligatorio");
  });

  it("accetta un membro senza email (senza accesso)", () => {
    const r = validateMemberInput({ nome: "Mario", ruolo_organizzativo: "operaio" }, ["proprietario"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBeNull();
  });

  it("normalizza l'email", () => {
    expect(normalizeEmail("  Mario.Rossi@Example.IT ")).toBe("mario.rossi@example.it");
    expect(normalizeEmail("   ")).toBeNull();
    const r = validateMemberInput(
      { nome: "Mario", email: " M.R@Example.IT ", ruolo_organizzativo: "operaio" },
      ["proprietario"],
    );
    expect(r.ok && r.value.email).toBe("m.r@example.it");
  });

  it("rifiuta email non valide", () => {
    const r = validateMemberInput(
      { nome: "Mario", email: "non-una-email", ruolo_organizzativo: "operaio" },
      ["proprietario"],
    );
    expect(r.ok).toBe(false);
  });

  it("blocca l'assegnazione di amministratore da parte di un amministratore", () => {
    const r = validateMemberInput(
      { nome: "Luca", ruolo_organizzativo: "amministratore" },
      ["amministratore"],
    );
    expect(r.ok).toBe(false);
  });
});

describe("stato accesso", () => {
  const base = { nome: "Mario", cognome: "Rossi" };

  it("senza account e senza invito = senza accesso", () => {
    expect(deriveAccessState({ ...base })).toBe("senza_accesso");
  });

  it("invito pendente valido = invitato", () => {
    const state = deriveAccessState(
      { ...base },
      { status: "pending", expires_at: new Date(Date.now() + 86400000).toISOString() },
    );
    expect(state).toBe("invitato");
  });

  it("invito pendente scaduto = invito scaduto", () => {
    const state = deriveAccessState(
      { ...base },
      { status: "pending", expires_at: new Date(Date.now() - 86400000).toISOString() },
    );
    expect(state).toBe("invito_scaduto");
  });

  it("lo stato accesso autorevole vince su user_id e is_active", () => {
    expect(deriveAccessState({ ...base, user_id: "u1", stato_accesso: "attivo" })).toBe("attivo");
    // is_active della persona NON determina lo stato accesso
    expect(deriveAccessState({ ...base, user_id: "u1", is_active: false, stato_accesso: "attivo" })).toBe(
      "attivo",
    );
    expect(
      deriveAccessState({ ...base, user_id: "u1", is_active: true, stato_accesso: "disabilitato" }),
    ).toBe("disabilitato");
  });

  it("un invito pendente non riattiva un membro disabilitato", () => {
    expect(
      deriveAccessState(
        { ...base, user_id: "u1", stato_accesso: "disabilitato" },
        { status: "pending", expires_at: new Date(Date.now() + 86400000).toISOString() },
      ),
    ).toBe("disabilitato");
  });

  it("membro archiviato con account = disabilitato", () => {
    expect(
      deriveAccessState({ ...base, user_id: "u1", stato_accesso: "attivo", archived_at: new Date().toISOString() }),
    ).toBe("disabilitato");
  });
});

describe("guardia accesso", () => {
  it("nega quando il profilo è disattivato, il membro è disabilitato o archiviato", () => {
    expect(isAccessAllowed({ profileActive: true, statoAccesso: "attivo" })).toBe(true);
    expect(isAccessAllowed({ profileActive: false, statoAccesso: "attivo" })).toBe(false);
    expect(isAccessAllowed({ profileActive: true, statoAccesso: "disabilitato" })).toBe(false);
    expect(isAccessAllowed({ profileActive: true, statoAccesso: "attivo", archivedAt: "2026-01-01" })).toBe(
      false,
    );
  });

  it("un membro senza accesso ma non disabilitato non è bloccato a livello di app", () => {
    expect(isAccessAllowed({ profileActive: true, statoAccesso: "senza_accesso" })).toBe(true);
  });
});


describe("invitabilità", () => {
  it("un membro senza email non è invitabile", () => {
    expect(canInviteMember({ nome: "Mario", email: null })).toBe(false);
  });
  it("un membro con email e senza account è invitabile", () => {
    expect(canInviteMember({ nome: "Mario", email: "m@x.it" })).toBe(true);
  });
  it("un membro già collegato a un account non è invitabile", () => {
    expect(canInviteMember({ nome: "Mario", email: "m@x.it", user_id: "u1", stato_accesso: "attivo" })).toBe(
      false,
    );
  });
  it("un membro archiviato non è invitabile", () => {
    expect(
      canInviteMember({ nome: "Mario", email: "m@x.it", archived_at: new Date().toISOString() }),
    ).toBe(false);
  });
});

describe("nome visualizzato", () => {
  it("compone nome e cognome, con fallback su email", () => {
    expect(memberFullName({ nome: "Mario", cognome: "Rossi" })).toBe("Mario Rossi");
    expect(memberFullName({ nome: "", cognome: null, email: "m@x.it" })).toBe("m@x.it");
    expect(memberFullName({ nome: null, cognome: null })).toBe("Senza nome");
  });
});
