import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateIt } from "@/lib/format";
import { CATEGORIE_DOCUMENTO, giorniAllaScadenza } from "@/lib/documenti-model";
import { listScadenziario } from "@/lib/documenti.functions";
import { documentiKeys } from "@/lib/documenti.keys";
import { statoScadenzaBadge, statoScadenzaLabel } from "@/components/documenti/documenti-table";

export const Route = createFileRoute("/_authenticated/scadenziario")({
  head: () => ({
    meta: [
      { title: "Scadenziario — CantiereOS" },
      {
        name: "description",
        content:
          "Documenti scaduti e in scadenza dell'impresa edile, raggruppati per finestra temporale.",
      },
      { property: "og:title", content: "Scadenziario — CantiereOS" },
      {
        property: "og:description",
        content: "Monitoraggio scadenze documentali: scaduti, 7, 30 e 60 giorni.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScadenziarioPage,
});

const ALL = "__all__";

const GROUPS = [
  { key: "scaduti", label: "Scaduti", test: (g: number | null) => g !== null && g < 0 },
  { key: "oggi", label: "In scadenza oggi", test: (g: number | null) => g === 0 },
  { key: "7", label: "Entro 7 giorni", test: (g: number | null) => g !== null && g > 0 && g <= 7 },
  {
    key: "30",
    label: "Entro 30 giorni",
    test: (g: number | null) => g !== null && g > 7 && g <= 30,
  },
  {
    key: "60",
    label: "Entro 60 giorni",
    test: (g: number | null) => g !== null && g > 30 && g <= 60,
  },
  { key: "oltre", label: "Oltre 60 giorni", test: (g: number | null) => g !== null && g > 60 },
];

function ScadenziarioPage() {
  const listFn = useServerFn(listScadenziario);
  const [filtro, setFiltro] = useState("default");
  const [categoria, setCategoria] = useState(ALL);

  const filters = {
    filtro,
    categoria: categoria === ALL ? null : categoria,
    includeArchived: false,
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: documentiKeys.scadenziario(filters),
    queryFn: () => listFn({ data: filters }),
  });

  const items = data?.items ?? [];
  const groups = GROUPS.map((g) => ({
    ...g,
    items: items.filter((d: any) => g.test(giorniAllaScadenza(d.data_scadenza))),
  })).filter((g) => filtro !== "default" || g.items.length > 0 || g.key !== "oltre");

  return (
    <div>
      <PageHeader
        title="Scadenziario"
        description="Documenti in scadenza raggruppati per finestra temporale"
        actions={
          <Button variant="outline" asChild>
            <Link to="/documenti">Archivio documenti</Link>
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
          <div>
            <Label>Finestra</Label>
            <Select value={filtro} onValueChange={setFiltro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Scaduti e prossimi 60 giorni</SelectItem>
                <SelectItem value="scaduti">Solo scaduti</SelectItem>
                <SelectItem value="7">Entro 7 giorni</SelectItem>
                <SelectItem value="30">Entro 30 giorni</SelectItem>
                <SelectItem value="60">Entro 60 giorni</SelectItem>
                <SelectItem value="tutti">Tutti i documenti</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutte</SelectItem>
                {CATEGORIE_DOCUMENTO.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {isLoading && <div className="text-sm text-muted-foreground">Caricamento…</div>}
      {isError && (
        <Card className="p-6 text-sm">
          <p className="text-destructive">{(error as any)?.message ?? "Errore di caricamento."}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
            Riprova
          </Button>
        </Card>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <Card key={g.key}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">{g.label}</CardTitle>
                <Badge variant={g.key === "scaduti" ? "destructive" : "outline"}>
                  {g.items.length}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {g.items.length === 0 && (
                  <div className="text-sm text-muted-foreground">Nessun documento</div>
                )}
                {g.items.map((d: any) => (
                  <div
                    key={d.id}
                    className="flex justify-between items-center gap-2 text-sm border-b last:border-0 pb-2 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        to="/documenti/$documentoId"
                        params={{ documentoId: d.id }}
                        className="font-medium truncate hover:underline block"
                      >
                        {d.nome}
                      </Link>
                      <div className="text-xs text-muted-foreground truncate">
                        {[d.categoria, d.commessa?.label].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs whitespace-nowrap">{dateIt(d.data_scadenza)}</div>
                      <Badge variant={statoScadenzaBadge(d.stato_scadenza)} className="mt-1">
                        {statoScadenzaLabel[d.stato_scadenza]}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
