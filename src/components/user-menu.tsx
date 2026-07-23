import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, User } from "lucide-react";
import { useCurrentUser, ROLE_LABELS } from "@/hooks/use-current-user";

export function UserMenu() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile, organization, email, primaryRole, isLoading, userId } = useCurrentUser();

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (isLoading) {
    return <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />;
  }

  if (!userId) {
    return (
      <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/auth" })} className="gap-2">
        <LogIn className="h-4 w-4" />
        Accedi
      </Button>
    );
  }

  const initials =
    `${(profile?.nome ?? "")[0] ?? ""}${(profile?.cognome ?? "")[0] ?? ""}`.toUpperCase() || "U";
  const displayEmail = profile?.email ?? email ?? "";
  const fullName = [profile?.nome, profile?.cognome].filter(Boolean).join(" ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
            {initials}
          </div>
          <span className="hidden md:inline text-sm">{organization?.nome ?? ""}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="font-medium">{fullName || "Utente"}</div>
          <div className="text-xs text-muted-foreground font-normal">{displayEmail}</div>
          {primaryRole && (
            <div className="text-xs text-muted-foreground font-normal mt-1">
              {ROLE_LABELS[primaryRole]}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/profilo" })}>
          <User className="mr-2 h-4 w-4" /> Profilo
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Esci
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
