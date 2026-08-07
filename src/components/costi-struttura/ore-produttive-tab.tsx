import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { num } from "@/lib/format";
import { oreProduttiveAnnue, oreNonProduttivePerPersona, type OreProduttiveConfig } from "@/lib/costi-struttura";
import { saveOreProduttive } from "@/lib/costi-struttura.functions";

type Cfg = OreProduttiveConfig & { anno: number };

const FIELDS: { key: keyof OreProduttiveConfig; label: string }[] = [
  { key: "dipendenti_produttivi", label: "Numero dipendenti produttivi" },
  { key: "ore_teoriche_persona", label: "Ore teoriche annue per persona" },
  { key: "ore_ferie", label: "Ferie (h/persona)" },
  { key: "ore_permessi", label: "Permessi (h/persona)" },
  { key: "ore_festivita", label: "Festività (h/persona)" },
  { key: "ore_malattia", label: "Malattia stimata (h/persona)" },
  { key: "ore_formazione", label: "Formazione (h/persona)" },
  { key: "ore_amministrative", label: "Ore amministrative (h/persona)" },
  { key: "ore_non_produttive_altre", label: "Altre ore non produttive (h/persona)" },
];

export function OreProduttiveTab({ anno, config, canWrite }: { anno: number; config: Cfg; canWrite: boolean }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveOreProduttive);
  const [state, setState] = useState<OreProduttiveConfig>(config);

  const oreNonProd = oreNonProduttivePerPersona(state);
  const orePersona = Math.max(Number(state.ore_teoriche_persona ?? 0) - oreNonProd, 0);
  const oreTotali = oreProduttiveAnnue(state);

  const save = useMutation({
    mutationFn: async () =>
      saveFn({
        data: {
          anno,
          dipendenti_produttivi: Number(state.dipendenti_produttivi ?? 0),
          ore_teoriche_persona: Number(state.ore_teoriche_persona ?? 0),
          ore_ferie: Number(state.ore_ferie ?? 0),
          ore_permessi: Number(state.ore_permessi ?? 0),
          ore_festivita: Number(state.ore_festivita ?? 0),
          ore_malattia: Number(state.ore_malattia ?? 0),
          ore_formazione: Number(state.ore_formazione ?? 0),
          ore_amministrative: Number(state.ore_amministrative ?? 0),
          ore_non_produttive_altre: Number(state.ore_non_produttive_altre ?? 0),
          ore_produttive_manuali: state.usa_manuale ? Number(state.ore_produttive_manuali ?? 0) : null,
          usa_manuale: Boolean(state.usa_manuale),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["costi-struttura"] });
      toast.success("Ore produttive salvate");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Ore produttive {anno}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={String(f.key)}>
              <Label>{f.label}</Label>
              <Input
                type="number"
                step="0.5"
                min={0}
                disabled={!canWrite}
                value={String(state[f.key] ?? 0)}
                onChange={(e) => setState({ ...state, [f.key]: Number(e.target.value || 0) })}
              />
            </div>
          ))}
          <div className="md:col-span-2 flex items-center gap-2 pt-2 border-t">
            <Switch
              id="usa-manuale"
              checked={Boolean(state.usa_manuale)}
              disabled={!canWrite}
              onCheckedChange={(v) => setState({ ...state, usa_manuale: v })}
            />
            <Label htmlFor="usa-manuale" className="font-normal">
              Inserimento manuale delle ore produttive previste
            </Label>
          </div>
          {state.usa_manuale && (
            <div className="md:col-span-2">
              <Label>Ore produttive previste (totale organizzazione)</Label>
              <Input
                type="number"
                min={0}
                disabled={!canWrite}
                value={String(state.ore_produttive_manuali ?? 0)}
                onChange={(e) => setState({ ...state, ore_produttive_manuali: Number(e.target.value || 0) })}
              />
            </div>
          )}
          {canWrite && (
            <div className="md:col-span-2 flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>Salva</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Riepilogo</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Ore teoriche / persona" value={`${num(state.ore_teoriche_persona, 0)} h`} />
          <Row label="Ore non produttive / persona" value={`− ${num(oreNonProd, 0)} h`} />
          <Row label="Ore produttive / persona" value={`${num(orePersona, 0)} h`} />
          <Row label="Dipendenti produttivi" value={num(state.dipendenti_produttivi, 0)} />
          <div className="pt-3 border-t">
            <div className="text-xs text-muted-foreground">Ore produttive annue</div>
            <div className="text-2xl font-bold">{num(oreTotali, 0)} h</div>
            {state.usa_manuale && (
              <div className="text-xs text-muted-foreground mt-1">Valore inserito manualmente</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
