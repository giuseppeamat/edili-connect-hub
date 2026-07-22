import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dateIt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/scadenziario")({
  head: () => ({
    meta: [
      { title: "Scadenziario — CantiereOS" },
      { name: "description", content: "Documenti scaduti e in scadenza." },
    ],
  }),
  component: ScadenziarioPage,
});

const buckets = [
  { key: "scaduti", label: "Scaduti", days: -1, tone: "destructive" as const },
  { key: "7", label: "Entro 7 giorni", days: 7, tone: "warning" as const },
  { key: "15", label: "Entro 15 giorni", days: 15, tone: "warning" as const },
  { key: "30", label: "Entro 30 giorni", days: 30, tone: "default" as const },
  { key: "60", label: "Entro 60 giorni", days: 60, tone: "default" as const },
];

function ScadenziarioPage() {
  const { data: docs = [] } = useQuery({
    queryKey: ["scadenze"],
    queryFn: async () => (await supabase.from("documenti").select("*").not("data_scadenza", "is", null).order("data_scadenza")).data ?? [],
  });

  const groups = buckets.map((b) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = (docs as any[]).filter((d) => {
      const sc = new Date(d.data_scadenza);
      const diff = Math.floor((sc.getTime() - today.getTime()) / 86400000);
      if (b.key === "scaduti") return diff < 0;
      if (b.key === "7") return diff >= 0 && diff <= 7;
      if (b.key === "15") return diff > 7 && diff <= 15;
      if (b.key === "30") return diff > 15 && diff <= 30;
      if (b.key === "60") return diff > 30 && diff <= 60;
      return false;
    });
    return { ...b, items };
  });

  return (
    <div>
      <PageHeader title="Scadenziario" description="Documenti in scadenza per categoria temporale" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">{g.label}</CardTitle>
              <Badge variant={g.tone === "destructive" ? "destructive" : g.tone === "warning" ? "secondary" : "outline"}>{g.items.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {g.items.length === 0 && <div className="text-sm text-muted-foreground">Nessun documento</div>}
              {g.items.map((d) => (
                <div key={d.id} className="flex justify-between items-center text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.nome}</div>
                    <div className="text-xs text-muted-foreground">{d.categoria}</div>
                  </div>
                  <div className="text-xs whitespace-nowrap ml-2">{dateIt(d.data_scadenza)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
