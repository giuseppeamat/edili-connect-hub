import { useEffect, useState } from "react";
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
import { LogOut, User } from "lucide-react";

export function UserMenu() {
  const [profile, setProfile] = useState<{ nome?: string; cognome?: string; email?: string; org?: string } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("nome, cognome, email, organizations(nome)")
        .eq("id", u.user.id)
        .single();
      setProfile({
        nome: p?.nome ?? undefined,
        cognome: p?.cognome ?? undefined,
        email: p?.email ?? u.user.email ?? undefined,
        org: (p as any)?.organizations?.nome,
      });
    })();
  }, []);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const initials = `${profile?.nome?.[0] ?? ""}${profile?.cognome?.[0] ?? ""}` || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
            {initials.toUpperCase()}
          </div>
          <span className="hidden md:inline text-sm">{profile?.org ?? ""}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="font-medium">
            {profile?.nome} {profile?.cognome}
          </div>
          <div className="text-xs text-muted-foreground font-normal">{profile?.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" /> Profilo
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Esci
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
