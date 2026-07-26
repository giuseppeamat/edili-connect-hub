import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardOverview } from "@/lib/commesse.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { eur, num } from "@/lib/format";
import { seedDemoData } from "@/lib/seed-demo";
import { toast } from "sonner";
import { useState } from "react";
import {
  FileText,
  HardHat,
  Coins,
  TrendingUp,
  CalendarClock,
  Clock,
  Receipt,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — CantiereOS" },
      { name: "description", content: "Panoramica commesse, preventivi, cantieri e scadenze." },
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
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  tone?: "default" | "warning" | "success" | "destructive";
  to?: string;
}) {
  const toneCls = {
    default: "bg-primary/10 text-primary",
    warning: "bg-[color:var(--warning)]/15 text-[color:var(--warning-foreground)]",
    success: "bg-[color:var(--success)]/15 text-[color:var(--success)]",
    destructive: "bg-destructive/10 text-destructive",
  }[tone];
  const body = (
    <CardContent className="p-4 md:p-5 flex items-start gap-3">
      <div className={`rounded-lg p-2.5 ${toneCls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</div>
        <div className="text-2xl font-bold truncate">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
    </CardContent>
  );
  if (to) {
    return (
      <Link
        to={to as any}
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


function Dashboard() {
  const qc = useQueryClient();
  const [seeding, setSeeding] = useState(false);

  const overviewFn = useServerFn(getDashboardOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => await overviewFn(),
  });


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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Panoramica in tempo reale della tua impresa</p>
        </div>
        {!isLoading && data?.totalRecords === 0 && (
          <Button onClick={handleSeed} disabled={seeding} variant="default">
            {seeding ? "Caricamento..." : "Carica dati demo"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Preventivi aperti" value={String(data?.preventiviAperti ?? 0)} icon={FileText} to="/preventivi" />
        {data?.canViewEconomics && (
          <KpiCard title="Valore commesse" value={eur(data?.valoreCommesse)} icon={Coins} tone="success" to="/commesse" />
        )}
        <KpiCard title="Cantieri attivi" value={String(data?.cantieriAttivi ?? 0)} icon={HardHat} tone="warning" to="/commesse" />
        {data?.canViewEconomics && (
          <KpiCard title="Costi sostenuti" value={eur(data?.costiSostenuti)} icon={Wallet} to="/commesse" />
        )}
        {data?.canViewEconomics && (
          <KpiCard title="Margine previsto" value={eur(data?.marginePrevisto)} icon={TrendingUp} tone={Number(data?.marginePrevisto ?? 0) >= 0 ? "success" : "destructive"} to="/commesse" />
        )}
        <KpiCard title="Documenti in scadenza (30gg)" value={String(data?.docsInScadenza ?? 0)} icon={CalendarClock} tone="warning" to="/scadenziario" />
        <KpiCard title="Ore lavorate (mese)" value={num(data?.oreMese, 1) + " h"} icon={Clock} to="/rapportini" />
        {data?.canViewEconomics && (
          <KpiCard title="SAL da emettere" value={String(data?.salDaEmettere ?? 0)} icon={Receipt} to="/commesse" />
        )}

      </div>

      <Card>
        <CardHeader>
          <CardTitle>Benvenuto in CantiereOS</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Usa il menu laterale per accedere ai moduli: anagrafiche, preventivi, cantieri, rapportini e documenti.</p>
          <p>Tutti i dati sono isolati per organizzazione tramite Row Level Security nel database.</p>
        </CardContent>
      </Card>
    </div>
  );
}
