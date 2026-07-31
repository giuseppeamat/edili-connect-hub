import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  getNotificheSummary,
  markNotificaRead,
  markAllNotificheRead,
} from "@/lib/notifiche.functions";
import { notificheKeys, invalidateNotifiche } from "@/lib/notifiche.keys";
import {
  badgeLabel,
  safeRoute,
  tempoRelativo,
  normalizeSeverita,
  SEVERITA_LABELS,
  ERR_LOAD,
  ERR_UPDATE,
  ERR_ENTITY_GONE,
  type NotificaDTO,
  type Severita,
} from "@/lib/notifiche-model";

export function SeverityIcon({ severita, className }: { severita: Severita; className?: string }) {
  const cls = className ?? "h-4 w-4 shrink-0";
  if (severita === "critica") return <AlertCircle className={`${cls} text-destructive`} aria-hidden />;
  if (severita === "attenzione") return <AlertTriangle className={`${cls} text-primary`} aria-hidden />;
  return <Info className={`${cls} text-muted-foreground`} aria-hidden />;
}

export function NotificheBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const summaryFn = useServerFn(getNotificheSummary);
  const markRead = useServerFn(markNotificaRead);
  const markAll = useServerFn(markAllNotificheRead);

  // Nessun polling aggressivo: refetch su focus finestra + staleTime 90s.
  const q = useQuery({
    queryKey: notificheKeys.preview(),
    queryFn: () => summaryFn({ data: undefined as any }),
    staleTime: 90_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const readMut = useMutation({
    mutationFn: (id: string) => markRead({ data: { id } }),
    onSuccess: () => invalidateNotifiche(qc),
    onError: () => toast.error(ERR_UPDATE),
  });

  const allMut = useMutation({
    mutationFn: () => markAll({ data: undefined as any }),
    onSuccess: () => invalidateNotifiche(qc),
    onError: () => toast.error(ERR_UPDATE),
  });

  const unread = q.data?.unreadCount ?? 0;
  const badge = badgeLabel(unread);
  const items: NotificaDTO[] = q.data?.preview ?? [];

  const onItemClick = (n: NotificaDTO) => {
    setOpen(false);
    if (!n.read_at) readMut.mutate(n.id);
    const route = safeRoute(n.route);
    if (!route) {
      toast.info(ERR_ENTITY_GONE);
      return;
    }
    navigate({ to: route });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unread > 0 ? `Notifiche: ${unread} non lette` : "Notifiche: nessuna non letta"
          }
        >
          <Bell className="h-5 w-5" aria-hidden />
          {badge && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center"
              aria-hidden
            >
              {badge}
            </span>
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {unread > 0 ? `${unread} notifiche non lette` : "Nessuna notifica non letta"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifiche</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={unread === 0 || allMut.isPending}
            onClick={() => allMut.mutate()}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Segna tutte come lette
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-auto">
          {q.isLoading && (
            <div className="p-3 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {q.isError && (
            <div className="p-4 text-sm space-y-2">
              <p className="text-muted-foreground">{ERR_LOAD}</p>
              <Button size="sm" variant="outline" onClick={() => q.refetch()}>
                Riprova
              </Button>
            </div>
          )}

          {!q.isLoading && !q.isError && items.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground text-center">
              Nessuna notifica al momento.
            </p>
          )}

          {!q.isError &&
            items.map((n) => {
              const sev = normalizeSeverita(n.severita);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className="w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
                >
                  <div className="flex gap-2">
                    <SeverityIcon severita={sev} className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm truncate ${n.read_at ? "font-normal" : "font-semibold"}`}
                        >
                          {n.titolo}
                        </span>
                        {!n.read_at && (
                          <span className="text-[10px] uppercase tracking-wide text-primary shrink-0">
                            Nuova
                          </span>
                        )}
                      </div>
                      {n.messaggio && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{n.messaggio}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {SEVERITA_LABELS[sev]} · {tempoRelativo(n.created_at)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>

        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              navigate({ to: "/notifiche" });
            }}
          >
            Vedi tutte
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
