import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import {
  CATEGORIE_DOCUMENTO,
  categoriaLabel,
  DOCUMENTI_BUCKET,
  validateFile,
} from "@/lib/documenti-model";
import {
  prepareDocumentoUpload,
  finalizeDocumentoUpload,
  prepareDocumentoVersionUpload,
  finalizeDocumentoVersionUpload,
} from "@/lib/documenti.functions";
import { invalidateDocumenti } from "@/lib/documenti.keys";

const NONE = "__none__";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Modalità versione: carica una nuova versione del documento indicato. */
  documentoId?: string | null;
  /** Preset associazioni (es. dalla commessa). */
  preset?: {
    commessa_id?: string | null;
    cantiere_id?: string | null;
    cliente_id?: string | null;
    fornitore_id?: string | null;
    rapportino_id?: string | null;
  };
  lockPreset?: boolean;
};

export function DocumentoUploadDialog({
  open,
  onOpenChange,
  documentoId,
  preset,
  lockPreset,
}: Props) {
  const qc = useQueryClient();
  const isVersion = !!documentoId;
  const prepare = useServerFn(prepareDocumentoUpload);
  const finalize = useServerFn(finalizeDocumentoUpload);
  const prepareVer = useServerFn(prepareDocumentoVersionUpload);
  const finalizeVer = useServerFn(finalizeDocumentoVersionUpload);

  const [file, setFile] = useState<File | null>(null);
  const [commessaId, setCommessaId] = useState<string>(preset?.commessa_id ?? NONE);
  const [cantiereId, setCantiereId] = useState<string>(preset?.cantiere_id ?? NONE);
  const [clienteId, setClienteId] = useState<string>(preset?.cliente_id ?? NONE);
  const [categoria, setCategoria] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);

  const { data: commesse = [] } = useQuery({
    queryKey: ["documenti", "opts", "commesse"],
    enabled: open && !isVersion,
    queryFn: async () =>
      (await supabase.from("commesse").select("id, codice, denominazione").order("codice")).data ??
      [],
  });
  const { data: cantieri = [] } = useQuery({
    queryKey: ["documenti", "opts", "cantieri", commessaId],
    enabled: open && !isVersion && commessaId !== NONE,
    queryFn: async () =>
      (await supabase.from("cantieri").select("id, codice, nome").eq("commessa_id", commessaId))
        .data ?? [],
  });
  const { data: clienti = [] } = useQuery({
    queryKey: ["documenti", "opts", "clienti"],
    enabled: open && !isVersion,
    queryFn: async () =>
      (await supabase.from("clienti").select("id, denominazione").order("denominazione")).data ??
      [],
  });

  const reset = () => {
    setFile(null);
    setCategoria(NONE);
    if (!lockPreset) {
      setCommessaId(preset?.commessa_id ?? NONE);
      setCantiereId(preset?.cantiere_id ?? NONE);
      setClienteId(preset?.cliente_id ?? NONE);
    }
  };

  const mutation = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const fd = new FormData(form);
      if (!file) throw new Error("Seleziona un file.");
      const check = validateFile({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      if (!check.ok) throw new Error(check.error);

      const common = {
        file_name_originale: file.name,
        mime_type: file.type,
        file_size: file.size,
        note_versione: (fd.get("note_versione") as string) || null,
      };

      const prep = isVersion
        ? await prepareVer({ data: { documento_id: documentoId!, ...common } })
        : await prepare({
            data: {
              nome: (fd.get("nome") as string)?.trim(),
              descrizione: (fd.get("descrizione") as string) || null,
              categoria: categoria === NONE ? null : categoria,
              data_documento: (fd.get("data_documento") as string) || null,
              data_scadenza: (fd.get("data_scadenza") as string) || null,
              commessa_id: commessaId === NONE ? null : commessaId,
              cantiere_id: cantiereId === NONE ? null : cantiereId,
              cliente_id: clienteId === NONE ? null : clienteId,
              fornitore_id: preset?.fornitore_id ?? null,
              rapportino_id: preset?.rapportino_id ?? null,
              visibilita: "organizzazione" as const,
              ...common,
            },
          });

      const { error: upErr } = await supabase.storage
        .from(DOCUMENTI_BUCKET)
        .upload(prep.path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error("Caricamento del file non riuscito.");

      return isVersion
        ? await finalizeVer({ data: { document_id: prep.document_id } })
        : await finalize({ data: { document_id: prep.document_id } });
    },
    onSuccess: () => {
      invalidateDocumenti(qc, {
        id: documentoId ?? undefined,
        commessaId: commessaId === NONE ? undefined : commessaId,
        cantiereId: cantiereId === NONE ? undefined : cantiereId,
        clienteId: clienteId === NONE ? undefined : clienteId,
      });
      toast.success(isVersion ? "Nuova versione caricata" : "Documento caricato");
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (busy ? null : onOpenChange(v))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isVersion ? "Carica nuova versione" : "Nuovo documento"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            setBusy(true);
            mutation.mutate(form, { onSettled: () => setBusy(false) });
          }}
        >
          {!isVersion && (
            <>
              <div>
                <Label htmlFor="doc-nome">Nome *</Label>
                <Input id="doc-nome" name="nome" required maxLength={200} />
              </div>
              <div>
                <Label htmlFor="doc-descr">Descrizione</Label>
                <Textarea id="doc-descr" name="descrizione" rows={2} maxLength={2000} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Categoria</Label>
                  <Select value={categoria} onValueChange={setCategoria}>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {CATEGORIE_DOCUMENTO.map((c) => (
                        <SelectItem key={c} value={c}>
                          {categoriaLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Select value={clienteId} onValueChange={setClienteId} disabled={lockPreset}>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {(clienti as any[]).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.denominazione}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Commessa</Label>
                  <Select
                    value={commessaId}
                    onValueChange={(v) => {
                      setCommessaId(v);
                      setCantiereId(NONE);
                    }}
                    disabled={lockPreset}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {(commesse as any[]).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.codice} — {c.denominazione}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cantiere</Label>
                  <Select
                    value={cantiereId}
                    onValueChange={setCantiereId}
                    disabled={commessaId === NONE}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {(cantieri as any[]).map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.codice} — {k.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="doc-dd">Data documento</Label>
                  <Input id="doc-dd" name="data_documento" type="date" />
                </div>
                <div>
                  <Label htmlFor="doc-ds">Scadenza</Label>
                  <Input id="doc-ds" name="data_scadenza" type="date" />
                </div>
              </div>
            </>
          )}
          <div>
            <Label htmlFor="doc-note">Note versione</Label>
            <Input id="doc-note" name="note_versione" maxLength={500} />
          </div>
          <div>
            <Label htmlFor="doc-file">File *</Label>
            <Input
              id="doc-file"
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.dwg,.dxf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              PDF, immagini, DOCX, XLSX, DWG/DXF. Massimo 25 MB.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Caricamento..." : "Carica"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
