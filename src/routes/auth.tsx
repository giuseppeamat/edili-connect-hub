import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { HardHat } from "lucide-react";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user && !data.user.is_anonymous) {
      const target = safeRedirect(search.redirect) ?? "/";
      throw redirect({ to: target });
    }
  },
  head: () => ({
    meta: [
      { title: "Accedi — CantiereOS" },
      { name: "description", content: "Accedi o registra la tua impresa edile su CantiereOS." },
      { property: "og:title", content: "Accedi — CantiereOS" },
      { property: "og:description", content: "Accedi al gestionale della tua impresa edile." },
    ],
  }),
  component: AuthPage,
});

function safeRedirect(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/auth")) return null;
  return value;
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials"))
    return "Email o password non corretti.";
  if (m.includes("email not confirmed"))
    return "Account non ancora confermato: controlla la tua casella email.";
  if (m.includes("user already registered") || m.includes("already been registered"))
    return "Esiste già un account con questa email.";
  if (m.includes("password") && m.includes("6"))
    return "La password deve contenere almeno 6 caratteri.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Troppi tentativi: riprova tra qualche minuto.";
  if (m.includes("network") || m.includes("fetch"))
    return "Errore di connessione: riprova.";
  return "Si è verificato un errore. Riprova.";
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [loading, setLoading] = useState(false);

  const goAfterAuth = () => {
    const target = safeRedirect(search.redirect) ?? "/";
    navigate({ to: target, replace: true });
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) return toast.error(friendlyAuthError(error.message));
    toast.success("Bentornato!");
    goAfterAuth();
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: String(form.get("email")),
      password: String(form.get("password")),
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          nome: form.get("nome"),
          cognome: form.get("cognome"),
          organization_name: form.get("organization_name"),
        },
      },
    });
    setLoading(false);
    if (error) return toast.error(friendlyAuthError(error.message));
    if (data.session) {
      toast.success("Registrazione completata!");
      goAfterAuth();
    } else {
      toast.success("Ti abbiamo inviato un'email di conferma. Controlla la casella per attivare l'account.");
    }
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
            <CardTitle>Benvenuto</CardTitle>
            <CardDescription>Il gestionale per la tua impresa edile</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Accedi</TabsTrigger>
                <TabsTrigger value="signup">Registrati</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4 mt-4">
                  <div>
                    <Label htmlFor="l-email">Email</Label>
                    <Input id="l-email" name="email" type="email" required />
                  </div>
                  <div>
                    <Label htmlFor="l-password">Password</Label>
                    <Input id="l-password" name="password" type="password" required />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Accesso in corso..." : "Accedi"}
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form onSubmit={handleSignup} className="space-y-4 mt-4">
                  <div>
                    <Label htmlFor="s-org">Nome impresa</Label>
                    <Input id="s-org" name="organization_name" required placeholder="Edilizia Rossi S.r.l." />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="s-nome">Nome</Label>
                      <Input id="s-nome" name="nome" required />
                    </div>
                    <div>
                      <Label htmlFor="s-cognome">Cognome</Label>
                      <Input id="s-cognome" name="cognome" required />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="s-email">Email</Label>
                    <Input id="s-email" name="email" type="email" required />
                  </div>
                  <div>
                    <Label htmlFor="s-password">Password</Label>
                    <Input id="s-password" name="password" type="password" required minLength={6} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creazione..." : "Crea account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
