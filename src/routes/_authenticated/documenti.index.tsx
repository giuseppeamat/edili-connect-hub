import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, CalendarClock } from "lucide-react";
import { listDocumenti } from "@/lib/documenti.functions";
import { documentiKeys } from "@/lib/documenti.keys";
import { CATEGORIE_DOCUMENTO } from "@/lib/documenti-model";
import { DocumentiTable } from "@/components/documenti/documenti-table";
import { DocumentoUploadDialog } from "@/components/documenti/documento-upload-dialog";

export const Route = createFileRoute("/_authenticated/documenti/")({
  head: () => ({
    meta: [
      { title: "Documenti — CantiereOS" },
      {
        name: "description",
        content:
          "Archivio documentale dell'impresa: certificazioni, contratti, POS e DURC con scadenze e versioni.",
      },
      { property: "og:title", content: "Documenti — CantiereOS" },
      {
        property: "og:description",
        content: "Archivio documentale con scadenze, versioni e controllo accessi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentiPage,
});

const ALL = "__all__";
const PAGE_SIZE = 25;

function DocumentiPage() {
  const listFn = useServerFn(listDocumenti);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState(ALL);
  const [scadenza, setScadenza] = useState(ALL);
  const [uploadStato, setUploadStato] = useState("disponibile");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState("updated_at");
  const [page, setPage] = useState(1);

  const filters = {
    q: q.trim() || null,
    categoria: categoria === ALL ? null : categoria,
    stato_scadenza: scadenza === ALL ? null : (scadenza as any),
    includeArchived,
    upload_stato: uploadStato as any,
    sort: sort as any,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: documentiKeys.list(filters),
    queryFn: () => listFn({ data: filters }),
  });

  const caps = data?.capabilities;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Documenti"
        description={data ? `${total} documenti` : "Archivio documentale"}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/scadenziario"><CalendarClock className="h-4 w-4 mr-1" />Scadenziario</Link>
            </Button>
            {caps?.canUpload && (
              <Button onClick={() => setOpen(true)}>
                <Upload className="h-4 w-4 mr-1" />Nuovo documento
              </Button>
            )}
          </div>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label htmlFor="doc-q">Ricerca</Label>
            <Input
              id="doc-q"
              value={q}
              placeholder="Nome documento…"
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={categoria} onValueChange={(v) => { setCategoria(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutte</SelectItem>
                {CATEGORIE_DOCUMENTO.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Stato scadenza</Label>
            <Select value={scadenza} onValueChange={(v) => { setScadenza(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutti</SelectItem>
                <SelectItem value="scaduto">Scaduti</SelectItem>
                <SelectItem value="in_scadenza">In scadenza (30 gg)</SelectItem>
                <SelectItem value="valido">Validi</SelectItem>
                <SelectItem value="senza_scadenza">Senza scadenza</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ordinamento</Label>
            <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at">Ultima modifica</SelectItem>
                <SelectItem value="created_at">Data creazione</SelectItem>
                <SelectItem value="data_scadenza">Scadenza</SelectItem>
                <SelectItem value="nome">Nome</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-3">
          <div className="flex items-center gap-2">
            <Switch
              id="arch"
              checked={includeArchived}
              onCheckedChange={(v) => { setIncludeArchived(v); setPage(1); }}
            />
            <Label htmlFor="arch" className="text-sm">Includi archiviati</Label>
          </div>
          {caps?.canAdmin && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">Stato upload</Label>
              <Select value={uploadStato} onValueChange={(v) => { setUploadStato(v); setPage(1); }}>
                <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disponibile">Disponibili</SelectItem>
                  <SelectItem value="preparato">In attesa di file</SelectItem>
                  <SelectItem value="fallito">Upload falliti</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </Card>

      <Card>
        {isLoading && <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>}
        {isError && (
          <div className="p-6 text-sm">
            <p className="text-destructive">{(error as any)?.message ?? "Errore di caricamento."}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>Riprova</Button>
          </div>
        )}
        {data && (
          <DocumentiTable
            items={data.items}
            canManage={!!caps?.canManage}
            canUpload={!!caps?.canUpload}
          />
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">Pagina {page} di {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Precedente
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Successiva
            </Button>
          </div>
        </div>
      )}

      <DocumentoUploadDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
