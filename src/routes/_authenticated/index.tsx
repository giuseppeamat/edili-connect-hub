import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [prev, comm, rapp, doc] = await Promise.all([
        supabase.from("preventivi").select("id, stato, totale"),
        supabase.from("commesse").select("id, stato, importo, costi_sostenuti, budget_costi"),
        supabase.from("rapportini").select("ore, data"),
        supabase.from("documenti").select("id, data_scadenza, stato"),
      ]);
      const preventiviAperti = (prev.data ?? []).filter((p) => ["bozza", "inviato"].includes(p.stato)).length;
      const commesseAttive = (comm.data ?? []).filter((c) => c.stato === "in_corso");
      const valoreCommesse = commesseAttive.reduce((s, c) => s + Number(c.importo ?? 0), 0);
      const costiSostenuti = commesseAttive.reduce((s, c) => s + Number(c.costi_sostenuti ?? 0), 0);
      const marginePrevisto = valoreCommesse - commesseAttive.reduce((s, c) => s + Number(c.budget_costi ?? 0), 0);
      const today = new Date();
      const in30 = new Date();
      in30.setDate(today.getDate() + 30);
      const docsInScadenza = (doc.data ?? []).filter((d) => {
        if (!d.data_scadenza) return false;
        const dt = new Date(d.data_scadenza);
        return dt <= in30;
      }).length;
      const oreMese = (rapp.data ?? [])
        .filter((r) => new Date(r.data).getMonth() === today.getMonth())
        .reduce((s, r) => s + Number(r.ore ?? 0), 0);
      const salDaEmettere = commesseAttive.filter((c) => Number(c.costi_sostenuti) > 0).length;

      return {
        preventiviAperti,
        valoreCommesse,
        cantieriAttivi: commesseAttive.length,
        costiSostenuti,
        marginePrevisto,
        docsInScadenza,
        oreMese,
        salDaEmettere,
        totalRecords: (prev.data?.length ?? 0) + (comm.data?.length ?? 0),
      };
    },
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
        <KpiCard title="Valore commesse" value={eur(data?.valoreCommesse)} icon={Coins} tone="success" to="/commesse" />
        <KpiCard title="Cantieri attivi" value={String(data?.cantieriAttivi ?? 0)} icon={HardHat} tone="warning" to="/commesse" />
        <KpiCard title="Costi sostenuti" value={eur(data?.costiSostenuti)} icon={Wallet} to="/commesse" />
        <KpiCard title="Margine previsto" value={eur(data?.marginePrevisto)} icon={TrendingUp} tone={Number(data?.marginePrevisto ?? 0) >= 0 ? "success" : "destructive"} to="/commesse" />
        <KpiCard title="Documenti in scadenza (30gg)" value={String(data?.docsInScadenza ?? 0)} icon={CalendarClock} tone="warning" to="/scadenziario" />
        <KpiCard title="Ore lavorate (mese)" value={num(data?.oreMese, 1) + " h"} icon={Clock} to="/rapportini" />
        <KpiCard title="SAL da emettere" value={String(data?.salDaEmettere ?? 0)} icon={Receipt} to="/commesse" />
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
