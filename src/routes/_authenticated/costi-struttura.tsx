import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-current-user";
import { canReadCostiStruttura } from "@/lib/costi-struttura";
import { getCostiStrutturaOverview } from "@/lib/costi-struttura.functions";
import { DashboardTab } from "@/components/costi-struttura/dashboard-tab";
import { CostiTab } from "@/components/costi-struttura/costi-tab";
import { CategorieTab } from "@/components/costi-struttura/categorie-tab";
import { OreProduttiveTab } from "@/components/costi-struttura/ore-produttive-tab";
import { CostoOrarioTab } from "@/components/costi-struttura/costo-orario-tab";
import { StoricoTab } from "@/components/costi-struttura/storico-tab";

const search = z.object({
  anno: z.coerce.number().int().min(1990).max(2200).optional(),
  tab: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/costi-struttura")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Costi della struttura — CantiereOS" },
      {
        name: "description",
        content:
          "Costi generali d'impresa, ore produttive e costo orario aziendale da applicare ai preventivi.",
      },
      { property: "og:title", content: "Costi della struttura — CantiereOS" },
      {
        property: "og:description",
        content: "Calcola il costo orario di struttura della tua impresa edile e usalo nei preventivi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostiStrutturaPage,
});

function CostiStrutturaPage() {
  const { roles, isLoading } = useCurrentUser();
  const navigate = useNavigate({ from: Route.fullPath });
  const { anno: annoSearch, tab } = Route.useSearch();
  const anno = annoSearch ?? new Date().getFullYear();
  const overviewFn = useServerFn(getCostiStrutturaOverview);

  const canRead = canReadCostiStruttura(roles);

  const { data, isLoading: loadingData } = useQuery({
    queryKey: ["costi-struttura", anno],
    queryFn: () => overviewFn({ data: { anno } }),
    enabled: canRead,
    staleTime: 30_000,
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Caricamento…</div>;

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Costi della struttura" />
        <Alert>
          <AlertTitle>Accesso limitato</AlertTitle>
          <AlertDescription>
            I valori economici della struttura sono riservati a Proprietario, Amministratore e Amministrazione.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const anniDisponibili = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() + 1 - i);

  return (
    <div>
      <PageHeader
        title="Costi della struttura"
        description="Costi generali dell'impresa, ore produttive e costo orario aziendale"
      />

      <div className="flex items-end gap-3 mb-4">
        <div>
          <Label className="text-xs">Anno</Label>
          <Select
            value={String(anno)}
            onValueChange={(v) => navigate({ search: (s: any) => ({ ...s, anno: Number(v) }) })}
          >
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {anniDisponibili.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingData || !data ? (
        <div className="p-6 text-muted-foreground">Caricamento dati economici…</div>
      ) : (
        <Tabs
          value={tab ?? "dashboard"}
          onValueChange={(v) => navigate({ search: (s: any) => ({ ...s, tab: v }) })}
        >
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="costi">Costi</TabsTrigger>
            <TabsTrigger value="categorie">Categorie</TabsTrigger>
            <TabsTrigger value="ore">Ore produttive</TabsTrigger>
            <TabsTrigger value="costo-orario">Costo orario</TabsTrigger>
            <TabsTrigger value="storico">Storico</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardTab
              anno={anno}
              kpi={data.kpi}
              costi={data.costi as any}
              categorie={data.categorie as any}
              includiPersonaleDiretto={Boolean((data.config as any).includi_personale_diretto)}
            />
          </TabsContent>
          <TabsContent value="costi">
            <CostiTab
              anno={anno}
              costi={data.costi as any}
              categorie={data.categorie as any}
              fornitori={data.fornitori as any}
              canWrite={data.canWrite}
            />
          </TabsContent>
          <TabsContent value="categorie">
            <CategorieTab categorie={data.categorie as any} canWrite={data.canWrite} />
          </TabsContent>
          <TabsContent value="ore">
            <OreProduttiveTab
              anno={anno}
              config={data.oreConfig as any}
              canWrite={data.canWrite}
            />
          </TabsContent>
          <TabsContent value="costo-orario">
            <CostoOrarioTab
              anno={anno}
              kpi={data.kpi}
              config={data.config as any}
              oreConfig={data.oreConfig as any}
              costi={data.costi as any}
              canWrite={data.canWrite}
            />
          </TabsContent>
          <TabsContent value="storico">
            <StoricoTab versioni={data.versioni as any} canWrite={data.canWrite} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
