import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Archive, ArchiveRestore, Download, Eye, FilePlus2, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/components/commesse/confirm-dialog";
import { MSG_ARCHIVE_CHAIN, MSG_RESTORE_CHAIN, categoriaLabel } from "@/lib/documenti-model";
import { dateIt } from "@/lib/format";
import { CATEGORIE_DOCUMENTO, scadenzaLabel } from "@/lib/documenti-model";
import {
  archiveDocumento,
  getDocumento,
  listDocumentoVersioni,
  restoreDocumento,
  updateDocumento,
} from "@/lib/documenti.functions";
import { documentiKeys, invalidateDocumenti } from "@/lib/documenti.keys";
import {
  statoScadenzaBadge,
  statoScadenzaLabel,
  useDocumentoFileActions,
} from "@/components/documenti/documenti-table";
import { DocumentoUploadDialog } from "@/components/documenti/documento-upload-dialog";

export const Route = createFileRoute("/_authenticated/documenti/$documentoId")({
  head: () => ({
    meta: [
      { title: "Dettaglio documento — CantiereOS" },
      {
        name: "description",
        content: "Metadata, associazioni, scadenza, versioni e storico di un documento aziendale.",
      },
      { property: "og:title", content: "Dettaglio documento — CantiereOS" },
      {
        property: "og:description",
        content: "Scheda documento con scadenza, versioni e tracciamento delle modifiche.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentoDetailPage,
});

const NONE = "__none__";

const AUDIT_LABEL: Record<string, string> = {
  documento_preparato: "Documento preparato",
  documento_upload_finalizzato: "File caricato",
  documento_modificato: "Metadata modificati",
  documento_archiviato: "Documento archiviato",
  documento_ripristinato: "Documento ripristinato",
  documento_versione_preparata: "Nuova versione preparata",
  documento_versione_finalizzata: "Nuova versione pubblicata",
  documento_upload_fallito: "Upload non riuscito",
};

function DocumentoDetailPage() {
  const { documentoId } = useParams({ from: "/_authenticated/documenti/$documentoId" });
  const qc = useQueryClient();
  const getFn = useServerFn(getDocumento);
  const versioniFn = useServerFn(listDocumentoVersioni);
  const archiveFn = useServerFn(archiveDocumento);
  const restoreFn = useServerFn(restoreDocumento);
  const { download, preview } = useDocumentoFileActions();
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState(false);

  const { data: doc, isLoading, isError, error, refetch } = useQuery({
    queryKey: documentiKeys.detail(documentoId),
    queryFn: () => getFn({ data: { id: documentoId } }),
    retry: false,
  });

  const { data: versioni = [] } = useQuery({
    queryKey: documentiKeys.versions(documentoId),
    queryFn: () => versioniFn({ data: { id: documentoId } }),
    enabled: !!doc,
  });

  const { data: audit = [] } = useQuery({
    queryKey: ["audit", "documenti", documentoId],
    enabled: !!doc,
    queryFn: async () =>
      (
        await supabase
          .from("audit_log")
          .select("id, action, created_at, user_id")
          .eq("entity", "documenti")
          .eq("entity_id", documentoId)
          .order("created_at", { ascending: false })
          .limit(20)
      ).data ?? [],
  });

  const [confirm, setConfirm] = useState<"archive" | "restore" | null>(null);

  const archive = useMutation({
    mutationFn: () => archiveFn({ data: { id: documentoId } }),
    onSuccess: () => {
      invalidateDocumenti(qc, { id: documentoId });
      toast.success("Documento archiviato");
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });
  const restore = useMutation({
    mutationFn: () => restoreFn({ data: { id: documentoId } }),
    onSuccess: () => {
      invalidateDocumenti(qc, { id: documentoId });
      toast.success("Documento ripristinato");
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  if (isError || !doc) {
    return (
      <div className="p-6">
        <p className="text-destructive text-sm">
          {(error as any)?.message ?? "Elemento non trovato."}
        </p>
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => refetch()}>Riprova</Button>
          <Button size="sm" asChild><Link to="/documenti">Torna ai documenti</Link></Button>
        </div>
      </div>
    );
  }

  const caps = doc.capabilities;

  return (
    <div>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm === "restore" ? "Ripristina documento" : "Archivia documento"}
        description={confirm === "restore" ? MSG_RESTORE_CHAIN : MSG_ARCHIVE_CHAIN}
        confirmLabel={confirm === "restore" ? "Ripristina" : "Archivia"}
        isPending={archive.isPending || restore.isPending}
        onConfirm={async () => {
          if (confirm === "archive") await archive.mutateAsync();
          else if (confirm === "restore") await restore.mutateAsync();
          setConfirm(null);
        }}
      />
      <PageHeader
        title={doc.nome}
        description={`Versione ${doc.versione}${doc.archived_at ? " — archiviato" : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild size="sm"><Link to="/documenti">Elenco</Link></Button>
            {doc.upload_stato === "disponibile" && doc.preview_supportata && (
              <Button size="sm" variant="outline" onClick={() => preview(doc.id)}>
                <Eye className="h-4 w-4 mr-1" />Anteprima
              </Button>
            )}
            {doc.upload_stato === "disponibile" && (
              <Button size="sm" variant="outline" onClick={() => download(doc.id)}>
                <Download className="h-4 w-4 mr-1" />Scarica
              </Button>
            )}
            {caps.canManage && !doc.archived_at && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-1" />Modifica
              </Button>
            )}
            {caps.canNewVersion && (
              <Button size="sm" variant="outline" onClick={() => setNewVersion(true)}>
                <FilePlus2 className="h-4 w-4 mr-1" />Nuova versione
              </Button>
            )}
            {caps.canArchive && (
              <Button size="sm" variant="outline" onClick={() => setConfirm("archive")}>
                <Archive className="h-4 w-4 mr-1" />Archivia
              </Button>
            )}
            {caps.canRestore && (
              <Button size="sm" variant="outline" onClick={() => setConfirm("restore")}>
                <ArchiveRestore className="h-4 w-4 mr-1" />Ripristina
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Dati documento</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label="Categoria" value={categoriaLabel(doc.categoria)} />
            <Field label="Visibilità" value={doc.visibilita} />
            <Field label="Data documento" value={doc.data_documento ? dateIt(doc.data_documento) : "—"} />
            <Field
              label="Scadenza"
              value={
                <span className="flex items-center gap-2">
                  {doc.data_scadenza ? dateIt(doc.data_scadenza) : "—"}
                  <Badge variant={statoScadenzaBadge(doc.stato_scadenza)}>
                    {statoScadenzaLabel[doc.stato_scadenza]}
                  </Badge>
                </span>
              }
            />
            <Field label="Stato scadenza" value={scadenzaLabel(doc.data_scadenza)} />
            <Field label="Autore" value={doc.autore ?? "—"} />
            <Field label="Cliente" value={doc.cliente?.label ?? "—"} />
            <Field label="Commessa" value={doc.commessa?.label ?? "—"} />
            <Field label="Cantiere" value={doc.cantiere?.label ?? "—"} />
            <Field label="Fornitore" value={doc.fornitore?.label ?? "—"} />
            <div className="sm:col-span-2">
              <Field label="Descrizione" value={doc.descrizione ?? "—"} />
            </div>
            <div className="sm:col-span-2">
              <Field label="Note versione" value={doc.note_versione ?? "—"} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">File</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Nome file" value={doc.file_name_originale ?? "—"} />
            <Field label="Formato" value={doc.mime_type ?? "—"} />
            <Field
              label="Dimensione"
              value={doc.file_size ? `${(doc.file_size / 1024 / 1024).toFixed(2)} MB` : "—"}
            />
            <Field label="Versione" value={`v${doc.versione}${doc.is_versione_corrente ? " (corrente)" : ""}`} />
            {doc.upload_stato === "preparato" && (
              <p className="text-muted-foreground">
                Il file non è ancora stato caricato per questo documento.
              </p>
            )}
            {doc.upload_stato === "fallito" && (
              <p className="text-destructive">Il file caricato non è disponibile.</p>
            )}
            {doc.upload_stato === "disponibile" && !doc.preview_supportata && (
              <p className="text-muted-foreground">Anteprima non disponibile per questo formato.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Storico versioni</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(versioni as any[]).length === 0 && (
              <div className="text-muted-foreground">Nessuna versione registrata.</div>
            )}
            {(versioni as any[]).map((v) => (
              <div key={v.id} className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0">
                <div>
                  <Link
                    to="/documenti/$documentoId"
                    params={{ documentoId: v.id }}
                    className="font-medium hover:underline"
                  >
                    v{v.versione} — {v.file_name_originale ?? v.nome}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {dateIt(v.created_at)} · {v.autore ?? "—"} · {v.upload_stato}
                  </div>
                </div>
                {v.is_versione_corrente && <Badge>Corrente</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Storico attività</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(audit as any[]).length === 0 && (
              <div className="text-muted-foreground">Nessuna attività registrata.</div>
            )}
            {(audit as any[]).map((a) => (
              <div key={a.id} className="border-b last:border-0 pb-2 last:pb-0">
                <div>{AUDIT_LABEL[a.action] ?? a.action}</div>
                <div className="text-xs text-muted-foreground">{dateIt(a.created_at)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <EditDialog open={editing} onOpenChange={setEditing} doc={doc} />
      <DocumentoUploadDialog
        open={newVersion}
        onOpenChange={setNewVersion}
        documentoId={doc.id}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}

function EditDialog({
  open,
  onOpenChange,
  doc,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: any;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateDocumento);
  const [categoria, setCategoria] = useState<string>(doc.categoria ?? NONE);
  const [visibilita, setVisibilita] = useState<string>(doc.visibilita ?? "organizzazione");

  const save = useMutation({
    mutationFn: async (fd: FormData) =>
      updateFn({
        data: {
          id: doc.id,
          expected_updated_at: doc.updated_at,
          nome: (fd.get("nome") as string)?.trim(),
          descrizione: (fd.get("descrizione") as string) || null,
          categoria: categoria === NONE ? null : categoria,
          data_documento: (fd.get("data_documento") as string) || null,
          data_scadenza: (fd.get("data_scadenza") as string) || null,
          visibilita: visibilita as any,
          cliente_id: doc.cliente?.id ?? null,
          fornitore_id: doc.fornitore?.id ?? null,
          commessa_id: doc.commessa?.id ?? null,
          cantiere_id: doc.cantiere?.id ?? null,
          preventivo_id: doc.preventivo_id ?? null,
          dipendente_id: doc.dipendente_id ?? null,
        },
      }),
    onSuccess: () => {
      invalidateDocumenti(qc, {
        id: doc.id,
        commessaId: doc.commessa?.id,
        cantiereId: doc.cantiere?.id,
        clienteId: doc.cliente?.id,
      });
      toast.success("Documento aggiornato");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Modifica documento</DialogTitle></DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(new FormData(e.currentTarget));
          }}
        >
          <div>
            <Label htmlFor="ed-nome">Nome *</Label>
            <Input id="ed-nome" name="nome" defaultValue={doc.nome} required maxLength={200} />
          </div>
          <div>
            <Label htmlFor="ed-descr">Descrizione</Label>
            <Textarea id="ed-descr" name="descrizione" rows={3} defaultValue={doc.descrizione ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {CATEGORIE_DOCUMENTO.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visibilità</Label>
              <Select value={visibilita} onValueChange={setVisibilita}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="organizzazione">Organizzazione</SelectItem>
                  <SelectItem value="privato">Privato</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ed-dd">Data documento</Label>
              <Input id="ed-dd" name="data_documento" type="date" defaultValue={doc.data_documento ?? ""} />
            </div>
            <div>
              <Label htmlFor="ed-ds">Scadenza</Label>
              <Input id="ed-ds" name="data_scadenza" type="date" defaultValue={doc.data_scadenza ?? ""} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
