import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ScanLine } from "lucide-react";
import { estraiDatiBolla, type EsitoEstrazione } from "@/lib/bolle-estrazione.functions";
import { ERR_NON_RICONOSCIUTO } from "@/lib/bolle-estrazione";
import { validateFile } from "@/lib/documenti-model";

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Carica un PDF/foto della bolla, lo fa analizzare e passa i dati proposti
 * alla schermata di verifica. Il file non viene salvato finché non confermi.
 */
export function BollaImportDialog({
  open,
  onOpenChange,
  onEstratto,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEstratto: (payload: { esito: EsitoEstrazione; file: File }) => void;
}) {
  const estrai = useServerFn(estraiDatiBolla);
  const [file, setFile] = useState<File | null>(null);

  const analisi = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Seleziona un file.");
      if (file.size === 0) throw new Error("Il file è vuoto.");
      const check = validateFile({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      if (!check.ok) throw new Error(check.error);
      const esito = (await estrai({
        data: {
          file_base64: await fileToBase64(file),
          file_name: file.name,
          mime_type: file.type,
        },
      })) as EsitoEstrazione;
      return { esito, file };
    },
    onSuccess: (payload) => {
      if (!payload.esito.riconosciuta) toast.warning(ERR_NON_RICONOSCIUTO);
      else toast.success("Dati estratti: verifica e conferma");
      setFile(null);
      onOpenChange(false);
      onEstratto(payload);
    },
    onError: (e: any) => toast.error(e?.message ?? "Lettura del documento non riuscita"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (analisi.isPending ? null : onOpenChange(v))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Carica bolla PDF</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="imp-file">File della bolla</Label>
            <Input
              id="imp-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              PDF o foto della bolla, massimo 15 MB. I dati vengono letti dal documento e proposti
              per la verifica: nulla viene salvato prima della tua conferma.
            </p>
          </div>
          {analisi.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analisi del documento in corso…
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={analisi.isPending}>
            Annulla
          </Button>
          <Button disabled={!file || analisi.isPending} onClick={() => analisi.mutate()}>
            <ScanLine className="h-4 w-4 mr-1" />
            Analizza documento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
