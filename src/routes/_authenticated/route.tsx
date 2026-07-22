import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };

    // Demo mode: auto sign-in anonymously so the app is browsable without login.
    const { data: anon, error: anonError } = await supabase.auth.signInAnonymously({
      options: { data: { organization_name: "Edilizia Demo S.r.l.", nome: "Ospite", cognome: "Demo" } },
    });
    if (anonError || !anon.user) throw redirect({ to: "/auth" });
    return { user: anon.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
