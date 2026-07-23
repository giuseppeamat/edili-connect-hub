import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  lookupInvite,
  acceptInvite,
  acceptInviteAsNewUser,
} from "@/lib/invites.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { HardHat, Loader2, CheckCircle2 } from "lucide-react";
import { ROLE_LABELS } from "@/hooks/use-current-user";

const searchSchema = z.object({ token: z.string().optional() });

export const Route = createFileRoute("/accetta-invito")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Accetta invito — CantiereOS" },
      { name: "description", content: "Accetta l'invito a unirti all'organizzazione." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const lookupFn = useServerFn(lookupInvite);
  const acceptFn = useServerFn(acceptInvite);
  const acceptNewFn = useServerFn(acceptInviteAsNewUser);

  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSessionEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSessionEmail(s?.user?.email ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const lookup = useQuery({
    queryKey: ["invite-lookup", token],
    enabled: !!token,
    retry: false,
    queryFn: async () => lookupFn({ data: { token: token! } }),
  });

  // ----- No token -----
  if (!token) {
    return (
      <Shell>
        <Alert variant="destructive">
          <AlertTitle>Link non valido</AlertTitle>
          <AlertDescription>Il link di invito è incompleto o è stato modificato.</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (lookup.isLoading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-muted-foreground justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Verifica invito in corso…
        </div>
      </Shell>
    );
  }

  const inv = lookup.data;
  if (!inv?.valid) {
    const reason =
      inv?.reason === "expired"
        ? "Invito scaduto."
        : inv?.reason === "revoked"
          ? "Invito revocato."
          : inv?.reason === "accepted"
            ? "Invito già accettato."
            : "Invito non valido o non trovato.";
    return (
      <Shell>
        <Alert variant="destructive">
          <AlertTitle>Impossibile procedere</AlertTitle>
          <AlertDescription>
            {reason} Contatta chi ti ha invitato per un nuovo link.
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  // ----- Utente già loggato con email diversa -----
  const emailMismatch =
    sessionEmail && sessionEmail.toLowerCase() !== inv.email.toLowerCase();
  if (emailMismatch) {
    return (
      <Shell>
        <InviteSummary inv={inv} />
        <Alert variant="destructive">
          <AlertTitle>Email non corrispondente</AlertTitle>
          <AlertDescription>
            Sei collegato come <b>{sessionEmail}</b>, ma l'invito è per <b>{inv.email}</b>.
            Esci dall'account attuale e riprova con l'email corretta.
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="w-full"
          onClick={async () => {
            await supabase.auth.signOut();
            toast.success("Sei uscito dall'account precedente.");
          }}
        >
          Esci dall'account attuale
        </Button>
      </Shell>
    );
  }

  // ----- Utente già loggato con email corretta: un click e accetta -----
  if (sessionEmail && !emailMismatch) {
    return (
      <Shell>
        <InviteSummary inv={inv} />
        <AlreadySignedInAccept
          token={token}
          onDone={() => navigate({ to: "/", replace: true })}
          acceptFn={acceptFn}
        />
      </Shell>
    );
  }

  // ----- Non loggato: mostra due percorsi -----
  return (
    <Shell>
      <InviteSummary inv={inv} />
      <Card>
        <CardHeader>
          <CardTitle>Come vuoi procedere?</CardTitle>
          <CardDescription>
            Scegli se hai già un account CantiereOS o se vuoi crearne uno nuovo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="new">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">Crea il tuo account</TabsTrigger>
              <TabsTrigger value="existing">Ho già un account</TabsTrigger>
            </TabsList>
            <TabsContent value="new" className="mt-4">
              <SignupForm
                token={token}
                email={inv.email}
                onDone={() => navigate({ to: "/", replace: true })}
                acceptNewFn={acceptNewFn}
              />
            </TabsContent>
            <TabsContent value="existing" className="mt-4">
              <LoginAndAcceptForm
                token={token}
                email={inv.email}
                onDone={() => navigate({ to: "/", replace: true })}
                acceptFn={acceptFn}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </Shell>
  );
}

// ---------- Sub-components ----------

function InviteSummary({
  inv,
}: {
  inv: {
    email: string;
    role: string;
    organization_nome: string | null;
    expires_at: string;
  };
}) {
  const expires = new Date(inv.expires_at);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" /> Sei stato invitato
        </CardTitle>
        <CardDescription className="space-y-1">
          <div>
            Sei stato invitato a entrare in{" "}
            <b>{inv.organization_nome ?? "—"}</b> con il ruolo di{" "}
            <b>{ROLE_LABELS[inv.role as keyof typeof ROLE_LABELS] ?? inv.role}</b>.
          </div>
          <div>
            Email invito: <b>{inv.email}</b>
          </div>
          <div className="text-xs">
            Scade il{" "}
            {expires.toLocaleDateString("it-IT", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
            .
          </div>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function SignupForm({
  token,
  email,
  onDone,
  acceptNewFn,
}: {
  token: string;
  email: string;
  onDone: () => void;
  acceptNewFn: ReturnType<typeof useServerFn<typeof acceptInviteAsNewUser>>;
}) {
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Le password inserite non coincidono.");
      return;
    }
    if (password.length < 8) {
      toast.error("La password deve contenere almeno 8 caratteri.");
      return;
    }
    setLoading(true);
    try {
      await acceptNewFn({
        data: {
          token,
          password,
          nome: nome.trim(),
          cognome: cognome.trim(),
        },
      });
      // Login immediato con la password appena scelta
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) {
        toast.success("Account creato. Accedi ora per continuare.");
        onDone();
        return;
      }
      toast.success("Invito accettato. Ora fai parte dell'organizzazione.");
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Impossibile creare l'account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3" autoComplete="on">
      <p className="text-sm text-muted-foreground">
        Crea il tuo account e scegli una password personale per accedere.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="s-nome">Nome</Label>
          <Input
            id="s-nome"
            autoComplete="given-name"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="s-cognome">Cognome</Label>
          <Input
            id="s-cognome"
            autoComplete="family-name"
            required
            value={cognome}
            onChange={(e) => setCognome(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="s-email">Email</Label>
        <Input id="s-email" type="email" value={email} disabled readOnly />
        <p className="text-xs text-muted-foreground mt-1">
          L'email è collegata all'invito e non può essere modificata.
        </p>
      </div>
      <div>
        <Label htmlFor="s-password">Password</Label>
        <Input
          id="s-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tooShort && (
          <p className="text-xs text-destructive mt-1">
            La password deve contenere almeno 8 caratteri.
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="s-confirm">Conferma password</Label>
        <Input
          id="s-confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && (
          <p className="text-xs text-destructive mt-1">
            Le password inserite non coincidono.
          </p>
        )}
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading || mismatch || tooShort || !nome || !cognome}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Crea account e accetta l'invito
      </Button>
    </form>
  );
}

function LoginAndAcceptForm({
  token,
  email,
  onDone,
  acceptFn,
}: {
  token: string;
  email: string;
  onDone: () => void;
  acceptFn: ReturnType<typeof useServerFn<typeof acceptInvite>>;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) {
        toast.error("Email o password non corretti.");
        return;
      }
      // Il server ricontrolla token, email, stato e scadenza prima di accettare.
      await acceptFn({ data: { token } });
      toast.success("Invito accettato. Ora fai parte dell'organizzazione.");
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Impossibile accettare l'invito");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3" autoComplete="on">
      <p className="text-sm text-muted-foreground">
        Accedi con il tuo account per accettare l'invito.
      </p>
      <div>
        <Label htmlFor="l-email">Email</Label>
        <Input id="l-email" type="email" value={email} disabled readOnly />
        <p className="text-xs text-muted-foreground mt-1">
          Devi usare l'email dell'invito.
        </p>
      </div>
      <div>
        <Label htmlFor="l-password">Password</Label>
        <Input
          id="l-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Accedi e accetta l'invito
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        <Link to="/auth" className="text-primary hover:underline">
          Password dimenticata?
        </Link>
      </p>
    </form>
  );
}

function AlreadySignedInAccept({
  token,
  onDone,
  acceptFn,
}: {
  token: string;
  onDone: () => void;
  acceptFn: ReturnType<typeof useServerFn<typeof acceptInvite>>;
}) {
  const accept = useMutation({
    mutationFn: async () => acceptFn({ data: { token } }),
    onSuccess: () => {
      toast.success("Invito accettato. Ora fai parte dell'organizzazione.");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Impossibile accettare l'invito"),
  });
  return (
    <Card>
      <CardContent className="pt-6">
        <Button
          className="w-full"
          onClick={() => accept.mutate()}
          disabled={accept.isPending}
        >
          {accept.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Accetta e unisciti
        </Button>
      </CardContent>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-2 justify-center">
          <div className="rounded-md bg-primary p-2">
            <HardHat className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-bold">CantiereOS</span>
        </div>
        {children}
      </div>
    </div>
  );
}
