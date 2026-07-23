import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { HardHat } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reimposta password — CantiereOS" },
      { name: "description", content: "Imposta una nuova password per il tuo account CantiereOS." },
      { property: "og:title", content: "Reimposta password — CantiereOS" },
      { property: "og:description", content: "Imposta una nuova password per il tuo account CantiereOS." },
    ],
  }),
  component: ResetPasswordPage,
});

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("session")) return "Link di recupero scaduto o non valido. Richiedi un nuovo link.";
  if (m.includes("password") && (m.includes("6") || m.includes("short")))
    return "La password deve contenere almeno 6 caratteri.";
  if (m.includes("same")) return "La nuova password deve essere diversa dalla precedente.";
  return "Si è verificato un errore. Riprova.";
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase gestisce il token di recovery nell'URL e stabilisce una sessione.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setValidSession(true);
        setReady(true);
      }
    });
    // Fallback: verifica sessione esistente
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setValidSession(true);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("La password deve contenere almeno 6 caratteri.");
      return;
    }
    if (password !== confirm) {
      toast.error("Le password non coincidono.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    // eslint-disable-next-line no-console
    console.info(`[auth] reset-update → ${error ? "error" : "success"}`, error ? { code: (error as any).code } : {});
    if (error) return toast.error(friendly(error.message));
    toast.success("Password aggiornata. Accedi con le nuove credenziali.");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary to-background p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-6">
          <div className="rounded-lg bg-primary p-2">
            <HardHat className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold">CantiereOS</span>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Reimposta password</CardTitle>
            <CardDescription>Imposta una nuova password per il tuo account.</CardDescription>
          </CardHeader>
          <CardContent>
            {!ready ? (
              <p className="text-sm text-muted-foreground">Verifica del link in corso…</p>
            ) : !validSession ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Il link di recupero non è valido o è scaduto. Richiedi un nuovo link dalla pagina di accesso.
                </p>
                <Button onClick={() => navigate({ to: "/auth" })} className="w-full">
                  Torna al login
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
                <div>
                  <Label htmlFor="rp-password">Nuova password</Label>
                  <Input
                    id="rp-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="rp-confirm">Conferma password</Label>
                  <Input
                    id="rp-confirm"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Aggiornamento..." : "Aggiorna password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
