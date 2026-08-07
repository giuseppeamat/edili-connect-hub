import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";

import { getDashboardOperativa } from "@/lib/dashboard.functions";
import { PERIODO_LABEL, isPeriodo, isIsoDate, type PeriodoKey } from "@/lib/dashboard-model";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { eur, num, dateIt } from "@/lib/format";
import { seedDemoData } from "@/lib/seed-demo";
import {
  FileText,
  HardHat,
  Coins,
  TrendingUp,
  CalendarClock,
  Clock,
  Wallet,
  AlertTriangle,
  ClipboardCheck,
  Activity,
  PhoneCall,
  ArrowRight,
} from "lucide-react";

const searchSchema = z.object({
  periodo: fallback(z.string(), "30").optional(),
  da: fallback(z.string(), "").optional(),
  a: fallback(z.string(), "").optional(),
});


export const Route = createFileRoute("/_authenticated/")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Dashboard operativa — CantiereOS" },
      {
        name: "description",
        content:
          "Cosa richiede attenzione oggi: commesse critiche, rapportini da approvare, scadenze e attività.",
      },
    ],
  }),
  component: Dashboard,
});

function KpiCard({
  title,
  value,
  icon: Icon,
  hint,
  tone = "default",
  to,
  search,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  tone?: "default" | "warning" | "success" | "destructive";
  to?: string;
  search?: Record<string, string>;
}) {
  const toneCls = {
    default: "bg-primary/10 text-primary",
    warning: "bg-[color:var(--warning)]/15 text-[color:var(--warning-foreground)]",
    success: "bg-[color:var(--success)]/15 text-[color:var(--success)]",
    destructive: "bg-destructive/10 text-destructive",
  }[tone];
  const body = (
    <CardContent className="p-4 md:p-5 flex items-start gap-3">
      <div className={`rounded-lg p-2.5 shrink-0 ${toneCls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          {title}
        </div>
        <div className="text-2xl font-bold truncate">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
    </CardContent>
  );
  if (to) {
    return (
      <Link
        to={to as any}
        search={search as any}
        aria-label={`Vai a ${title}`}
        className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="transition hover:shadow-md hover:border-primary/40 cursor-pointer h-full">
          {body}
        </Card>
      </Link>
    );
  }
  return <Card>{body}</Card>;
}

function SectionCard({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground py-2">{text}</div>;
}

const sevVariant = (s: string) =>
  s === "critico" ? "destructive" : s === "attenzione" ? "secondary" : "outline";

function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const periodo: PeriodoKey = isPeriodo(search.periodo) ? search.periodo : "30";
  const customFrom = isIsoDate(search.da) ? search.da : "";
  const customTo = isIsoDate(search.a) ? search.a : "";
  const customValido = periodo === "custom" && !!customFrom && !!customTo;
  const [seeding, setSeeding] = useState(false);
  const [draftFrom, setDraftFrom] = useState(customFrom);
  const [draftTo, setDraftTo] = useState(customTo);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    setDraftFrom(customFrom);
    setDraftTo(customTo);
  }, [customFrom, customTo]);

  useEffect(() => {
    if (
      search.periodo !== undefined &&
      periodo !== "custom" &&
      (!isPeriodo(search.periodo) || search.periodo === "30")
    ) {
      void navigate({ to: "/", search: {}, replace: true });
    }
  }, [navigate, periodo, search.periodo]);

  const applyCustom = () => {
    if (!isIsoDate(draftFrom) || !isIsoDate(draftTo)) {
      toast.error("Seleziona una data di inizio e una di fine");
      return;
    }
    const [da, a] = draftFrom <= draftTo ? [draftFrom, draftTo] : [draftTo, draftFrom];
    setCustomOpen(false);
    void navigate({ to: "/", search: { periodo: "custom", da, a }, replace: true });
  };

  const dashFn = useServerFn(getDashboardOperativa);
  const { data, error, isPending, isError, refetch, isFetching } = useQuery({
    // La chiave inizia con "dashboard" così le invalidazioni esistenti
    // (approvazione rapportino, budget, stato commessa) la raggiungono.
    queryKey: ["dashboard", "operativa", periodo, customFrom, customTo],
    queryFn: async () =>
      await dashFn({
        data:
          periodo === "custom"
            ? { periodo, from: customFrom, to: customTo }
            : { periodo },
      }),

    staleTime: 45_000,
    retry: (failureCount, queryError) =>
      failureCount < 1 &&
      !/unauthorized|non autenticato|sessione scaduta|organizzazione non trovata/i.test(
        String(queryError instanceof Error ? queryError.message : queryError),
      ),
  });

  const dashboardErrorMessage = String(error instanceof Error ? error.message : error ?? "");
  const sessionExpired = /unauthorized|non autenticato|sessione scaduta/i.test(
    dashboardErrorMessage,
  );
  const organizationUnavailable = /organizzazione non trovata|utente disattivato/i.test(
    dashboardErrorMessage,
  );

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await seedDemoData();
      toast.success("Dati demo caricati");
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setSeeding(false);
    }
  };

  const kpi = data?.kpi;
  const econ = data?.economia ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard operativa</h1>
          <p className="text-sm text-muted-foreground">
            Cosa richiede attenzione oggi · {PERIODO_LABEL[periodo]}
            {customValido && ` (${dateIt(customFrom)} — ${dateIt(customTo)})`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["oggi", "7", "30", "mese"] as PeriodoKey[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={p === periodo ? "default" : "outline"}
              onClick={() =>
                navigate({
                  to: "/",
                  search: p === "30" ? {} : { periodo: p },
                  replace: true,
                })
              }
            >
              {PERIODO_LABEL[p]}
            </Button>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant={periodo === "custom" ? "default" : "outline"}>
                <CalendarClock className="mr-1.5 h-4 w-4" />
                {customValido ? `${dateIt(customFrom)} — ${dateIt(customTo)}` : "Personalizzato"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="periodo-da">Dal</Label>
                <Input
                  id="periodo-da"
                  type="date"
                  value={draftFrom}
                  max={draftTo || undefined}
                  onChange={(e) => setDraftFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodo-a">Al</Label>
                <Input
                  id="periodo-a"
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  onChange={(e) => setDraftTo(e.target.value)}
                />
              </div>
              <div className="flex justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCustomOpen(false);
                    void navigate({ to: "/", search: {}, replace: true });
                  }}
                >
                  Azzera
                </Button>
                <Button size="sm" onClick={applyCustom}>
                  Applica
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {!isPending && !isError && data?.isEmpty && (
            <Button onClick={handleSeed} disabled={seeding}>
              {seeding ? "Caricamento..." : "Carica dati demo"}
            </Button>
          )}
        </div>
      </header>

      {isPending ? (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card role="alert" data-testid="dashboard-error" className="border-destructive/40">
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-semibold">
                {sessionExpired
                  ? "La sessione è scaduta."
                  : organizationUnavailable
                    ? "L'organizzazione non è disponibile."
                    : "Non è stato possibile caricare la Dashboard."}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {sessionExpired
                ? "Accedi nuovamente per continuare."
                : organizationUnavailable
                  ? "Contatta l'amministratore per verificare il tuo profilo."
                  : "Controlla la connessione e riprova. Se il problema persiste, contatta l'amministratore dell'organizzazione."}
            </p>
            {sessionExpired ? (
              <Button onClick={() => navigate({ to: "/auth", replace: true })} className="min-h-11">
                Accedi di nuovo
              </Button>
            ) : (
              <Button onClick={() => refetch()} disabled={isFetching} className="min-h-11">
                {isFetching ? "Nuovo tentativo..." : "Riprova"}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Commesse critiche"
              value={String(kpi?.commesseCritiche ?? 0)}
              icon={AlertTriangle}
              tone={(kpi?.commesseCritiche ?? 0) > 0 ? "destructive" : "success"}
              hint={`${kpi?.commesseInCorso ?? 0} in corso`}
              to="/commesse"
            />
            <KpiCard
              title="Rapportini da approvare"
              value={String(kpi?.rapportiniDaApprovare ?? 0)}
              icon={ClipboardCheck}
              tone={(kpi?.rapportiniDaApprovare ?? 0) > 0 ? "warning" : "default"}
              to="/rapportini"
              search={{ stato: "inviato" }}
            />
            <KpiCard
              title="Ore nel periodo"
              value={`${num(kpi?.orePeriodo, 1)} h`}
              icon={Clock}
              hint={`${num(kpi?.oreApprovate, 1)} h approvate`}
              to="/rapportini"
            />
            <KpiCard
              title="Documenti scaduti"
              value={String(kpi?.documentiScaduti ?? 0)}
              icon={CalendarClock}
              tone={(kpi?.documentiScaduti ?? 0) > 0 ? "destructive" : "default"}
              hint={`${kpi?.documentiInScadenza ?? 0} in scadenza (30gg)`}
              to="/scadenziario"
            />
            <KpiCard
              title="Preventivi aperti"
              value={String(kpi?.preventiviAperti ?? 0)}
              icon={FileText}
              to="/preventivi"
            />
            <KpiCard
              title="Cantieri attivi"
              value={String(kpi?.cantieriAttivi ?? 0)}
              icon={HardHat}
              tone="warning"
              to="/commesse"
            />
            {econ && (
              <>
                <KpiCard
                  title="Valore commesse attive"
                  value={eur(econ.valoreCommesse)}
                  icon={Coins}
                  tone="success"
                  to="/commesse"
                />
                <KpiCard
                  title="Margine previsto"
                  value={eur(econ.marginePrevisto)}
                  icon={TrendingUp}
                  tone={econ.marginePrevisto >= 0 ? "success" : "destructive"}
                  hint={
                    econ.margineMediaPct !== null
                      ? `${num(econ.margineMediaPct, 1)}% medio`
                      : undefined
                  }
                  to="/commesse"
                />
                <KpiCard
                  title="Costi sostenuti"
                  value={eur(econ.costiSostenuti)}
                  icon={Wallet}
                  hint={
                    econ.manodoperaContabilizzata
                      ? `${eur(econ.manodoperaContabilizzata)} di manodopera`
                      : undefined
                  }
                  to="/commesse"
                />
                {econ.manodoperaDaContabilizzare !== null && (
                  <KpiCard
                    title="Manodopera da contabilizzare"
                    value={String(econ.manodoperaDaContabilizzare)}
                    icon={Coins}
                    tone={econ.manodoperaDaContabilizzare > 0 ? "warning" : "default"}
                    hint={
                      econ.manodoperaPendente && econ.manodoperaPendente.righe > 0
                        ? `${econ.manodoperaPendente.rapportini} rapportini · ${econ.manodoperaPendente.persone} persone`
                        : undefined
                    }
                    to="/costi-personale"
                  />
                )}
                {econ.costiExtra && (
                  <KpiCard
                    title="Materiali e subappalti"
                    value={eur(econ.costiExtra.totale)}
                    icon={Wallet}
                    hint={`${eur(econ.costiExtra.materiali)} materiali · ${eur(econ.costiExtra.subappalti)} subappalti`}
                    to="/rapportini"
                  />
                )}



              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard
              title="Commesse che richiedono attenzione"
              icon={AlertTriangle}
              action={
                <Link
                  to="/commesse"
                  className="text-xs text-primary hover:underline whitespace-nowrap"
                >
                  Tutte <ArrowRight className="inline h-3 w-3" />
                </Link>
              }
            >
              {(data?.commesseCritiche ?? []).length === 0 && (
                <Empty text="Nessuna criticità rilevata. Ottimo." />
              )}
              {(data?.commesseCritiche ?? []).map((c: any) => (
                <Link
                  key={c.id}
                  to="/commesse/$commessaId"
                  params={{ commessaId: c.id }}
                  className="block rounded-lg border p-3 hover:border-primary/50 hover:bg-muted/40 transition"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        <span className="font-mono text-xs text-muted-foreground mr-2">
                          {c.codice}
                        </span>
                        {c.denominazione}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.alerts.map((a: any) => (
                          <Badge
                            key={a.code}
                            variant={sevVariant(a.severity) as any}
                            className="text-[11px]"
                          >
                            {a.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-muted-foreground">
                        {dateIt(c.data_fine_prevista)}
                      </div>
                      <Progress
                        value={Number(c.avanzamento_pct ?? 0)}
                        className="mt-2 w-24 h-1.5"
                      />
                    </div>
                  </div>
                </Link>
              ))}
            </SectionCard>

            <SectionCard
              title="Rapportini da approvare"
              icon={ClipboardCheck}
              action={
                <Link
                  to="/rapportini"
                  search={{ stato: "inviato" } as any}
                  className="text-xs text-primary hover:underline whitespace-nowrap"
                >
                  Apri lista <ArrowRight className="inline h-3 w-3" />
                </Link>
              }
            >
              {!data?.capabilities.canApprove && <Empty text="Non hai permessi di approvazione." />}
              {data?.capabilities.canApprove &&
                (data?.rapportiniDaApprovare ?? []).length === 0 && (
                  <Empty text="Nessun rapportino in attesa." />
                )}
              {(data?.rapportiniDaApprovare ?? []).map((r: any) => (
                <Link
                  key={r.id}
                  to="/rapportini/$rapportinoId"
                  params={{ rapportinoId: r.id }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3 hover:border-primary/50 hover:bg-muted/40 transition"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.autore}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.commessa
                        ? `${r.commessa.codice} — ${r.commessa.denominazione}`
                        : "Senza commessa"}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-sm">
                    <div className="font-medium">{r.ore.toFixed(2)} h</div>
                    <div className="text-xs text-muted-foreground">{dateIt(r.data)}</div>
                  </div>
                </Link>
              ))}

              {(data?.mieiRapportini ?? []).length > 0 && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    I miei rapportini da completare
                  </div>
                  {(data?.mieiRapportini ?? []).map((r: any) => (
                    <Link
                      key={r.id}
                      to="/rapportini/$rapportinoId"
                      params={{ rapportinoId: r.id }}
                      className="flex items-center justify-between gap-3 py-1.5 text-sm hover:text-primary"
                    >
                      <span className="truncate">
                        {dateIt(r.data)} · {r.commessa?.codice ?? "—"}
                      </span>
                      <Badge
                        variant={r.stato === "respinto" ? "destructive" : "outline"}
                        className="shrink-0"
                      >
                        {r.stato === "respinto" ? "Respinto" : "Bozza"}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Scadenze documentali"
              icon={CalendarClock}
              action={
                <Link
                  to="/scadenziario"
                  className="text-xs text-primary hover:underline whitespace-nowrap"
                >
                  Scadenziario <ArrowRight className="inline h-3 w-3" />
                </Link>
              }
            >
              {(data?.documenti ?? []).length === 0 && (
                <Empty text="Nessun documento in scadenza nei prossimi 30 giorni." />
              )}
              {(data?.documenti ?? []).map((d: any) => (
                <div
                  key={d.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b last:border-0 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{d.nome}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {d.categoria ?? "—"}
                    </div>
                  </div>
                  <Badge variant={d.scaduto ? "destructive" : "secondary"} className="shrink-0">
                    {dateIt(d.data_scadenza)}
                  </Badge>
                </div>
              ))}
            </SectionCard>

            <SectionCard title="Attività CRM in scadenza" icon={PhoneCall}>
              {(data?.attivita ?? []).length === 0 && (
                <Empty text="Nessuna attività pianificata nei prossimi 7 giorni." />
              )}
              {(data?.attivita ?? []).map((a: any) => (
                <Link
                  key={a.id}
                  to="/clienti/$clienteId"
                  params={{ clienteId: a.cliente_id }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b last:border-0 py-2 hover:text-primary"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.titolo}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.cliente?.denominazione ?? "Cliente"} · {a.tipo}
                    </div>
                  </div>
                  <Badge
                    variant={
                      a.priorita === "urgente" || a.priorita === "alta" ? "destructive" : "outline"
                    }
                    className="shrink-0"
                  >
                    {dateIt(a.scadenza)}
                  </Badge>
                </Link>
              ))}
            </SectionCard>
          </div>

          {false && (
            <SectionCard
              title="Ultime attività"
              icon={Activity}
              action={
                <Link
                  to="/audit"
                  className="text-xs text-primary hover:underline whitespace-nowrap"
                >
                  Audit log <ArrowRight className="inline h-3 w-3" />
                </Link>
              }
            >
              {(data?.attivitaRecenti ?? []).length === 0 && (
                <Empty text="Nessuna attività registrata." />
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                {(data?.attivitaRecenti ?? []).map((a: any) => (
                  <div
                    key={a.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b last:border-0 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">{a.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.autore}</div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {dateIt(a.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

        </>
      )}
    </div>
  );
}
