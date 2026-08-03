import { type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { UserMenu } from "./user-menu";
import { NotificheBell } from "./notifiche/notifiche-bell";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ACCESS_DISABLED_MESSAGE } from "@/lib/access-guard";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";

/** Schermata di blocco per membri con accesso disabilitato o archiviato. */
function AccessoDisabilitato() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const esci = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="text-lg font-semibold">Accesso disabilitato</h1>
        <p className="text-sm text-muted-foreground">{ACCESS_DISABLED_MESSAGE}</p>
        <Button onClick={esci}>Torna al login</Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { isLoading, accessDisabled } = useCurrentUser();

  if (!isLoading && accessDisabled) return <AccessoDisabilitato />;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card px-3 md:px-6 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="font-semibold text-sm md:text-base">CantiereOS</span>
            </div>
            <div className="flex items-center gap-1">
              <NotificheBell />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
