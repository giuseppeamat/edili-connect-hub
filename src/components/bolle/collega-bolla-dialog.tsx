import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collegaBollaRapportino, listBollaOpzioni } from "@/lib/bolle.functions";
import { extraKeys, invalidaArchivioBolle } from "@/lib/rapportini-extra.keys";
import { dateIt } from "@/lib/format";

const NONE = "__none__";

export function CollegaBollaDialog({
  bolla,
  onOpenChange,
}: {
  bolla: any | null;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const optFn = useServerFn(listBollaOpzioni);
  const collegaFn = useServerFn(collegaBollaRapportino);

  const [commessaId, setCommessaId] = useState(NONE);
  const [cantiereId, setCantiereId] = useState(NONE);
  const [rapportinoId, setRapportinoId] = useState(NONE);

  useEffect(() => {
    setCommessaId(bolla?.commessa_id ?? NONE);
    setCantiereId(bolla?.cantiere_id ?? NONE);
    setRapportinoId(NONE);
  }, [bolla]);

  const { data: opzioni } = useQuery({
    queryKey: extraKeys.opzioni(
      commessaId === NONE ? null : commessaId,
      cantiereId === NONE ? null : cantiereId,
    ),
    enabled: !!bolla,
    queryFn: async () =>
      (await optFn({
        data: {
          commessa_id: commessaId === NONE ? null : commessaId,
          cantiere_id: cantiereId === NONE ? null : cantiereId,
        },
      })) as any,
  });

  const collega = useMutation({
    mutationFn: async () =>
      await collegaFn({ data: { id: bolla.id, rapportino_id: rapportinoId } }),
    onSuccess: () => {
      toast.success("Bolla collegata al rapportino");
      invalidaArchivioBolle(qc, { id: bolla.id, rapportinoId });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Collegamento non riuscito"),
  });

  const commessaBloccata = !!bolla?.commessa_id;

  return (
    <Dialog open={!!bolla} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Collega a rapportino</DialogTitle>
          <DialogDescription>
            Il documento, il file e le righe materiali restano gli stessi: non viene creata una
            seconda bolla.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Commessa</Label>
            <Select
              value={commessaId}
              onValueChange={(v) => {
                setCommessaId(v);
                setCantiereId(NONE);
                setRapportinoId(NONE);
              }}
              disabled={commessaBloccata}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {(opzioni?.commesse ?? []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.codice} — {c.titolo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Cantiere (facoltativo)</Label>
            <Select
              value={cantiereId}
              onValueChange={(v) => {
                setCantiereId(v);
                setRapportinoId(NONE);
              }}
              disabled={commessaId === NONE}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Tutti</SelectItem>
                {(opzioni?.cantieri ?? []).map((k: any) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.codice} — {k.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rapportino *</Label>
            <Select
              value={rapportinoId}
              onValueChange={setRapportinoId}
              disabled={commessaId === NONE}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona…" />
              </SelectTrigger>
              <SelectContent>
                {(opzioni?.rapportini ?? []).map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>
                    {dateIt(r.data)} — {r.lavorazione ?? r.stato}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            disabled={rapportinoId === NONE || collega.isPending}
            onClick={() => collega.mutate()}
          >
            Collega
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
