import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lookupInvite, acceptInvite } from "@/lib/invites.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { HardHat, Loader2 } from "lucide-react";
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

  const accept = useMutation({
    mutationFn: async () => acceptFn({ data: { token: token! } }),
    onSuccess: () => {
      toast.success("Invito accettato. Benvenuto!");
      navigate({ to: "/", replace: true });
    },
    onError: (e: any) => toast.error(e.message ?? "Impossibile accettare l'invito"),
  });

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
        <div className="flex items-center gap-2 text-muted-foreground">
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
          <AlertDescription>{reason} Contatta chi ti ha invitato per un nuovo link.</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const emailMismatch =
    sessionEmail && sessionEmail.toLowerCase() !== inv.email.toLowerCase();

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>Sei stato invitato</CardTitle>
          <CardDescription>
            Organizzazione: <b>{inv.organization_nome ?? "—"}</b>
            <br />
            Email invito: <b>{inv.email}</b>
            <br />
            Ruolo: <b>{ROLE_LABELS[inv.role]}</b>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessionEmail === undefined ? (
            <p className="text-sm text-muted-foreground">Caricamento sessione…</p>
          ) : !sessionEmail ? (
            <div className="space-y-3">
              <p className="text-sm">
                Per accettare, accedi o registrati usando l'email{" "}
                <b>{inv.email}</b>.
              </p>
              <div className="flex gap-2">
                <Button asChild>
                  <Link
                    to="/auth"
                    search={{ redirect: `/accetta-invito?token=${encodeURIComponent(token)}` }}
                  >
                    Accedi
                  </Link>
                </Button>
              </div>
            </div>
          ) : emailMismatch ? (
            <Alert variant="destructive">
              <AlertTitle>Email non corrispondente</AlertTitle>
              <AlertDescription>
                Sei collegato come <b>{sessionEmail}</b>, ma l'invito è per <b>{inv.email}</b>. Esci
                e accedi con l'email corretta.
              </AlertDescription>
            </Alert>
          ) : (
            <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Accetta e unisciti
            </Button>
          )}
        </CardContent>
      </Card>
    </Shell>
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
