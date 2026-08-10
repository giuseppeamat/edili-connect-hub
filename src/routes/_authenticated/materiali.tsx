import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil } from "lucide-react";
import { dateIt } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { listMateriali, saveMateriale, listPrezziMateriali, savePrezzoMateriale } from "@/lib/materiali.functions";
import { listSoggetti } from "@/lib/subappaltatori.functions";
import { confrontoPrezzi, ultimiPrezziPerMateriale } from "@/lib/rapportini-extra";
import { extraKeys } from "@/lib/rapportini-extra.keys";


export const Route = createFileRoute("/_authenticated/materiali")({
  head: () => ({
    meta: [
      { title: "Materiali e prezzi — CantiereOS" },
      { name: "description", content: "Anagrafica materiali e storico prezzi per fornitore." },
    ],
  }),
  component: MaterialiPage,
});

const ALL = "__all__";

function MaterialiPage() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canSeeEcon = user.has("proprietario", "amministratore", "amministrazione");
  const canManage = user.has("proprietario", "amministratore", "ufficio_tecnico", "amministrazione");

  const listFn = useServerFn(listMateriali);
  const saveFn = useServerFn(saveMateriale);
  const prezziFn = useServerFn(listPrezziMateriali);
  const fornFn = useServerFn(listSoggetti);

  const { data: materiali = [] } = useQuery({
    queryKey: extraKeys.materiali(),
    queryFn: async () => (await listFn()) as any[],
  });
  const { data: fornitori = [] } = useQuery({
    queryKey: extraKeys.fornitori("fornitore"),
    queryFn: async () => (await fornFn({ data: { tipo: "fornitore" as const } })) as any[],
  });

  const [materialeFilter, setMaterialeFilter] = useState(ALL);
  const [fornitoreFilter, setFornitoreFilter] = useState(ALL);

  const prezziFilters = {
    materiale_id: materialeFilter === ALL ? null : materialeFilter,
    fornitore_id: fornitoreFilter === ALL ? null : fornitoreFilter,
  };
  const { data: prezzi = [] } = useQuery({
    queryKey: extraKeys.prezzi(prezziFilters),
    enabled: canSeeEcon,
    queryFn: async () => (await prezziFn({ data: prezziFilters })) as any[],
  });

  const confronto = useMemo(
    () =>
      materialeFilter === ALL
        ? []
        : confrontoPrezzi(
            (prezzi as any[]).map((p) => ({
              fornitore_id: p.fornitore_id,
              fornitore_nome: p.fornitore_nome,
              prezzo_unitario: p.prezzo_unitario,
              data_prezzo: p.data_prezzo,
            })),
          ),
    [prezzi, materialeFilter],
  );

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);

  const save = useMutation({
    mutationFn: async (payload: any) => await saveFn({ data: payload }),
    onSuccess: () => {
      toast.success("Materiale salvato");
      setOpen(false);
      setEdit(null);
      qc.invalidateQueries({ queryKey: extraKeys.materiali() });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save.mutate({
      id: edit?.id ?? null,
      nome: String(fd.get("nome") ?? "").trim(),
      codice: (fd.get("codice") as string) || null,
      categoria: (fd.get("categoria") as string) || null,
      unita_misura_predefinita: (fd.get("unita_misura_predefinita") as string) || null,
      descrizione: (fd.get("descrizione") as string) || null,
    });
  };

  return (
    <div>
      <PageHeader
        title="Materiali e prezzi"
        description={`${(materiali as any[]).length} materiali in anagrafica`}
        actions={
          canManage ? (
            <Button onClick={() => { setEdit(null); setOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Nuovo materiale
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="anagrafica">
        <TabsList>
          <TabsTrigger value="anagrafica">Anagrafica</TabsTrigger>
          {canSeeEcon && <TabsTrigger value="prezzi">Storico prezzi</TabsTrigger>}
        </TabsList>

        <TabsContent value="anagrafica">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden md:table-cell">Codice</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="hidden md:table-cell">U.M.</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(materiali as any[]).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.nome}</TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs">{m.codice ?? "—"}</TableCell>
                    <TableCell>{m.categoria && <Badge variant="secondary">{m.categoria}</Badge>}</TableCell>
                    <TableCell className="hidden md:table-cell">{m.unita_misura_predefinita ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button size="icon" variant="ghost" aria-label="Modifica materiale" onClick={() => { setEdit(m); setOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(materiali as any[]).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Nessun materiale. I materiali possono essere creati anche registrando una bolla.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {canSeeEcon && (
          <TabsContent value="prezzi">
            <Card className="mb-4">
              <CardContent className="p-4 grid gap-3 md:grid-cols-2">
                <div>
                  <Label className="text-xs">Materiale</Label>
                  <Select value={materialeFilter} onValueChange={setMaterialeFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Tutti i materiali</SelectItem>
                      {(materiali as any[]).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Fornitore</Label>
                  <Select value={fornitoreFilter} onValueChange={setFornitoreFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Tutti i fornitori</SelectItem>
                      {(fornitori as any[]).map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.ragione_sociale}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {confronto.length > 0 && (
              <Card className="mb-4">
                <CardContent className="p-4">
                  <div className="text-sm font-medium mb-2">Confronto fornitori</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fornitore</TableHead>
                        <TableHead>Ultimo</TableHead>
                        <TableHead>Minimo</TableHead>
                        <TableHead>Massimo</TableHead>
                        <TableHead>Medio</TableHead>
                        <TableHead>Rilevazioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {confronto.map((c) => (
                        <TableRow key={c.fornitore_id}>
                          <TableCell className="font-medium">{c.fornitore_nome}</TableCell>
                          <TableCell>€ {c.ultimo.toFixed(2)}</TableCell>
                          <TableCell>€ {c.minimo.toFixed(2)}</TableCell>
                          <TableCell>€ {c.massimo.toFixed(2)}</TableCell>
                          <TableCell>€ {c.medio.toFixed(2)}</TableCell>
                          <TableCell>{c.rilevazioni}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Materiale</TableHead>
                    <TableHead>Fornitore</TableHead>
                    <TableHead>Prezzo</TableHead>
                    <TableHead className="hidden md:table-cell">U.M.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(prezzi as any[]).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{dateIt(p.data_prezzo)}</TableCell>
                      <TableCell className="font-medium">{p.materiale_nome ?? p.descrizione ?? "—"}</TableCell>
                      <TableCell>{p.fornitore_nome ?? "—"}</TableCell>
                      <TableCell>€ {Number(p.prezzo_unitario ?? 0).toFixed(2)}</TableCell>
                      <TableCell className="hidden md:table-cell">{p.unita_misura ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {(prezzi as any[]).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Nessuna rilevazione di prezzo. Lo storico si popola registrando le bolle.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit ? "Modifica materiale" : "Nuovo materiale"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2" key={edit?.id ?? "new"}>
            <div className="md:col-span-2">
              <Label>Nome *</Label>
              <Input name="nome" required defaultValue={edit?.nome ?? ""} maxLength={200} />
            </div>
            <div><Label>Codice</Label><Input name="codice" defaultValue={edit?.codice ?? ""} maxLength={60} /></div>
            <div><Label>Categoria</Label><Input name="categoria" defaultValue={edit?.categoria ?? ""} maxLength={100} /></div>
            <div><Label>Unità di misura</Label><Input name="unita_misura_predefinita" defaultValue={edit?.unita_misura_predefinita ?? ""} maxLength={20} /></div>
            <div className="md:col-span-2"><Label>Descrizione</Label><Input name="descrizione" defaultValue={edit?.descrizione ?? ""} maxLength={1000} /></div>
            <DialogFooter className="md:col-span-2">
              <Button type="submit" disabled={save.isPending}>Salva</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
