import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown } from "lucide-react";
import { eur, num } from "@/lib/format";
import {
  totaliPerCategoria,
  andamentoMensile,
  variazionePct,
  totaleAnnualizzato,
  GRUPPI_LABELS,
  type CostoStrutturaInput,
} from "@/lib/costi-struttura";

const MESI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

export function DashboardTab({
  anno,
  kpi,
  costi,
  categorie,
  includiPersonaleDiretto,
}: {
  anno: number;
  kpi: {
    totaleAnnualizzato: number;
    totaleAnnoPrecedente: number;
    oreProduttive: number;
    costoOrarioStruttura: number;
    costoPersonaleMedio: number;
    costoIndustrialeOrario: number;
  };
  costi: CostoStrutturaInput[];
  categorie: { id: string; nome: string; gruppo: string }[];
  includiPersonaleDiretto: boolean;
}) {
  const opts = { includiPersonaleDiretto };
  const catById = useMemo(() => new Map(categorie.map((c) => [c.id, c])), [categorie]);
  const perCategoria = useMemo(() => totaliPerCategoria(costi, anno, opts).slice(0, 8), [costi, anno, includiPersonaleDiretto]);
  const mensile = useMemo(() => andamentoMensile(costi as any, anno, opts), [costi, anno, includiPersonaleDiretto]);
  const maxMensile = Math.max(...mensile, 1);
  const variazione = variazionePct(kpi.totaleAnnualizzato, kpi.totaleAnnoPrecedente);
  const anni = useMemo(() => {
    const out: { anno: number; totale: number }[] = [];
    for (let y = anno - 2; y <= anno; y++) out.push({ anno: y, totale: totaleAnnualizzato(costi, y, opts) });
    return out;
  }, [costi, anno, includiPersonaleDiretto]);
  const maxAnni = Math.max(...anni.map((a) => a.totale), 1);

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Costi annualizzati" value={eur(kpi.totaleAnnualizzato)} />
        <Kpi label="Costi mensili medi" value={eur(kpi.totaleAnnualizzato / 12)} />
        <Kpi label="Ore produttive" value={`${num(kpi.oreProduttive, 0)} h`} />
        <Kpi label="Costo struttura" value={`${eur(kpi.costoOrarioStruttura)}/h`} highlight />
        <Kpi label="Costo personale medio" value={`${eur(kpi.costoPersonaleMedio)}/h`} />
        <Kpi label="Costo industriale" value={`${eur(kpi.costoIndustrialeOrario)}/h`} highlight />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Distribuzione costi per categoria</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {perCategoria.length === 0 && (
              <p className="text-sm text-muted-foreground">Nessun costo per l'anno {anno}.</p>
            )}
            {perCategoria.map((c) => {
              const cat = catById.get(c.categoria_id);
              return (
                <div key={c.categoria_id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>
                      {cat?.nome ?? "—"}
                      <span className="text-muted-foreground text-xs ml-2">
                        {cat ? (GRUPPI_LABELS[cat.gruppo] ?? cat.gruppo) : ""}
                      </span>
                    </span>
                    <span className="font-medium">{eur(c.totale)} · {num(c.percentuale, 1)}%</span>
                  </div>
                  <Progress value={c.percentuale} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Andamento mensile {anno}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-40">
              {mensile.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-primary/70"
                    style={{ height: `${Math.max((v / maxMensile) * 100, 2)}%` }}
                    title={eur(v)}
                  />
                  <span className="text-[10px] text-muted-foreground">{MESI[i]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Confronto tra anni</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {anni.map((a) => (
              <div key={a.anno}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{a.anno}</span>
                  <span className="font-medium">{eur(a.totale)}</span>
                </div>
                <Progress value={(a.totale / maxAnni) * 100} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Variazione anno precedente</CardTitle></CardHeader>
          <CardContent>
            {variazione === null ? (
              <p className="text-sm text-muted-foreground">
                Nessun dato per l'anno {anno - 1}: confronto non disponibile.
              </p>
            ) : (
              <div className="flex items-center gap-3">
                {variazione >= 0 ? (
                  <TrendingUp className="h-8 w-8 text-destructive" />
                ) : (
                  <TrendingDown className="h-8 w-8 text-primary" />
                )}
                <div>
                  <div className="text-3xl font-bold">
                    {variazione > 0 ? "+" : ""}{num(variazione, 1)}%
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {anno - 1}: {eur(kpi.totaleAnnoPrecedente)}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={highlight ? "text-xl font-bold text-primary" : "text-xl font-bold"}>{value}</div>
      </CardContent>
    </Card>
  );
}
