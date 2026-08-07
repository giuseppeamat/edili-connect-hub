import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Calculator, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { eur, num } from "@/lib/format";
import {
  costoOrarioStruttura,
  costoIndustrialeOrario,
  oreProduttiveAnnue,
  simulaCostoOrario,
  type OreProduttiveConfig,
  type CostoStrutturaInput,
} from "@/lib/costi-struttura";
import { saveCostiStrutturaConfig, calcolaCostoOrarioVersione } from "@/lib/costi-struttura.functions";

type Kpi = {
  totaleAnnualizzato: number;
  oreProduttive: number;
  costoOrarioStruttura: number;
  costoPersonaleMedio: number;
  costoIndustrialeOrario: number;
};

export function CostoOrarioTab({
  anno,
  kpi,
  config,
  oreConfig,
  costi,
  canWrite,
}: {
  anno: number;
  kpi: Kpi;
  config: any;
  oreConfig: OreProduttiveConfig;
  costi: CostoStrutturaInput[];
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const saveCfgFn = useServerFn(saveCostiStrutturaConfig);
  const calcFn = useServerFn(calcolaCostoOrarioVersione);
  const [cfg, setCfg] = useState({
    includi_personale_diretto: Boolean(config.includi_personale_diretto),
    includi_costo_personale_in_industriale: config.includi_costo_personale_in_industriale !== false,
    includi_costo_struttura_in_industriale: config.includi_costo_struttura_in_industriale !== false,
    includi_costo_mezzi_in_industriale: Boolean(config.includi_costo_mezzi_in_industriale),
    costo_mezzi_orario: String(config.costo_mezzi_orario ?? 0),
    altri_overhead_orario: String(config.altri_overhead_orario ?? 0),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["costi-struttura"] });

  const saveCfg = useMutation({
    mutationFn: async () =>
      saveCfgFn({
        data: {
          includi_personale_diretto: cfg.includi_personale_diretto,
          includi_costo_personale_in_industriale: cfg.includi_costo_personale_in_industriale,
          includi_costo_struttura_in_industriale: cfg.includi_costo_struttura_in_industriale,
          includi_costo_mezzi_in_industriale: cfg.includi_costo_mezzi_in_industriale,
          costo_mezzi_orario: Number(cfg.costo_mezzi_orario || 0),
          altri_overhead_orario: Number(cfg.altri_overhead_orario || 0),
        },
      }),
    onSuccess: () => { invalidate(); toast.success("Configurazione salvata"); },
    onError: (e: any) => toast.error(e.message),
  });

  const calcola = useMutation({
    mutationFn: async (v: { origine: "calcolo" | "simulazione"; override?: any; note?: string }) =>
      calcFn({ data: { anno, origine: v.origine, override: v.override ?? null, note: v.note ?? null } }),
    onSuccess: (r: any) => {
      invalidate();
      toast.success(`Versione v${r.versione} creata · ${eur(r.costo_orario_struttura)}/h`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Simulatore ──
  const [sim, setSim] = useState({
    costiAggiuntivi: "0",
    dipendenti: String(oreConfig.dipendenti_produttivi ?? 0),
    oreTeoriche: String(oreConfig.ore_teoriche_persona ?? 0),
    assenteismo: "0",
    manuale: false,
    oreManuali: String(oreProduttiveAnnue(oreConfig)),
  });

  const simCfg: OreProduttiveConfig = {
    ...oreConfig,
    dipendenti_produttivi: Number(sim.dipendenti || 0),
    ore_teoriche_persona: Number(sim.oreTeoriche || 0),
    usa_manuale: sim.manuale,
    ore_produttive_manuali: Number(sim.oreManuali || 0),
  };
  const simResult = simulaCostoOrario({
    costi,
    anno,
    includiPersonaleDiretto: cfg.includi_personale_diretto,
    costiAggiuntivi: Number(sim.costiAggiuntivi || 0),
    oreConfig: simCfg,
    assenteismoPct: Number(sim.assenteismo || 0),
  });

  const industrialePreview = costoIndustrialeOrario(
    {
      costoPersonaleMedio: kpi.costoPersonaleMedio,
      costoStruttura: kpi.costoOrarioStruttura,
      costoMezzi: Number(cfg.costo_mezzi_orario || 0),
      altriOverhead: Number(cfg.altri_overhead_orario || 0),
    },
    cfg,
  );

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader><CardTitle>Costo orario di struttura {anno}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Metric label="Costi struttura annui" value={eur(kpi.totaleAnnualizzato)} />
            <Metric label="Ore produttive" value={`${num(kpi.oreProduttive, 0)} h`} />
            <Metric
              label="Costo struttura"
              value={`${eur(kpi.costoOrarioStruttura)}/h`}
              highlight
            />
          </div>
          {kpi.oreProduttive <= 0 && (
            <Alert className="mt-4">
              <AlertTitle>Ore produttive non configurate</AlertTitle>
              <AlertDescription>
                Configura le ore produttive dell'anno per ottenere il costo orario di struttura.
              </AlertDescription>
            </Alert>
          )}
          {canWrite && (
            <div className="flex justify-end mt-4">
              <Button onClick={() => calcola.mutate({ origine: "calcolo" })} disabled={calcola.isPending}>
                <Calculator className="h-4 w-4 mr-1" /> Calcola e crea versione
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Costo orario completo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Component
              label="A · Costo personale diretto medio"
              value={`${eur(kpi.costoPersonaleMedio)}/h`}
              checked={cfg.includi_costo_personale_in_industriale}
              disabled={!canWrite}
              onChange={(v) => setCfg({ ...cfg, includi_costo_personale_in_industriale: v })}
            />
            <Component
              label="B · Costo struttura per ora"
              value={`${eur(kpi.costoOrarioStruttura)}/h`}
              checked={cfg.includi_costo_struttura_in_industriale}
              disabled={!canWrite}
              onChange={(v) => setCfg({ ...cfg, includi_costo_struttura_in_industriale: v })}
            />
            <Component
              label="C · Costo mezzi medio"
              value={`${eur(Number(cfg.costo_mezzi_orario || 0))}/h`}
              checked={cfg.includi_costo_mezzi_in_industriale}
              disabled={!canWrite}
              onChange={(v) => setCfg({ ...cfg, includi_costo_mezzi_in_industriale: v })}
            />
            <div className="flex items-center justify-between py-2">
              <span>D · Altri overhead</span>
              <span className="font-medium">{eur(Number(cfg.altri_overhead_orario || 0))}/h</span>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="font-semibold">E · Costo industriale orario</span>
            <span className="text-2xl font-bold">{eur(industrialePreview)}/h</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Nessuna componente viene sommata automaticamente: attiva solo quelle non già incluse altrove.
          </p>

          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Costo mezzi €/h</Label>
              <Input
                type="number" step="0.01" disabled={!canWrite}
                value={cfg.costo_mezzi_orario}
                onChange={(e) => setCfg({ ...cfg, costo_mezzi_orario: e.target.value })}
              />
            </div>
            <div>
              <Label>Altri overhead €/h</Label>
              <Input
                type="number" step="0.01" disabled={!canWrite}
                value={cfg.altri_overhead_orario}
                onChange={(e) => setCfg({ ...cfg, altri_overhead_orario: e.target.value })}
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-2 pt-2 border-t">
              <Switch
                id="pers-diretto"
                checked={cfg.includi_personale_diretto}
                disabled={!canWrite}
                onCheckedChange={(v) => setCfg({ ...cfg, includi_personale_diretto: v })}
              />
              <div>
                <Label htmlFor="pers-diretto" className="font-normal">
                  Include costo personale diretto nel calcolo struttura
                </Label>
                <p className="text-xs text-muted-foreground">
                  Disattivato (consigliato): il personale diretto è già contabilizzato nei rapportini.
                </p>
              </div>
            </div>
          </div>
          {canWrite && (
            <div className="flex justify-end">
              <Button onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending}>
                Salva configurazione
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Simula costo orario</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Le modifiche in questa sezione non alterano i dati reali.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Costi aggiuntivi annui €</Label>
              <Input type="number" step="100" value={sim.costiAggiuntivi}
                onChange={(e) => setSim({ ...sim, costiAggiuntivi: e.target.value })} />
            </div>
            <div>
              <Label>Dipendenti produttivi</Label>
              <Input type="number" value={sim.dipendenti}
                onChange={(e) => setSim({ ...sim, dipendenti: e.target.value })} />
            </div>
            <div>
              <Label>Ore teoriche / persona</Label>
              <Input type="number" value={sim.oreTeoriche}
                onChange={(e) => setSim({ ...sim, oreTeoriche: e.target.value })} />
            </div>
            <div>
              <Label>Assenteismo aggiuntivo %</Label>
              <Input type="number" min={0} max={100} value={sim.assenteismo}
                onChange={(e) => setSim({ ...sim, assenteismo: e.target.value })} />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch id="sim-manuale" checked={sim.manuale}
                onCheckedChange={(v) => setSim({ ...sim, manuale: v })} />
              <Label htmlFor="sim-manuale" className="font-normal">Ore produttive manuali</Label>
            </div>
            {sim.manuale && (
              <div>
                <Label>Ore produttive</Label>
                <Input type="number" value={sim.oreManuali}
                  onChange={(e) => setSim({ ...sim, oreManuali: e.target.value })} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-lg border p-4 bg-muted/30">
            <Metric label="Costi simulati" value={eur(simResult.totaleAnnualizzato)} />
            <Metric label="Ore produttive simulate" value={`${num(simResult.oreProduttive, 0)} h`} />
            <Metric label="Costo struttura simulato" value={`${eur(simResult.costoOrarioStruttura)}/h`} highlight />
          </div>
          {canWrite && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                disabled={calcola.isPending}
                onClick={() =>
                  calcola.mutate({
                    origine: "simulazione",
                    override: {
                      totale_costi_annualizzati: simResult.totaleAnnualizzato,
                      ore_produttive: simResult.oreProduttive,
                    },
                    note: "Salvata da simulatore",
                  })
                }
              >
                <Save className="h-4 w-4 mr-1" /> Salva come nuova versione
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={highlight ? "text-2xl font-bold text-primary" : "text-2xl font-bold"}>{value}</div>
    </div>
  );
}

function Component({
  label, value, checked, disabled, onChange,
}: { label: string; value: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
        <span>{label}</span>
      </div>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export { costoOrarioStruttura };
