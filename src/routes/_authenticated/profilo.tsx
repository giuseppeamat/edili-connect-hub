import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser, ROLE_LABELS } from "@/hooks/use-current-user";
import { friendlyPermissionError } from "@/lib/permission-error";
import { dateIt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/profilo")({
  head: () => ({
    meta: [
      { title: "Profilo — CantiereOS" },
      { name: "description", content: "Gestisci i tuoi dati personali su CantiereOS." },
    ],
  }),
  component: ProfiloPage,
});

function ProfiloPage() {
  const { isLoading, profile, organization, primaryRole, roles, userId, email } = useCurrentUser();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [telefono, setTelefono] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setNome(profile.nome ?? "");
      setCognome(profile.cognome ?? "");
      setTelefono(profile.telefono ?? "");
    }
  }, [profile]);

  const initials =
    `${(profile?.nome ?? "")[0] ?? ""}${(profile?.cognome ?? "")[0] ?? ""}`.toUpperCase() || "U";

  const displayEmail = profile?.email ?? email ?? "—";
  const roleLabel = primaryRole ? ROLE_LABELS[primaryRole] : "—";

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          nome: nome.trim() || null,
          cognome: cognome.trim() || null,
          telefono: telefono.trim() || null,
        })
        .eq("id", userId);
      if (error) throw error;
      toast.success("Profilo aggiornato");
      await qc.invalidateQueries({ queryKey: ["current-user"] });
    } catch (err) {
      toast.error(friendlyPermissionError(err));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Caricamento…</div>
    );
  }

  if (!profile) {
    return (
      <div className="text-sm text-muted-foreground">
        Non è stato possibile caricare il profilo. Riprova.
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Profilo" description="Gestisci i tuoi dati personali." />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Riepilogo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-semibold">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {[profile.nome, profile.cognome].filter(Boolean).join(" ") || "—"}
                </div>
                <div className="text-xs text-muted-foreground truncate">{displayEmail}</div>
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Organizzazione</dt>
                <dd className="font-medium">{organization?.nome ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Ruolo</dt>
                <dd className="font-medium">{roleLabel}</dd>
                {roles.length > 1 && (
                  <dd className="text-xs text-muted-foreground">
                    Altri: {roles.filter((r) => r !== primaryRole).map((r) => ROLE_LABELS[r]).join(", ")}
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Registrato il</dt>
                <dd>{dateIT(profile.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Ultimo aggiornamento</dt>
                <dd>{dateIT(profile.updated_at)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dati personali</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSave} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nome">Nome</Label>
                  <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="given-name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cognome">Cognome</Label>
                  <Input id="cognome" value={cognome} onChange={(e) => setCognome(e.target.value)} autoComplete="family-name" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="telefono">Telefono</Label>
                  <Input id="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} autoComplete="tel" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={displayEmail} disabled />
                  <p className="text-xs text-muted-foreground">
                    L'email di accesso non può essere modificata da questa pagina.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvataggio…" : "Salva modifiche"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
