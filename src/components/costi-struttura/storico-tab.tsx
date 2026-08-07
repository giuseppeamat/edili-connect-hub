import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { eur, num, dateIt } from "@/lib/format";
import { STATO_LABELS, type CostoOrarioStato } from "@/lib/costi-struttura";
import { approvaCostoOrarioVersione } from "@/lib/costi-struttura.functions";

const variant = (s: CostoOrarioStato) =>
  s === "approvato" ? "default" : s === "archiviato" ? "outline" : "secondary";

export function StoricoTab({ versioni, canWrite }: { versioni: any[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const approvaFn = useServerFn(approvaCostoOrarioVersione);

  const approva = useMutation({
    mutationFn: async (id: string) => approvaFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["costi-struttura"] });
      toast.success("Costo orario approvato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Storico costo orario</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Anno</TableHead>
              <TableHead>Versione</TableHead>
              <TableHead className="text-right">Costi annualizzati</TableHead>
              <TableHead className="text-right">Ore produttive</TableHead>
              <TableHead className="text-right">Costo struttura €/h</TableHead>
              <TableHead className="text-right">Costo industriale €/h</TableHead>
              <TableHead>Data calcolo</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {versioni.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nessuna versione calcolata.
                </TableCell>
              </TableRow>
            )}
            {versioni.map((v) => (
              <TableRow key={v.id}>
                <TableCell>{v.anno}</TableCell>
                <TableCell>
                  v{v.versione}
                  {v.origine === "simulazione" && (
                    <Badge variant="outline" className="ml-2">Simulazione</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{eur(v.totale_costi_annualizzati)}</TableCell>
                <TableCell className="text-right">{num(v.ore_produttive, 0)} h</TableCell>
                <TableCell className="text-right font-medium">{eur(v.costo_orario_struttura)}</TableCell>
                <TableCell className="text-right">{eur(v.costo_industriale_orario)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{dateIt(v.data_calcolo)}</TableCell>
                <TableCell>
                  <Badge variant={variant(v.stato)}>{STATO_LABELS[v.stato as CostoOrarioStato]}</Badge>
                  {v.approvato_at && (
                    <div className="text-xs text-muted-foreground mt-1">{dateIt(v.approvato_at)}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canWrite && (v.stato === "bozza" || v.stato === "calcolato") && (
                    <Button size="sm" variant="outline" onClick={() => approva.mutate(v.id)} disabled={approva.isPending}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approva
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          Una versione approvata non è più modificabile: per variazioni successive viene creata una nuova versione.
          I preventivi già emessi conservano il valore congelato al momento dell'applicazione.
        </p>
      </CardContent>
    </Card>
  );
}
