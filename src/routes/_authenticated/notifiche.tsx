import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Archive, CheckCheck, Mail, MailOpen } from "lucide-react";
import { SeverityIcon } from "@/components/notifiche/notifiche-bell";
import {
  listNotifiche,
  markNotificaRead,
  markNotificaUnread,
  markAllNotificheRead,
  archiveNotifica,
  archiveAllReadNotifiche,
} from "@/lib/notifiche.functions";
import { notificheKeys, invalidateNotifiche } from "@/lib/notifiche.keys";
import {
  TIPI_NOTIFICA,
  tipoLabel,
  entityLabel,
  safeRoute,
  tempoRelativo,
  normalizeSeverita,
  SEVERITA_LABELS,
  SEVERITA_BADGE_VARIANT,
  ERR_LOAD,
  ERR_UPDATE,
  ERR_ENTITY_GONE,
  type NotificaDTO,
} from "@/lib/notifiche-model";
import { dateIt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/notifiche")({
  head: () => ({
    meta: [
      { title: "Notifiche — CantiereOS" },
      {
        name: "description",
        content:
          "Centro notifiche operative: rapportini, documenti in scadenza, budget e attività da seguire.",
      },
      { property: "og:title", content: "Notifiche — CantiereOS" },
      {
        property: "og:description",
        content: "Eventi operativi dell'impresa edile con severità, stato e collegamento diretto.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotifichePage,
});

const ALL = "__all__";
const PAGE_SIZE = 25;

function NotifichePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [stato, setStato] = useState<"non_lette" | "tutte" | "archiviate">("tutte");
  const [tipo, setTipo] = useState<string>(ALL);
  const [severita, setSeverita] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filters = {
    stato,
    tipo: tipo === ALL ? null : tipo,
    severita: severita === ALL ? null : (severita as any),
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
    q: q.trim() || null,
    page,
    pageSize: PAGE_SIZE,
  };

  const listFn = useServerFn(listNotifiche);
  const readFn = useServerFn(markNotificaRead);
  const unreadFn = useServerFn(markNotificaUnread);
  const allReadFn = useServerFn(markAllNotificheRead);
  const archiveFn = useServerFn(archiveNotifica);
  const archiveAllFn = useServerFn(archiveAllReadNotifiche);

  const query = useQuery({
    queryKey: notificheKeys.list(filters as any),
    queryFn: () => listFn({ data: filters as any }),
    staleTime: 30_000,
    retry: 1,
  });

  const refresh = () => invalidateNotifiche(qc);
  const onErr = () => toast.error(ERR_UPDATE);

  const mRead = useMutation({ mutationFn: (id: string) => readFn({ data: { id } }), onSuccess: refresh, onError: onErr });
  const mUnread = useMutation({ mutationFn: (id: string) => unreadFn({ data: { id } }), onSuccess: refresh, onError: onErr });
  const mArchive = useMutation({ mutationFn: (id: string) => archiveFn({ data: { id } }), onSuccess: refresh, onError: onErr });
  const mAllRead = useMutation({ mutationFn: () => allReadFn({ data: undefined as any }), onSuccess: refresh, onError: onErr });
  const mArchiveAll = useMutation({ mutationFn: () => archiveAllFn({ data: undefined as any }), onSuccess: refresh, onError: onErr });

  const rows: NotificaDTO[] = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const open = (n: NotificaDTO) => {
    if (!n.read_at) mRead.mutate(n.id);
    const route = safeRoute(n.route);
    if (!route) {
      toast.info(ERR_ENTITY_GONE);
      return;
    }
    navigate({ to: route });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifiche"
        description="Eventi operativi che richiedono attenzione, ordinati dal più recente."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => mAllRead.mutate()}>
              <CheckCheck className="h-4 w-4" /> Segna tutte come lette
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => mArchiveAll.mutate()}>
              <Archive className="h-4 w-4" /> Archivia lette
            </Button>
          </div>
        }
      />

      <Tabs
        value={stato}
        onValueChange={(v) => {
          setStato(v as any);
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="non_lette">Non lette</TabsTrigger>
          <TabsTrigger value="tutte">Tutte</TabsTrigger>
          <TabsTrigger value="archiviate">Archiviate</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="notif-q">Ricerca</Label>
            <Input
              id="notif-q"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Titolo o messaggio"
            />
          </div>
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => { setTipo(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutti i tipi</SelectItem>
                {TIPI_NOTIFICA.map((t) => (
                  <SelectItem key={t} value={t}>{tipoLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Severità</Label>
            <Select value={severita} onValueChange={(v) => { setSeverita(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutte</SelectItem>
                <SelectItem value="critica">Critica</SelectItem>
                <SelectItem value="attenzione">Attenzione</SelectItem>
                <SelectItem value="info">Informazione</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notif-from">Dal</Label>
            <Input id="notif-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notif-to">Al</Label>
            <Input id="notif-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
        </CardContent>
      </Card>

      {query.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {query.isError && (
        <Card>
          <CardContent className="p-6 space-y-3 text-sm">
            <p className="text-muted-foreground">{ERR_LOAD}</p>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>Riprova</Button>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && !query.isError && rows.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Nessuna notifica in questa vista.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map((n) => {
          const sev = normalizeSeverita(n.severita);
          return (
            <Card key={n.id} className={n.read_at ? "" : "border-primary/40"}>
              <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <button
                  type="button"
                  onClick={() => open(n)}
                  className="text-left min-w-0 flex-1 flex gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                >
                  <SeverityIcon severita={sev} className="h-5 w-5 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${n.read_at ? "" : "font-semibold"}`}>{n.titolo}</span>
                      <Badge variant={SEVERITA_BADGE_VARIANT[sev]}>{SEVERITA_LABELS[sev]}</Badge>
                      {!n.read_at && <Badge variant="outline">Non letta</Badge>}
                    </div>
                    {n.messaggio && (
                      <p className="text-sm text-muted-foreground mt-1">{n.messaggio}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {tipoLabel(n.tipo)} · {entityLabel(n.entity_type)} · {dateIt(n.created_at)} ·{" "}
                      {tempoRelativo(n.created_at)}
                    </p>
                  </div>
                </button>
                <div className="flex gap-1 shrink-0">
                  {n.read_at ? (
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => mUnread.mutate(n.id)}>
                      <Mail className="h-4 w-4" /> Non letta
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => mRead.mutate(n.id)}>
                      <MailOpen className="h-4 w-4" /> Letta
                    </Button>
                  )}
                  {!n.archived_at && (
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => mArchive.mutate(n.id)}>
                      <Archive className="h-4 w-4" /> Archivia
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Pagina {page} di {totalPages} — {total} notifiche
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Precedente
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Successiva
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
