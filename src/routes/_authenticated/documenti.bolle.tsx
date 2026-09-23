import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, MoreHorizontal, Plus } from "lucide-react";
import { listBolle, archiveBolla } from "@/lib/bolle.functions";
import { listSoggetti } from "@/lib/subappaltatori.functions";
import { extraKeys, invalidaArchivioBolle } from "@/lib/rapportini-extra.keys";
import { collegamentoBadge, statoBadge, bollaModificabile } from "@/lib/bolle-archivio";
import { BollaFormDialog } from "@/components/bolle/bolla-form-dialog";
import { CollegaBollaDialog } from "@/components/bolle/collega-bolla-dialog";
import { dateIt, eur } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/documenti/bolle")({
  head: () => ({
    meta: [
      { title: "Bolle e DDT — CantiereOS" },
      {
        name: "description",
        content:
          "Archivio delle bolle di consegna: registra una bolla anche senza rapportino e collegala in seguito.",
      },
      { property: "og:title", content: "Bolle e DDT — CantiereOS" },
      {
        property: "og:description",
        content: "Registra, archivia e collega le bolle dei fornitori ai rapportini di cantiere.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BollePage,
});

const ALL = "__all__";
const PAGE_SIZE = 25;

function BollePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listBolle);
  const fornFn = useServerFn(listSoggetti);
  const archiveFn = useServerFn(archiveBolla);

  const [q, setQ] = useState("");
  const [fornitore, setFornitore] = useState(ALL);
  const [collegamento, setCollegamento] = useState(ALL);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [collegaTarget, setCollegaTarget] = useState<any | null>(null);

  const filters = {
    q: q.trim() || null,
    fornitore_id: fornitore === ALL ? null : fornitore,
    collegamento: collegamento === ALL ? null : (collegamento as "collegata" | "non_collegata"),
    includeArchived,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: extraKeys.archivio(filters),
    queryFn: async () => (await listFn({ data: filters })) as any,
  });
  const { data: fornitori = [] } = useQuery({
    queryKey: extraKeys.fornitori("fornitore"),
    queryFn: async () => (await fornFn({ data: { tipo: "fornitore" as const } })) as any[],
  });

  const items: any[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canManage = !!data?.capabilities?.canManage;
  const canSeeEcon = !!data?.capabilities?.canSeeEcon;

  const archivia = useMutation({
    mutationFn: async (v: { id: string; archive: boolean }) => await archiveFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.archive ? "Bolla archiviata" : "Bolla ripristinata");
      invalidaArchivioBolle(qc, { id: v.id });
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });

  return (
    <div>
      <PageHeader
        title="Bolle e DDT"
        description={data ? `${total} bolle in archivio` : "Archivio bolle fornitori"}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/documenti">Documenti</Link>
            </Button>
            {canManage && (
              <Button
                onClick={() => {
                  setEditId(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Nuova bolla
              </Button>
            )}
          </div>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="b-q">Ricerca</Label>
            <Input
              id="b-q"
              value={q}
              placeholder="Numero bolla o fornitore…"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Label>Fornitore</Label>
            <Select
              value={fornitore}
              onValueChange={(v) => {
                setFornitore(v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutti</SelectItem>
                {(fornitori as any[]).map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.ragione_sociale}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Collegamento</Label>
            <Select
              value={collegamento}
              onValueChange={(v) => {
                setCollegamento(v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutte</SelectItem>
                <SelectItem value="collegata">Collegate a rapportino</SelectItem>
                <SelectItem value="non_collegata">Non collegate</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Switch
            id="b-arch"
            checked={includeArchived}
            onCheckedChange={(v) => {
              setIncludeArchived(v);
              setPage(1);
            }}
          />
          <Label htmlFor="b-arch" className="text-sm">
            Includi archiviate
          </Label>
        </div>
      </Card>

      <Card>
        {isLoading && <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>}
        {isError && (
          <div className="p-6 text-sm">
            <p className="text-destructive">{(error as any)?.message ?? "Errore di caricamento."}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
              Riprova
            </Button>
          </div>
        )}
        {data && items.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            Nessuna bolla in archivio con questi filtri.
          </div>
        )}
        {data && items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Numero</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Fornitore</TableHead>
                <TableHead>Commessa</TableHead>
                <TableHead>Stato</TableHead>
                {canSeeEcon && <TableHead className="text-right">Imponibile</TableHead>}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((b) => {
                const coll = collegamentoBadge(b);
                const st = statoBadge(b);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {b.documento_id && <FileText className="h-4 w-4 text-muted-foreground" />}
                        {b.numero_bolla}
                      </div>
                      <div className="mt-1">
                        <Badge variant={coll.variant}>{coll.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>{dateIt(b.data_bolla)}</TableCell>
                    <TableCell>{b.fornitore_nome ?? "—"}</TableCell>
                    <TableCell>
                      {b.commessa_id ? (
                        <span>
                          {b.commessa_codice} — {b.commessa_titolo}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Non attribuita</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    {canSeeEcon && (
                      <TableCell className="text-right">
                        {b.imponibile != null ? eur(b.imponibile) : "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditId(b.id);
                              setFormOpen(true);
                            }}
                          >
                            {canManage && bollaModificabile(b) ? "Apri e modifica" : "Apri"}
                          </DropdownMenuItem>
                          {b.documento_id && (
                            <DropdownMenuItem
                              onClick={() =>
                                navigate({
                                  to: "/documenti/$documentoId",
                                  params: { documentoId: b.documento_id },
                                })
                              }
                            >
                              Visualizza file
                            </DropdownMenuItem>
                          )}
                          {canManage && !b.rapportino_id && bollaModificabile(b) && (
                            <DropdownMenuItem onClick={() => setCollegaTarget(b)}>
                              Collega a rapportino
                            </DropdownMenuItem>
                          )}
                          {b.rapportino_id && (
                            <DropdownMenuItem
                              onClick={() =>
                                navigate({
                                  to: "/rapportini/$rapportinoId",
                                  params: { rapportinoId: b.rapportino_id },
                                })
                              }
                            >
                              Apri rapportino
                            </DropdownMenuItem>
                          )}
                          {b.commessa_id && (
                            <DropdownMenuItem
                              onClick={() =>
                                navigate({
                                  to: "/commesse/$commessaId",
                                  params: { commessaId: b.commessa_id },
                                })
                              }
                            >
                              Apri commessa
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => navigate({ to: "/fornitori" })}>
                            Apri fornitori
                          </DropdownMenuItem>
                          {canManage && (
                            <DropdownMenuItem
                              onClick={() =>
                                archivia.mutate({ id: b.id, archive: !b.archived_at })
                              }
                            >
                              {b.archived_at ? "Ripristina" : "Archivia"}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            Pagina {page} di {pages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Precedente
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Successiva
            </Button>
          </div>
        </div>
      )}

      <BollaFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        bollaId={editId}
        canSeeEcon={canSeeEcon}
      />
      <CollegaBollaDialog
        bolla={collegaTarget}
        onOpenChange={(v) => !v && setCollegaTarget(null)}
      />
    </div>
  );
}
