import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Archive, ArchiveRestore, Download, Eye, FilePlus2 } from "lucide-react";
import { dateIt } from "@/lib/format";
import { canPreview, scadenzaLabel } from "@/lib/documenti-model";
import {
  archiveDocumento,
  createDocumentoDownloadUrl,
  createDocumentoPreviewUrl,
  restoreDocumento,
} from "@/lib/documenti.functions";
import { invalidateDocumenti } from "@/lib/documenti.keys";
import { DocumentoUploadDialog } from "@/components/documenti/documento-upload-dialog";

export const statoScadenzaBadge = (stato: string) => {
  if (stato === "scaduto") return "destructive" as const;
  if (stato === "in_scadenza") return "secondary" as const;
  if (stato === "valido") return "default" as const;
  return "outline" as const;
};

export const statoScadenzaLabel: Record<string, string> = {
  scaduto: "Scaduto",
  in_scadenza: "In scadenza",
  valido: "Valido",
  senza_scadenza: "Senza scadenza",
};

/** Apre una signed URL appena generata. Nessuna URL viene memorizzata. */
export function useDocumentoFileActions() {
  const dl = useServerFn(createDocumentoDownloadUrl);
  const pv = useServerFn(createDocumentoPreviewUrl);
  const open = async (fn: (a: any) => Promise<any>, id: string) => {
    try {
      const res = await fn({ data: { id } });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Operazione non riuscita");
    }
  };
  return {
    download: (id: string) => open(dl as any, id),
    preview: (id: string) => open(pv as any, id),
  };
}

type Props = {
  items: any[];
  canManage: boolean;
  canUpload: boolean;
  showCommessa?: boolean;
  emptyLabel?: string;
};

export function DocumentiTable({
  items,
  canManage,
  canUpload,
  showCommessa = true,
  emptyLabel = "Nessun documento.",
}: Props) {
  const qc = useQueryClient();
  const { download, preview } = useDocumentoFileActions();
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const archiveFn = useServerFn(archiveDocumento);
  const restoreFn = useServerFn(restoreDocumento);

  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: (_r, id) => {
      invalidateDocumenti(qc, { id });
      toast.success("Documento archiviato");
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });
  const restore = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: (_r, id) => {
      invalidateDocumenti(qc, { id });
      toast.success("Documento ripristinato");
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="hidden md:table-cell">Categoria</TableHead>
              {showCommessa && <TableHead className="hidden lg:table-cell">Commessa</TableHead>}
              <TableHead className="hidden sm:table-cell">Scadenza</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead className="hidden lg:table-cell">Ver.</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((d) => (
              <TableRow key={d.id} className={d.archived_at ? "opacity-60" : undefined}>
                <TableCell className="font-medium">
                  <Link
                    to="/documenti/$documentoId"
                    params={{ documentoId: d.id }}
                    className="hover:underline"
                  >
                    {d.nome}
                  </Link>
                  <div className="text-xs text-muted-foreground md:hidden">{d.categoria ?? "—"}</div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{d.categoria ?? "—"}</TableCell>
                {showCommessa && (
                  <TableCell className="hidden lg:table-cell text-sm">
                    {d.commessa?.label ?? "—"}
                  </TableCell>
                )}
                <TableCell className="hidden sm:table-cell text-sm">
                  {d.data_scadenza ? dateIt(d.data_scadenza) : "—"}
                  <div className="text-xs text-muted-foreground">
                    {scadenzaLabel(d.data_scadenza)}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={statoScadenzaBadge(d.stato_scadenza)}>
                    {statoScadenzaLabel[d.stato_scadenza] ?? d.stato_scadenza}
                  </Badge>
                  {d.upload_stato !== "disponibile" && (
                    <Badge variant="outline" className="ml-1">
                      {d.upload_stato === "preparato" ? "In attesa file" : "Upload fallito"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell">v{d.versione}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {d.upload_stato === "disponibile" && canPreview(d.mime_type) && (
                    <Button size="icon" variant="ghost" aria-label="Anteprima" onClick={() => preview(d.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  {d.upload_stato === "disponibile" && (
                    <Button size="icon" variant="ghost" aria-label="Scarica" onClick={() => download(d.id)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                  {canUpload && !d.archived_at && d.upload_stato === "disponibile" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Nuova versione"
                      onClick={() => setVersionFor(d.id)}
                    >
                      <FilePlus2 className="h-4 w-4" />
                    </Button>
                  )}
                  {canManage && !d.archived_at && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Archivia"
                      onClick={() => archive.mutate(d.id)}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                  {canManage && d.archived_at && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Ripristina"
                      onClick={() => restore.mutate(d.id)}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={showCommessa ? 7 : 6} className="text-center text-muted-foreground py-8">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DocumentoUploadDialog
        open={!!versionFor}
        onOpenChange={(v) => !v && setVersionFor(null)}
        documentoId={versionFor}
      />
    </>
  );
}
