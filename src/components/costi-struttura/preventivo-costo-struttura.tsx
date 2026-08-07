import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { eur, num } from "@/lib/format";
import {
  MODALITA_LABELS,
  calcolaCostoStrutturaPreventivo,
  type CsModalita,
} from "@/lib/costi-struttura";
import { getCostoStrutturaCorrente } from "@/lib/costi-struttura.functions";

const MODALITA: CsModalita[] = ["nessuno", "orario", "percentuale", "manuale"];

export function PreventivoCostoStruttura({
  preventivo,
  readOnly,
  onSave,
  saving,
}: {
  preventivo: any;
  readOnly: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const qc = useQueryClient();
  const correnteFn = useServerFn(getCostoStrutturaCorrente);
  const anno = new Date(preventivo.data_preventivo ?? Date.now()).getFullYear();

  const { data: corrente } = useQuery({
    queryKey: ["costo-struttura-corrente", anno],
    queryFn: () => correnteFn({ data: { anno } }),
    staleTime: 60_000,
  });

  const [form, setForm] = useState({
    modalita: (preventivo.costo_struttura_modalita ?? "nessuno") as CsModalita,
    ore: Number(preventivo.costo_struttura_ore ?? 0),
    tariffa: Number(preventivo.costo_struttura_tariffa ?? 0),
    pct: Number(preventivo.costo_struttura_pct ?? 0),
    manuale: Number(preventivo.costo_struttura_importo ?? 0),
  });

  useEffect(() => {
    setForm({
      modalita: (preventivo.costo_struttura_modalita ?? "nessuno") as CsModalita,
      ore: Number(preventivo.costo_struttura_ore ?? 0),
      tariffa: Number(preventivo.costo_struttura_tariffa ?? 0),
      pct: Number(preventivo.costo_struttura_pct ?? 0),
      manuale: Number(preventivo.costo_struttura_importo ?? 0),
    });
  }, [preventivo.id, preventivo.updated_at]);

  const imponibile = Number(preventivo.totale_ricavo ?? 0);
  const importo = calcolaCostoStrutturaPreventivo({
    modalita: form.modalita,
    ore: form.ore,
    tariffa: form.tariffa,
    percentuale: form.pct,
    importo_manuale: form.manuale,
    base_imponibile: imponibile,
  });
  const costoBase = Number(preventivo.totale_costo ?? 0);
  const margine = imponibile - costoBase - importo;
  const marginePct = imponibile > 0 ? (margine / imponibile) * 100 : 0;

  const salva = useMutation({
    mutationFn: async () => {
      onSave({
        costo_struttura_modalita: form.modalita,
        costo_struttura_ore: form.ore,
        costo_struttura_tariffa: form.tariffa,
        costo_struttura_pct: form.pct,
        costo_struttura_importo: importo,
        costo_struttura_versione_id: corrente?.versione_id ?? null,
        costo_struttura_versione_label: corrente?.label ?? null,
      });
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preventivo", preventivo.id] }),
  });

  const applicaTariffa = () => {
    if (!corrente?.costo_orario_struttura) {
      toast.error("Nessuna versione di costo orario approvata per l'anno " + anno);
      return;
    }
    setForm((f) => ({ ...f, modalita: "orario", tariffa: corrente.costo_orario_struttura }));
    toast.success(`Tariffa ${eur(corrente.costo_orario_struttura)}/h applicata (${corrente.label})`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          Costi della struttura
          {preventivo.costo_struttura_versione_label && (
            <Badge variant="outline">Congelato: {preventivo.costo_struttura_versione_label}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription className="text-sm">
            Il costo della struttura è una voce di costo separata dalla manodopera: non gonfia le tariffe
            orarie del personale e non viene mostrato al cliente nel PDF.
            {corrente?.label
              ? ` Tariffa aziendale ${anno}: ${eur(corrente.costo_orario_struttura)}/h (${corrente.label}).`
              : ` Nessuna versione approvata per il ${anno}.`}
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Modalità di imputazione</Label>
            <Select
              value={form.modalita}
              onValueChange={(v) => setForm({ ...form, modalita: v as CsModalita })}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODALITA.map((m) => (
                  <SelectItem key={m} value={m}>{MODALITA_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.modalita === "orario" && (
            <>
              <div>
                <Label>Ore previste</Label>
                <Input
                  type="number" step="0.5" value={form.ore}
                  onChange={(e) => setForm({ ...form, ore: Number(e.target.value) })}
                  disabled={readOnly}
                />
              </div>
              <div>
                <Label>Tariffa struttura €/h</Label>
                <div className="flex gap-2">
                  <Input
                    type="number" step="0.01" value={form.tariffa}
                    onChange={(e) => setForm({ ...form, tariffa: Number(e.target.value) })}
                    disabled={readOnly}
                  />
                  <Button type="button" variant="outline" onClick={applicaTariffa} disabled={readOnly}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {form.modalita === "percentuale" && (
            <div>
              <Label>Percentuale sull'imponibile</Label>
              <Input
                type="number" step="0.01" value={form.pct}
                onChange={(e) => setForm({ ...form, pct: Number(e.target.value) })}
                disabled={readOnly}
              />
            </div>
          )}

          {form.modalita === "manuale" && (
            <div>
              <Label>Importo manuale €</Label>
              <Input
                type="number" step="0.01" value={form.manuale}
                onChange={(e) => setForm({ ...form, manuale: Number(e.target.value) })}
                disabled={readOnly}
              />
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-4 rounded-lg border p-4">
          <Kpi label="Costo struttura" value={eur(importo)} />
          <Kpi label="Costi diretti" value={eur(costoBase)} />
          <Kpi label="Margine netto" value={eur(margine)} negative={margine < 0} />
          <Kpi label="Margine %" value={`${num(marginePct, 1)}%`} negative={margine < 0} />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => salva.mutate()} disabled={readOnly || saving}>
            <Save className="h-4 w-4 mr-1" />Salva costi struttura
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={negative ? "text-lg font-bold text-destructive" : "text-lg font-bold"}>{value}</div>
    </div>
  );
}
