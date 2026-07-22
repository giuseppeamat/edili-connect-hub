import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { HardHat } from "lucide-react";

export const Route = createFileRoute("/auth")({
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

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      // Non reindirizzare gli utenti anonimi (modalità demo): devono poter creare un account reale.
      if (data.user && !data.user.is_anonymous) navigate({ to: "/" });
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bentornato!");
    navigate({ to: "/" });
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await supabase.auth.signUp({
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
    if (error) return toast.error(error.message);
    toast.success("Registrazione completata!");
    navigate({ to: "/" });
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
