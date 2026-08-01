import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Accedi — CantiereOS" },
      { name: "description", content: "Accedi o registra la tua impresa edile su CantiereOS." },
      { property: "og:title", content: "Accedi — CantiereOS" },
      { property: "og:description", content: "Accedi al gestionale della tua impresa edile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function safeRedirect(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/auth")) return null;
  if (value.startsWith("/reset-password")) return null;

  const target = new URL(value, "https://cantiereos.local");
  for (const key of Array.from(target.searchParams.keys())) {
    if (key.startsWith("__lovable_")) target.searchParams.delete(key);
  }

  if (target.pathname === "/") {
    const rawPeriodo = target.searchParams.get("periodo");
    const periodo = rawPeriodo?.replace(/^['\"]+|['\"]+$/g, "");
    if (periodo === "30" || !["oggi", "7", "mese"].includes(periodo ?? "")) {
      target.searchParams.delete("periodo");
    } else if (periodo) {
      target.searchParams.set("periodo", periodo);
    }
  }

  return `${target.pathname}${target.search}${target.hash}`;
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials") || m.includes("invalid_grant"))
    return "Email o password non corretti.";
  if (m.includes("email not confirmed"))
    return "Account non ancora confermato: controlla la tua casella email.";
  if (m.includes("user already registered") || m.includes("already been registered") || m.includes("already registered"))
    return "Esiste già un account con questa email.";
  if (m.includes("password") && (m.includes("6") || m.includes("short")))
    return "La password deve contenere almeno 6 caratteri.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Troppi tentativi: riprova tra qualche minuto.";
  if (m.includes("network") || m.includes("fetch") || m.includes("failed to fetch"))
    return "Errore di connessione: riprova.";
  if (m.includes("service") && m.includes("unavailable"))
    return "Servizio temporaneamente non disponibile. Riprova a breve.";
  return "Si è verificato un errore. Riprova.";
}

function logAuthEvent(op: string, result: "success" | "error", extra?: Record<string, unknown>) {
  // Non registriamo mai password, token o sessioni.
  // eslint-disable-next-line no-console
  console.info(`[auth] ${op} → ${result}`, extra ?? {});
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  useEffect(() => {
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user || data.user.is_anonymous) return;
      void navigate({ to: safeRedirect(search.redirect) ?? "/", replace: true });
    });

    return () => {
      active = false;
    };
  }, [navigate, search.redirect]);

  // Stati separati per Login, Signup e Reset
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupNome, setSignupNome] = useState("");
  const [signupCognome, setSignupCognome] = useState("");
  const [signupOrg, setSignupOrg] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const goAfterAuth = () => {
    const target = safeRedirect(search.redirect) ?? "/";
    navigate({ to: target, replace: true });
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    if (!email || !password) return;
    setLoginLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoginLoading(false);
    if (error) {
      logAuthEvent("login", "error", { code: (error as any).code, status: (error as any).status });
      return toast.error(friendlyAuthError(error.message));
    }
    logAuthEvent("login", "success", { redirect: safeRedirect(search.redirect) ?? "/" });
    toast.success("Bentornato!");
    goAfterAuth();
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = signupEmail.trim().toLowerCase();
    const password = signupPassword;
    if (!email || !password) return;
    setSignupLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          nome: signupNome.trim(),
          cognome: signupCognome.trim(),
          organization_name: signupOrg.trim(),
        },
      },
    });
    setSignupLoading(false);
    if (error) {
      logAuthEvent("signup", "error", { code: (error as any).code, status: (error as any).status });
      return toast.error(friendlyAuthError(error.message));
    }
    logAuthEvent("signup", "success", { hasSession: !!data.session });
    if (data.session) {
      toast.success("Registrazione completata!");
      goAfterAuth();
    } else {
      toast.success("Ti abbiamo inviato un'email di conferma. Controlla la casella per attivare l'account.");
    }
  };

  const handleReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = resetEmail.trim().toLowerCase();
    if (!email) return;
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);
    logAuthEvent("reset", error ? "error" : "success", error ? { code: (error as any).code } : undefined);
    // Messaggio neutro: non riveliamo se l'utente esiste
    toast.success("Se l'indirizzo è registrato, riceverai un'email con le istruzioni per reimpostare la password.");
    setResetOpen(false);
    setResetEmail("");
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
            {resetOpen ? (
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <Label htmlFor="r-email">Email</Label>
                  <Input
                    id="r-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Ti invieremo un link per reimpostare la password.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={resetLoading}>
                    {resetLoading ? "Invio..." : "Invia email di recupero"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setResetOpen(false)} disabled={resetLoading}>
                    Annulla
                  </Button>
                </div>
              </form>
            ) : (
              <Tabs defaultValue="login">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Accedi</TabsTrigger>
                  <TabsTrigger value="signup">Registrati</TabsTrigger>
                </TabsList>
                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4 mt-4" autoComplete="on">
                    <div>
                      <Label htmlFor="l-email">Email</Label>
                      <Input
                        id="l-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="l-password">Password</Label>
                      <Input
                        id="l-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loginLoading}>
                      {loginLoading ? "Accesso in corso..." : "Accedi"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(loginEmail);
                        setResetOpen(true);
                      }}
                      className="text-sm text-primary hover:underline w-full text-center"
                    >
                      Password dimenticata?
                    </button>
                  </form>
                </TabsContent>
                <TabsContent value="signup">
                  <form onSubmit={handleSignup} className="space-y-4 mt-4" autoComplete="on">
                    <div>
                      <Label htmlFor="s-org">Nome impresa</Label>
                      <Input
                        id="s-org"
                        name="organization_name"
                        autoComplete="organization"
                        required
                        placeholder="Edilizia Rossi S.r.l."
                        value={signupOrg}
                        onChange={(e) => setSignupOrg(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="s-nome">Nome</Label>
                        <Input
                          id="s-nome"
                          name="nome"
                          autoComplete="given-name"
                          required
                          value={signupNome}
                          onChange={(e) => setSignupNome(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="s-cognome">Cognome</Label>
                        <Input
                          id="s-cognome"
                          name="cognome"
                          autoComplete="family-name"
                          required
                          value={signupCognome}
                          onChange={(e) => setSignupCognome(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="s-email">Email</Label>
                      <Input
                        id="s-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="s-password">Password</Label>
                      <Input
                        id="s-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={6}
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={signupLoading}>
                      {signupLoading ? "Creazione..." : "Crea account"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
