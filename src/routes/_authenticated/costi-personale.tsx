import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listPersonaleCostiOrari,
  listUtentiGestibiliCostoOrario,
  createPersonaleCostoOrario,
  updatePersonaleCostoOrario,
  archivePersonaleCostoOrario,
  restorePersonaleCostoOrario,
  listRapportiniCostiPendenti,
  contabilizzaRapportinoManodopera,
  contabilizzaRapportiniPendenti,
} from "@/lib/personale-costi.functions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Archive, RotateCcw, Play, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/costi-personale")({
  head: () => ({
    meta: [
      { title: "Costi personale — CantiereOS" },
      { name: "description", content: "Gestione del costo orario gestionale del personale e contabilizzazione della manodopera dai rapportini approvati." },
    ],
  }),
  component: CostiPersonalePage,
});

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const eur2 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("it-IT") : "—");
const fullName = (p: any) => (p ? [p.nome, p.cognome].filter(Boolean).join(" ") || p.email || "—" : "—");

function CostiPersonalePage() {
  const { roles, isLoading: userLoading } = useCurrentUser();
  const canManage = roles.some((r) => ["proprietario", "amministratore", "amministrazione"].includes(r));

  if (userLoading) return <div className="p-6 text-muted-foreground">Caricamento…</div>;
  if (!canManage) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Accesso non autorizzato</AlertTitle>
          <AlertDescription>Questa sezione è riservata a proprietario, amministratore e amministrazione.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Costi personale"
        description="Costo orario gestionale del personale e contabilizzazione della manodopera dai rapportini approvati."
      />
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Costo orario gestionale</AlertTitle>
        <AlertDescription>
          Valore utilizzato per il controllo economico interno delle commesse. Non sostituisce i dati elaborati dal consulente del lavoro.
        </AlertDescription>
      </Alert>
      <Tabs defaultValue="tariffe" className="w-full">
        <TabsList>
          <TabsTrigger value="tariffe">Tariffe personale</TabsTrigger>
          <TabsTrigger value="pendenti">Rapportini pendenti</TabsTrigger>
        </TabsList>
        <TabsContent value="tariffe"><TariffeTab /></TabsContent>
        <TabsContent value="pendenti"><PendentiTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TARIFFE
// ─────────────────────────────────────────────────────────────────────────────
function TariffeTab() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const qc = useQueryClient();
  const listFn = useServerFn(listPersonaleCostiOrari);
  const usersFn = useServerFn(listUtentiGestibiliCostoOrario);
  const archiveFn = useServerFn(archivePersonaleCostoOrario);
  const restoreFn = useServerFn(restorePersonaleCostoOrario);

  const list = useQuery({
    queryKey: ["personale-costi", { includeArchived }],
    queryFn: () => listFn({ data: { includeArchived } }),
  });
  const users = useQuery({ queryKey: ["gestibili-costi"], queryFn: () => usersFn() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["personale-costi"] });

  const archiveMut = useMutation({
    mutationFn: (v: { id: string; expected_updated_at: string }) => archiveFn({ data: v }),
    onSuccess: () => { toast.success("Tariffa archiviata"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const restoreMut = useMutation({
    mutationFn: (v: { id: string; expected_updated_at: string }) => restoreFn({ data: v }),
    onSuccess: () => { toast.success("Tariffa ripristinata"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Tariffe personale</CardTitle>
          <CardDescription>Costi orari gestionali per utente, con validità temporale.</CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="arch" checked={includeArchived} onCheckedChange={setIncludeArchived} />
            <Label htmlFor="arch">Mostra archiviate</Label>
          </div>
          <Button onClick={() => { setEdit(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Nuova tariffa
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utente</TableHead>
              <TableHead className="text-right">Costo orario</TableHead>
              <TableHead>Valido dal</TableHead>
              <TableHead>Valido al</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Caricamento…</TableCell></TableRow>
            )}
            {list.data && list.data.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nessuna tariffa configurata.</TableCell></TableRow>
            )}
            {(list.data ?? []).map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{fullName(t.user)}</TableCell>
                <TableCell className="text-right font-mono">{eur.format(Number(t.costo_orario))}</TableCell>
                <TableCell>{dateFmt(t.valido_dal)}</TableCell>
                <TableCell>{t.valido_al ? dateFmt(t.valido_al) : <span className="text-muted-foreground">a tempo indeterminato</span>}</TableCell>
                <TableCell className="max-w-xs truncate">{t.note ?? "—"}</TableCell>
                <TableCell>
                  {t.archived_at ? <Badge variant="secondary">archiviata</Badge> : <Badge>attiva</Badge>}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {!t.archived_at && (
                    <Button size="sm" variant="outline" onClick={() => { setEdit(t); setOpen(true); }}>Modifica</Button>
                  )}
                  {!t.archived_at ? (
                    <Button size="sm" variant="ghost"
                      onClick={() => archiveMut.mutate({ id: t.id, expected_updated_at: t.updated_at })}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost"
                      onClick={() => restoreMut.mutate({ id: t.id, expected_updated_at: t.updated_at })}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <TariffaDialog
        open={open}
        onOpenChange={setOpen}
        edit={edit}
        users={users.data ?? []}
        onSaved={invalidate}
      />
    </Card>
  );
}

function TariffaDialog({
  open, onOpenChange, edit, users, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; edit: any;
  users: any[]; onSaved: () => void;
}) {
  const createFn = useServerFn(createPersonaleCostoOrario);
  const updateFn = useServerFn(updatePersonaleCostoOrario);
  const isEdit = !!edit;

  const [userId, setUserId] = useState<string>(edit?.user_id ?? "");
  const [costo, setCosto] = useState<string>(edit?.costo_orario?.toString() ?? "");
  const [dal, setDal] = useState<string>(edit?.valido_dal ?? new Date().toISOString().slice(0, 10));
  const [al, setAl] = useState<string>(edit?.valido_al ?? "");
  const [note, setNote] = useState<string>(edit?.note ?? "");

  // Reset when opening
  useState(() => {
    if (open) {
      setUserId(edit?.user_id ?? "");
      setCosto(edit?.costo_orario?.toString() ?? "");
      setDal(edit?.valido_dal ?? new Date().toISOString().slice(0, 10));
      setAl(edit?.valido_al ?? "");
      setNote(edit?.note ?? "");
    }
  });

  const mut = useMutation({
    mutationFn: async () => {
      const costoNum = Number(costo.replace(",", "."));
      if (!Number.isFinite(costoNum) || costoNum < 0) throw new Error("Costo orario non valido");
      if (!isEdit && !userId) throw new Error("Seleziona un utente");
      if (!dal) throw new Error("Data inizio obbligatoria");
      if (isEdit) {
        return updateFn({ data: {
          id: edit.id, expected_updated_at: edit.updated_at,
          costo_orario: costoNum, valido_dal: dal, valido_al: al || null, note: note || null,
        }});
      }
      return createFn({ data: { user_id: userId, costo_orario: costoNum, valido_dal: dal, valido_al: al || null, note: note || null } });
    },
    onSuccess: () => { toast.success(isEdit ? "Tariffa aggiornata" : "Tariffa creata"); onOpenChange(false); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifica tariffa" : "Nuova tariffa"}</DialogTitle>
          <DialogDescription>
            Costo orario gestionale interno. Non modificare una tariffa già utilizzata per rapportini contabilizzati: chiudi il periodo e creane una nuova.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <Label>Utente</Label>
            {isEdit ? (
              <Input value={fullName(edit?.user)} disabled />
            ) : (
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger><SelectValue placeholder="Seleziona utente" /></SelectTrigger>
                <SelectContent>
                  {users.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {fullName(u)} {u.is_active === false && "(disattivato)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-1">
            <Label>Costo orario (EUR)</Label>
            <Input type="number" step="0.0001" min="0" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Es. 25,50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Valido dal</Label>
              <Input type="date" value={dal} onChange={(e) => setDal(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Valido al (opzionale)</Label>
              <Input type="date" value={al} onChange={(e) => setAl(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Salvataggio…" : "Salva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PENDENTI
// ─────────────────────────────────────────────────────────────────────────────
function PendentiTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listRapportiniCostiPendenti);
  const singleFn = useServerFn(contabilizzaRapportinoManodopera);
  const bulkFn = useServerFn(contabilizzaRapportiniPendenti);

  const list = useQuery({ queryKey: ["rapportini-pendenti"], queryFn: () => listFn() });

  const singleMut = useMutation({
    mutationFn: (rapportino_id: string) => singleFn({ data: { rapportino_id } }),
    onSuccess: (res: any) => {
      if (res.warning) toast.warning(res.warning);
      else toast.success("Rapportino contabilizzato");
      qc.invalidateQueries({ queryKey: ["rapportini-pendenti"] });
      qc.invalidateQueries({ queryKey: ["rapportini"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkMut = useMutation({
    mutationFn: () => bulkFn({ data: { limit: 200 } }),
    onSuccess: (res: any) => {
      toast.success(
        `Elaborati ${res?.processati ?? 0}: ${res?.contabilizzati ?? 0} contabilizzati, ${res?.senza_tariffa ?? 0} senza tariffa, ${res?.budget_manuale ?? 0} in budget manuale`,
      );
      qc.invalidateQueries({ queryKey: ["rapportini-pendenti"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Rapportini approvati non contabilizzati</CardTitle>
          <CardDescription>
            Rapportini approvati che non hanno una contabilizzazione attiva (tariffa mancante o mai processati).
          </CardDescription>
        </div>
        <Button onClick={() => bulkMut.mutate()} disabled={bulkMut.isPending || !(list.data ?? []).length}>
          <Play className="h-4 w-4 mr-2" /> Contabilizza tutti
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ore</TableHead>
              <TableHead>Stato contabilizzazione</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Caricamento…</TableCell></TableRow>
            )}
            {list.data && list.data.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nessun rapportino pendente.</TableCell></TableRow>
            )}
            {(list.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{dateFmt(r.data)}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.ore).toFixed(2)}</TableCell>
                <TableCell>
                  {r.stato_contabilizzazione === "non_contabilizzato"
                    ? <Badge variant="destructive">tariffa mancante</Badge>
                    : <Badge variant="outline">mai contabilizzato</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" onClick={() => singleMut.mutate(r.id)} disabled={singleMut.isPending}>
                    Riprova
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
