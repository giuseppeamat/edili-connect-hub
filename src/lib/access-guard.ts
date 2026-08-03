/**
 * Guardia di accesso tenant-safe, condivisa da server functions e UI.
 *
 * Sorgenti autorevoli:
 *  - ruolo tenant-specifico  → organization_members.ruolo_organizzativo
 *    (sincronizzata su user_roles per RLS dalla RPC update_organization_member)
 *  - stato accesso           → organization_members.stato_accesso
 *
 * Un token Auth valido NON basta: se il membro è disabilitato o archiviato,
 * l'accesso applicativo è negato.
 */

export const ACCESS_DISABLED_MESSAGE =
  "Il tuo accesso al gestionale è stato disabilitato. Contatta un amministratore.";

export type ActiveMemberContext = {
  organizationId: string;
  memberId: string | null;
  roles: string[];
};

/** Vero se lo stato del membro consente di usare il gestionale. */
export function isAccessAllowed(input: {
  profileActive?: boolean | null;
  statoAccesso?: string | null;
  archivedAt?: string | null;
}): boolean {
  if (input.profileActive === false) return false;
  if (input.archivedAt) return false;
  if (input.statoAccesso === "disabilitato") return false;
  return true;
}

/**
 * Verifica che il chiamante sia un membro attivo della propria organizzazione.
 * `supabase` è il client RLS-scoped della middleware; nessun input dal client.
 */
export async function requireActiveOrganizationMember(
  supabase: any,
  userId: string,
): Promise<ActiveMemberContext> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.organization_id) throw new Error("Organizzazione non trovata");
  const organizationId = profile.organization_id as string;

  const { data: member } = await supabase
    .from("organization_members")
    .select("id, stato_accesso, archived_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (
    !isAccessAllowed({
      profileActive: profile.is_active,
      statoAccesso: member?.stato_accesso ?? null,
      archivedAt: member?.archived_at ?? null,
    })
  ) {
    throw new Error(ACCESS_DISABLED_MESSAGE);
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId);

  return {
    organizationId,
    memberId: (member?.id as string) ?? null,
    roles: ((roleRows ?? []) as { role: string }[]).map((r) => String(r.role)),
  };
}
