import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Lock, Archive, MoreHorizontal, MapPin, Calendar, UserRound, Plus, AlertTriangle, Users, FileText, ClipboardList, History, Home, ListChecks, Wallet } from "lucide-react";
import { BudgetTab } from "@/components/commesse/budget-tab";
import { FasiTab, ManualCommessaProgressDialog } from "@/components/commesse/fasi-tab";
import { CommessaRapportiniTab } from "@/components/commesse/rapportini-tab";
import { Progress } from "@/components/ui/progress";
import { eur, dateIt } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  getCommessaDetail, listCommessaMembers, listAssignableMembers,
  addCommessaMember, updateCommessaMember, removeCommessaMember,
  setCommessaResponsabile, listResponsabiliCandidati, updateCommessa,
  changeCommessaStato, closeCommessa, reopenCommessa, archiveCommessa, restoreCommessa,
  listCommessaAudit, listRapportiniByCommessa, listDocumentiByCommessa,
} from "@/lib/commesse.functions";
import {
  listCantieri, createCantiere, updateCantiere, archiveCantiere, restoreCantiere, setCapocantiere,
} from "@/lib/cantieri.functions";
import { ConfirmDialog } from "@/components/commesse/confirm-dialog";

export const Route = createFileRoute("/_authenticated/commesse/$commessaId")({
  head: () => ({
    meta: [
      { title: "Dettaglio commessa — CantiereOS" },
      { name: "description", content: "Panoramica commessa, cantieri, team, rapportini, documenti e storico." },
    ],
  }),
  component: CommessaDetailPage,
});

const STATI_LABEL: Record<string, string> = {
  bozza: "Bozza", pianificata: "Pianificata", in_corso: "In corso",
  sospesa: "Sospesa", completata: "Completata", annullata: "Annullata",
};
const STATI_CANTIERE_LABEL: Record<string, string> = {
  pianificato: "Pianificato", attivo: "Attivo", sospeso: "Sospeso",
  completato: "Completato", chiuso: "Chiuso", archiviato: "Archiviato",
};
const RUOLI_OP_LABEL: Record<string, string> = {
  responsabile_commessa: "Responsabile commessa", capocantiere: "Capocantiere",
  tecnico: "Tecnico", amministrazione: "Amministrazione",
  operaio: "Operaio", collaboratore: "Collaboratore", altro: "Altro",
};
const TRANSIZIONI: Record<string, { value: string; label: string; needsMotivo?: boolean }[]> = {
  bozza: [{ value: "pianificata", label: "→ Pianificata" }, { value: "annullata", label: "→ Annullata" }],
  pianificata: [{ value: "in_corso", label: "→ In corso" }, { value: "sospesa", label: "→ Sospesa" }, { value: "annullata", label: "→ Annullata" }],
  in_corso: [{ value: "sospesa", label: "→ Sospesa" }, { value: "completata", label: "→ Completata" }, { value: "annullata", label: "→ Annullata", needsMotivo: true }],
  sospesa: [{ value: "in_corso", label: "→ In corso" }, { value: "completata", label: "→ Completata" }, { value: "annullata", label: "→ Annullata" }],
  completata: [], annullata: [],
};

function fullName(r: { nome?: string | null; cognome?: string | null; email?: string | null } | null) {
  if (!r) return "—";
  const s = [r.nome, r.cognome].filter(Boolean).join(" ").trim();
  return s || r.email || "Utente";
}

function CommessaDetailPage() {
  const { commessaId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canEditCommesse = user.canCreateCommesse; // admin/tecnico
  const canAssignResp = user.canAssignResponsabile;

  const getDetailFn = useServerFn(getCommessaDetail);
  const detailQuery = useQuery({
    queryKey: ["commessa-detail", commessaId],
    queryFn: async () => await getDetailFn({ data: { id: commessaId } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["commessa-detail", commessaId] });
    qc.invalidateQueries({ queryKey: ["cantieri", commessaId] });
    qc.invalidateQueries({ queryKey: ["commesse"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  if (detailQuery.isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Caricamento…</div>;
  }
  if (detailQuery.error) {
    return (
      <div className="p-8">
        <div className="text-center text-destructive mb-4">{(detailQuery.error as Error).message}</div>
        <div className="text-center">
          <Button asChild variant="outline"><Link to="/commesse"><ArrowLeft className="h-4 w-4 mr-1" />Torna alle commesse</Link></Button>
        </div>
      </div>
    );
  }
  const d = detailQuery.data!;
  const c = d.commessa;
  const isClosed = !!c.closed_at;
  const isArchived = !!c.archived_at;

  return (
    <div>
      <PageHeader
        title={<div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm"><Link to="/commesse"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <span className="font-mono text-sm text-muted-foreground">{c.codice}</span>
          <span>{c.titolo ?? c.denominazione}</span>
        </div>}
        description={<div className="flex flex-wrap items-center gap-2 mt-1">
          <Badge variant={c.stato === "in_corso" ? "default" : "secondary"}>{STATI_LABEL[c.stato] ?? c.stato}</Badge>
          {isClosed && <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />Chiusa</Badge>}
          {isArchived && <Badge variant="outline">Archiviata</Badge>}
          {d.cliente && <span className="text-sm text-muted-foreground">Cliente: <span className="font-medium">{d.cliente.ragione_sociale}</span></span>}
          {d.responsabile ? (
            <span className="text-sm text-muted-foreground">Resp.: <span className="font-medium">{fullName(d.responsabile)}</span></span>
          ) : (
            <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300"><AlertTriangle className="h-3 w-3" />Nessun responsabile</Badge>
          )}
        </div>}
        actions={<HeaderActions
          c={c} isClosed={isClosed} isArchived={isArchived}
          canEdit={canEditCommesse} canClose={user.isAdmin} canArchive={user.isAdmin}
          onDone={invalidate}
        />}
      />

      <Tabs defaultValue="panoramica" className="w-full">
        <TabsList className="mb-4 flex w-full flex-nowrap justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="panoramica" className="shrink-0 whitespace-nowrap"><Home className="h-4 w-4 mr-1" />Panoramica</TabsTrigger>
          <TabsTrigger value="fasi" className="shrink-0 whitespace-nowrap"><ListChecks className="h-4 w-4 mr-1" />Fasi</TabsTrigger>
          <TabsTrigger value="cantieri" className="shrink-0 whitespace-nowrap"><MapPin className="h-4 w-4 mr-1" />Cantieri</TabsTrigger>
          <TabsTrigger value="team" className="shrink-0 whitespace-nowrap"><Users className="h-4 w-4 mr-1" />Team</TabsTrigger>
          <TabsTrigger value="rapportini" className="shrink-0 whitespace-nowrap"><ClipboardList className="h-4 w-4 mr-1" />Rapportini</TabsTrigger>
          <TabsTrigger value="documenti" className="shrink-0 whitespace-nowrap"><FileText className="h-4 w-4 mr-1" />Documenti</TabsTrigger>
          {user.canViewCommessaBudget && (
            <TabsTrigger value="budget" className="shrink-0 whitespace-nowrap"><Wallet className="h-4 w-4 mr-1" />Budget</TabsTrigger>
          )}
          <TabsTrigger value="storico" className="shrink-0 whitespace-nowrap"><History className="h-4 w-4 mr-1" />Storico</TabsTrigger>
        </TabsList>


        <TabsContent value="panoramica">
          <PanoramicaTab d={d} canEdit={canEditCommesse} canAssignResp={canAssignResp} onDone={invalidate} />
        </TabsContent>
        <TabsContent value="fasi">
          <FasiTab
            commessaId={c.id}
            canManage={canEditCommesse || (user.has("responsabile_commessa") && c.responsabile_id === user.userId)}
            avanzamentoModalita={(c as any).avanzamento_modalita ?? "manuale"}
            commessaUpdatedAt={c.updated_at}
            commessaClosed={!!c.closed_at}
            commessaArchived={!!c.archived_at}
          />
        </TabsContent>
        <TabsContent value="cantieri">
          <CantieriTab commessa={c} canManage={canEditCommesse} onDone={invalidate} />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab commessa={c} canManage={canEditCommesse || (user.has("responsabile_commessa") && c.responsabile_id === user.userId)} />
        </TabsContent>
        <TabsContent value="rapportini">
          <CommessaRapportiniTab
            commessaId={c.id}
            commessaClosed={!!c.closed_at}
            commessaArchived={!!c.archived_at}
          />
        </TabsContent>
        <TabsContent value="documenti">
          <DocumentiTab commessaId={c.id} />
        </TabsContent>
        {user.canViewCommessaBudget && (
          <TabsContent value="budget">
            <BudgetTab commessa={c} commessaId={c.id} isClosed={!!c.closed_at} isArchived={!!c.archived_at} />
          </TabsContent>
        )}

        <TabsContent value="storico">
          <StoricoTab commessaId={c.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============= HEADER ACTIONS =============
function HeaderActions({ c, isClosed, isArchived, canEdit, canClose, canArchive, onDone }: any) {
  const [stateDlg, setStateDlg] = useState<{ open: boolean; nuovo?: string; needsMotivo?: boolean }>({ open: false });
  const [closeDlg, setCloseDlg] = useState(false);
  const [reopenDlg, setReopenDlg] = useState(false);
  const [archDlg, setArchDlg] = useState(false);

  const changeStatoFn = useServerFn(changeCommessaStato);
  const closeFn = useServerFn(closeCommessa);
  const reopenFn = useServerFn(reopenCommessa);
  const archFn = useServerFn(archiveCommessa);
  const restoreFn = useServerFn(restoreCommessa);

  const transizioni = TRANSIZIONI[c.stato] ?? [];
  const canStateMenu = canEdit && !isClosed && !isArchived;

  return (
    <div className="flex gap-1">
      {canStateMenu && transizioni.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline">Cambia stato</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Transizioni consentite</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {transizioni.map((t) => (
              <DropdownMenuItem key={t.value} onClick={() => setStateDlg({ open: true, nuovo: t.value, needsMotivo: t.needsMotivo })}>
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canClose && !isClosed && !isArchived && (
        <Button size="sm" variant="outline" onClick={() => setCloseDlg(true)}><Lock className="h-4 w-4 mr-1" />Chiudi</Button>
      )}
      {canClose && isClosed && !isArchived && (
        <Button size="sm" variant="outline" onClick={() => setReopenDlg(true)}>Riapri</Button>
      )}
      {canArchive && !isArchived && (
        <Button size="sm" variant="outline" onClick={() => setArchDlg(true)}><Archive className="h-4 w-4 mr-1" />Archivia</Button>
      )}
      {canArchive && isArchived && (
        <Button size="sm" variant="outline" onClick={async () => {
          try { await restoreFn({ data: { id: c.id } }); toast.success("Ripristinata"); onDone(); }
          catch (e: any) { toast.error(e.message); }
        }}>Ripristina</Button>
      )}

      <ConfirmDialog
        open={stateDlg.open}
        onOpenChange={(v) => setStateDlg({ open: v })}
        title={`Cambio stato: ${STATI_LABEL[stateDlg.nuovo ?? ""] ?? ""}`}
        description="Conferma il passaggio di stato della commessa."
        requireMotivazione={stateDlg.needsMotivo}
        motivazionePlaceholder="Perché stai annullando la commessa?"
        onConfirm={async ({ motivazione }) => {
          await changeStatoFn({ data: {
            id: c.id, nuovo_stato: stateDlg.nuovo as any,
            expected_updated_at: c.updated_at, motivazione,
          } });
          toast.success("Stato aggiornato"); onDone(); setStateDlg({ open: false });
        }}
      />
      <ConfirmDialog
        open={closeDlg} onOpenChange={setCloseDlg}
        title="Chiudi commessa" description="La commessa non potrà essere modificata finché non viene riaperta."
        requireMotivazione destructive
        extraField={{ key: "data_fine_effettiva", label: "Data fine effettiva", type: "date", defaultValue: new Date().toISOString().slice(0,10), required: true }}
        warning={c.stato !== "completata" ? "La commessa non è ancora completata: la chiusura forzerà l'operazione." : undefined}
        confirmLabel="Chiudi commessa"
        onConfirm={async ({ motivazione, extra }) => {
          await closeFn({ data: {
            id: c.id, expected_updated_at: c.updated_at,
            data_fine_effettiva: extra!, motivazione: motivazione!, override: c.stato !== "completata",
          } });
          toast.success("Commessa chiusa"); onDone(); setCloseDlg(false);
        }}
      />
      <ConfirmDialog
        open={reopenDlg} onOpenChange={setReopenDlg}
        title="Riapri commessa" description="La commessa tornerà 'In corso'."
        requireMotivazione confirmLabel="Riapri"
        onConfirm={async ({ motivazione }) => {
          await reopenFn({ data: { id: c.id, motivazione: motivazione!, nuovo_stato: "in_corso" } });
          toast.success("Commessa riaperta"); onDone(); setReopenDlg(false);
        }}
      />
      <ConfirmDialog
        open={archDlg} onOpenChange={setArchDlg}
        title="Archivia commessa" description="La commessa sarà nascosta dagli elenchi principali."
        requireMotivazione destructive confirmLabel="Archivia"
        warning={!isClosed && c.stato !== "completata" && c.stato !== "annullata" ? "La commessa non è chiusa/completata: verrà comunque archiviata." : undefined}
        onConfirm={async ({ motivazione }) => {
          const isClosed2 = !!c.closed_at || c.stato === "completata" || c.stato === "annullata";
          await archFn({ data: { id: c.id, motivazione: motivazione!, override: !isClosed2 } });
          toast.success("Commessa archiviata"); onDone(); setArchDlg(false);
        }}
      />
    </div>
  );
}

// ============= PANORAMICA =============
function PanoramicaTab({ d, canEdit, canAssignResp, onDone }: any) {
  const c = d.commessa;
  const [editOpen, setEditOpen] = useState(false);
  const [respOpen, setRespOpen] = useState(false);
  const [manProgOpen, setManProgOpen] = useState(false);
  const modalita = c.avanzamento_modalita ?? "manuale";
  const avanz = Number(c.avanzamento_pct ?? c.avanzamento_percentuale ?? 0);
  const canManualProgress = canEdit && modalita === "manuale" && !c.closed_at && !c.archived_at;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Dati generali</h3>
            {canEdit && !c.closed_at && !c.archived_at && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>Modifica</Button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Tipologia</dt><dd>{c.tipologia ?? "—"}</dd>
            <dt className="text-muted-foreground">Priorità</dt><dd>{c.priorita ?? "—"}</dd>
            <dt className="text-muted-foreground">Cliente</dt><dd>{d.cliente?.ragione_sociale ?? "—"}</dd>
            <dt className="text-muted-foreground">Responsabile</dt><dd className="flex items-center gap-2">
              {fullName(d.responsabile)}
              {canAssignResp && !c.closed_at && !c.archived_at && (
                <Button size="sm" variant="ghost" onClick={() => setRespOpen(true)}>Cambia</Button>
              )}
            </dd>
            <dt className="text-muted-foreground">Data apertura</dt><dd>{dateIt(c.data_apertura)}</dd>
            <dt className="text-muted-foreground">Inizio previsto</dt><dd>{dateIt(c.data_inizio_prevista)}</dd>
            <dt className="text-muted-foreground">Fine prevista</dt><dd>{dateIt(c.data_fine_prevista)}</dd>
            <dt className="text-muted-foreground">Indirizzo (legacy)</dt><dd>{c.indirizzo_cantiere ?? "—"}</dd>
            <dt className="text-muted-foreground">Cantieri</dt><dd>{d.cantieriCount}</dd>
            <dt className="text-muted-foreground">Membri attivi</dt><dd>{d.membriCount}</dd>
          </dl>
          {c.descrizione && <div className="pt-2 border-t"><h4 className="text-sm font-semibold mb-1">Descrizione</h4><p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.descrizione}</p></div>}
          {c.note_interne && <div className="pt-2 border-t"><h4 className="text-sm font-semibold mb-1">Note interne</h4><p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.note_interne}</p></div>}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Avanzamento</h3>
            <Badge variant={modalita === "fasi" ? "secondary" : "outline"}>
              {modalita === "fasi" ? "Calcolato dalle fasi" : "Manuale"}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={avanz} className="flex-1 h-2" />
            <span className="text-sm font-semibold min-w-[3rem] text-right">{avanz.toFixed(0)}%</span>
          </div>
          {modalita === "fasi" ? (
            <p className="text-xs text-muted-foreground">
              Il valore è calcolato automaticamente dalla media ponderata delle fasi attive.
              Per modificarlo interviene sulle fasi.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Valore inserito manualmente dal responsabile.
            </p>
          )}
          {canManualProgress && (
            <Button size="sm" variant="outline" onClick={() => setManProgOpen(true)}>
              Aggiorna avanzamento
            </Button>
          )}
        </CardContent>
      </Card>
      {d.canViewEconomics && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h3 className="font-semibold">Dati economici</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Importo contratto</dt><dd className="font-medium">{eur(c.importo_contratto ?? c.importo)}</dd>
              <dt className="text-muted-foreground">Ricavi previsti</dt><dd>{eur(c.ricavi_previsti)}</dd>
              <dt className="text-muted-foreground">Costi previsti</dt><dd>{eur(c.costi_previsti ?? c.budget_costi)}</dd>
              <dt className="text-muted-foreground">Costi impegnati</dt><dd>{eur(c.costi_impegnati)}</dd>
              <dt className="text-muted-foreground">Costi sostenuti</dt><dd>{eur(c.costi_sostenuti)}</dd>
              <dt className="text-muted-foreground">Margine previsto</dt><dd className="font-medium">{eur(c.margine_previsto)}</dd>
              <dt className="text-muted-foreground">Margine aggiornato</dt><dd>{eur(c.margine_aggiornato)}</dd>
              <dt className="text-muted-foreground">Margine %</dt><dd>{c.margine_percentuale != null ? `${Number(c.margine_percentuale).toFixed(2)}%` : "—"}</dd>
            </dl>
          </CardContent>
        </Card>
      )}
      <EditCommessaDialog open={editOpen} onOpenChange={setEditOpen} commessa={c} onDone={onDone} />
      <SetResponsabileDialog open={respOpen} onOpenChange={setRespOpen} commessa={c} onDone={onDone} />
      <ManualCommessaProgressDialog
        open={manProgOpen}
        onOpenChange={setManProgOpen}
        commessa={{ id: c.id, updated_at: c.updated_at, avanzamento_pct: avanz }}
        onDone={onDone}
      />
    </div>
  );
}


function EditCommessaDialog({ open, onOpenChange, commessa, onDone }: any) {
  const updateFn = useServerFn(updateCommessa);
  const [saving, setSaving] = useState(false);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true);
    try {
      const fd = new FormData(e.currentTarget);
      const g = (k: string) => (fd.get(k) as string) || "";
      await updateFn({ data: {
        id: commessa.id, expected_updated_at: commessa.updated_at,
        titolo: g("titolo") || undefined,
        descrizione: g("descrizione") || null,
        tipologia: (g("tipologia") || undefined) as any,
        priorita: (g("priorita") || undefined) as any,
        indirizzo_cantiere: g("indirizzo_cantiere") || null,
        data_inizio_prevista: g("data_inizio_prevista") || null,
        data_fine_prevista: g("data_fine_prevista") || null,
        note_interne: g("note_interne") || null,
      }});
      toast.success("Commessa aggiornata"); onDone(); onOpenChange(false);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Modifica commessa</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div><Label>Titolo</Label><Input name="titolo" defaultValue={commessa.titolo ?? commessa.denominazione ?? ""} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Tipologia</Label><Input name="tipologia" defaultValue={commessa.tipologia ?? ""} /></div>
            <div><Label>Priorità</Label><Input name="priorita" defaultValue={commessa.priorita ?? ""} /></div>
            <div><Label>Inizio previsto</Label><Input type="date" name="data_inizio_prevista" defaultValue={commessa.data_inizio_prevista ?? ""} /></div>
            <div><Label>Fine prevista</Label><Input type="date" name="data_fine_prevista" defaultValue={commessa.data_fine_prevista ?? ""} /></div>
          </div>
          <div><Label>Indirizzo cantiere (legacy)</Label><Input name="indirizzo_cantiere" defaultValue={commessa.indirizzo_cantiere ?? ""} /></div>
          <div><Label>Descrizione</Label><Textarea name="descrizione" defaultValue={commessa.descrizione ?? ""} rows={2} /></div>
          <div><Label>Note interne</Label><Textarea name="note_interne" defaultValue={commessa.note_interne ?? ""} rows={2} /></div>
          <DialogFooter><Button type="submit" disabled={saving}>Salva</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetResponsabileDialog({ open, onOpenChange, commessa, onDone }: any) {
  const setRespFn = useServerFn(setCommessaResponsabile);
  const listRespFn = useServerFn(listResponsabiliCandidati);
  const { data: candidati = [] } = useQuery({
    queryKey: ["responsabili-candidati"], enabled: open,
    queryFn: async () => await listRespFn(),
  });
  const [val, setVal] = useState<string>(commessa.responsabile_id ?? "__none__");
  const [saving, setSaving] = useState(false);
  const onSave = async () => {
    setSaving(true);
    try {
      await setRespFn({ data: {
        commessa_id: commessa.id,
        responsabile_id: val === "__none__" ? null : val,
        expected_updated_at: commessa.updated_at,
      }});
      toast.success("Responsabile aggiornato"); onDone(); onOpenChange(false);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Cambia responsabile</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={val} onValueChange={setVal}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nessun responsabile</SelectItem>
              {(candidati as any[]).map((r) => (
                <SelectItem key={r.id} value={r.id}>{fullName(r)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
            <Button onClick={onSave} disabled={saving}>Salva</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============= CANTIERI TAB =============
function CantieriTab({ commessa, canManage, onDone }: any) {
  const qc = useQueryClient();
  const [showArch, setShowArch] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [capoDlg, setCapoDlg] = useState<any>(null);
  const [archDlg, setArchDlg] = useState<any>(null);

  const listFn = useServerFn(listCantieri);
  const archiveFn = useServerFn(archiveCantiere);
  const restoreFn = useServerFn(restoreCantiere);

  const { data: cantieri = [] } = useQuery({
    queryKey: ["cantieri", commessa.id, showArch],
    queryFn: async () => await listFn({ data: { commessa_id: commessa.id, includeArchived: showArch } }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["cantieri", commessa.id] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch id="show-arch" checked={showArch} onCheckedChange={setShowArch} />
          <Label htmlFor="show-arch" className="text-sm">Mostra archiviati</Label>
        </div>
        {canManage && !commessa.closed_at && !commessa.archived_at && (
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />Nuovo cantiere</Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(cantieri as any[]).map((k) => (
          <Card key={k.id} className={k.archived_at ? "opacity-60" : ""}>
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{k.codice}</span>
                    {k.is_principale && <Badge variant="secondary" className="text-xs">Principale</Badge>}
                  </div>
                  <div className="font-semibold">{k.nome}</div>
                </div>
                <Badge variant="outline">{STATI_CANTIERE_LABEL[k.stato] ?? k.stato}</Badge>
              </div>
              {k.indirizzo && <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{k.indirizzo}{k.citta ? `, ${k.citta}` : ""}</div>}
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />
                {dateIt(k.data_inizio_prevista)} → {dateIt(k.data_fine_prevista)}
              </div>
              <div className="text-xs flex items-center gap-1">
                <UserRound className="h-3 w-3" />
                Capocantiere: <span className="font-medium">{fullName(k.capocantiere)}</span>
              </div>
              <div className="text-xs text-muted-foreground">Membri attivi: {k.membri_count}</div>
              {canManage && !commessa.closed_at && !commessa.archived_at && (
                <div className="flex justify-end gap-1 pt-1 border-t">
                  {!k.archived_at && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(k)}>Modifica</Button>
                      <Button size="sm" variant="ghost" onClick={() => setCapoDlg(k)}>Capocantiere</Button>
                      <Button size="sm" variant="ghost" onClick={() => setArchDlg(k)}><Archive className="h-4 w-4" /></Button>
                    </>
                  )}
                  {k.archived_at && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      try { await restoreFn({ data: { id: k.id } }); toast.success("Ripristinato"); invalidate(); }
                      catch (e: any) { toast.error(e.message); }
                    }}>Ripristina</Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {cantieri.length === 0 && <div className="col-span-full text-center text-muted-foreground py-8">Nessun cantiere.</div>}
      </div>

      <CantiereFormDialog
        open={createOpen} onOpenChange={setCreateOpen}
        commessaId={commessa.id} mode="create" onDone={invalidate}
      />
      {editing && (
        <CantiereFormDialog
          open={!!editing} onOpenChange={(v: boolean) => !v && setEditing(null)}
          commessaId={commessa.id} mode="edit" cantiere={editing}
          onDone={() => { invalidate(); setEditing(null); }}
        />
      )}
      {capoDlg && (
        <SetCapocantiereDialog
          open={!!capoDlg} onOpenChange={(v: boolean) => !v && setCapoDlg(null)}
          cantiere={capoDlg} onDone={() => { invalidate(); setCapoDlg(null); }}
        />
      )}
      <ConfirmDialog
        open={!!archDlg} onOpenChange={(v: boolean) => !v && setArchDlg(null)}
        title="Archivia cantiere"
        description="Il cantiere sarà nascosto dagli elenchi. I rapportini e i documenti collegati NON saranno eliminati."
        requireMotivazione destructive confirmLabel="Archivia"
        onConfirm={async ({ motivazione }) => {
          await archiveFn({ data: { id: archDlg.id, motivazione: motivazione! } });
          toast.success("Cantiere archiviato"); invalidate(); setArchDlg(null);
        }}
      />
    </div>
  );
}

function CantiereFormDialog({ open, onOpenChange, commessaId, mode, cantiere, onDone }: any) {
  const createFn = useServerFn(createCantiere);
  const updateFn = useServerFn(updateCantiere);
  const [saving, setSaving] = useState(false);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setSaving(true);
    try {
      const fd = new FormData(e.currentTarget);
      const g = (k: string) => (fd.get(k) as string) || "";
      if (mode === "create") {
        await createFn({ data: {
          commessa_id: commessaId,
          codice: g("codice").trim(),
          nome: g("nome").trim(),
          descrizione: g("descrizione") || null,
          indirizzo: g("indirizzo") || null,
          citta: g("citta") || null,
          provincia: g("provincia") || null,
          cap: g("cap") || null,
          stato: (g("stato") || "pianificato") as any,
          data_inizio_prevista: g("data_inizio_prevista") || null,
          data_fine_prevista: g("data_fine_prevista") || null,
          note_operative: g("note_operative") || null,
          is_principale: !!fd.get("is_principale"),
        }});
        toast.success("Cantiere creato");
      } else {
        await updateFn({ data: {
          id: cantiere.id, expected_updated_at: cantiere.updated_at,
          nome: g("nome").trim() || undefined,
          descrizione: g("descrizione") || null,
          indirizzo: g("indirizzo") || null,
          citta: g("citta") || null,
          provincia: g("provincia") || null,
          cap: g("cap") || null,
          stato: (g("stato") || undefined) as any,
          data_inizio_prevista: g("data_inizio_prevista") || null,
          data_fine_prevista: g("data_fine_prevista") || null,
          data_inizio_effettiva: g("data_inizio_effettiva") || null,
          data_fine_effettiva: g("data_fine_effettiva") || null,
          note_operative: g("note_operative") || null,
        }});
        toast.success("Cantiere aggiornato");
      }
      onDone(); onOpenChange(false);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  const k = cantiere ?? {};
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{mode === "create" ? "Nuovo cantiere" : "Modifica cantiere"}</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          {mode === "create" && (
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Codice *</Label><Input name="codice" required maxLength={20} placeholder="es. LOTTO-A" /></div>
              <div className="col-span-2"><Label>Nome *</Label><Input name="nome" required /></div>
            </div>
          )}
          {mode !== "create" && (
            <div><Label>Nome *</Label><Input name="nome" defaultValue={k.nome} required /></div>
          )}
          <div><Label>Descrizione</Label><Textarea name="descrizione" defaultValue={k.descrizione ?? ""} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Indirizzo</Label><Input name="indirizzo" defaultValue={k.indirizzo ?? ""} /></div>
            <div><Label>Città</Label><Input name="citta" defaultValue={k.citta ?? ""} /></div>
            <div><Label>Provincia</Label><Input name="provincia" defaultValue={k.provincia ?? ""} maxLength={50} /></div>
            <div><Label>CAP</Label><Input name="cap" defaultValue={k.cap ?? ""} maxLength={10} /></div>
            <div>
              <Label>Stato</Label>
              <select name="stato" defaultValue={k.stato ?? "pianificato"} className="w-full h-10 rounded-md border bg-background px-3 text-sm">
                {Object.entries(STATI_CANTIERE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Inizio previsto</Label><Input type="date" name="data_inizio_prevista" defaultValue={k.data_inizio_prevista ?? ""} /></div>
            <div><Label>Fine prevista</Label><Input type="date" name="data_fine_prevista" defaultValue={k.data_fine_prevista ?? ""} /></div>
            {mode !== "create" && (<>
              <div><Label>Inizio effettivo</Label><Input type="date" name="data_inizio_effettiva" defaultValue={k.data_inizio_effettiva ?? ""} /></div>
              <div><Label>Fine effettiva</Label><Input type="date" name="data_fine_effettiva" defaultValue={k.data_fine_effettiva ?? ""} /></div>
            </>)}
          </div>
          <div><Label>Note operative</Label><Textarea name="note_operative" defaultValue={k.note_operative ?? ""} rows={2} /></div>
          {mode === "create" && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_principale" /> Cantiere principale</label>
          )}
          <DialogFooter><Button type="submit" disabled={saving}>{mode === "create" ? "Crea cantiere" : "Salva"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetCapocantiereDialog({ open, onOpenChange, cantiere, onDone }: any) {
  const setCapoFn = useServerFn(setCapocantiere);
  const listFn = useServerFn(listAssignableMembers);
  const { data: members = [] } = useQuery({
    queryKey: ["assignable-members"], enabled: open,
    queryFn: async () => await listFn(),
  });
  const filtered = (members as any[]).filter((m) =>
    m.roles?.some((r: string) => ["capocantiere","responsabile_commessa","ufficio_tecnico","amministratore","proprietario"].includes(r))
  );
  const [val, setVal] = useState<string>(cantiere.capocantiere_id ?? "__none__");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Capocantiere: {cantiere.nome}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={val} onValueChange={setVal}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nessuno</SelectItem>
              {filtered.map((m) => <SelectItem key={m.id} value={m.id}>{fullName(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
            <Button disabled={saving} onClick={async () => {
              setSaving(true);
              try {
                await setCapoFn({ data: {
                  cantiere_id: cantiere.id,
                  capocantiere_id: val === "__none__" ? null : val,
                  expected_updated_at: cantiere.updated_at,
                }});
                toast.success("Capocantiere aggiornato"); onDone();
              } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
            }}>Salva</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============= TEAM TAB =============
function TeamTab({ commessa, canManage }: any) {
  const qc = useQueryClient();
  const listMembersFn = useServerFn(listCommessaMembers);
  const listCantieriFn = useServerFn(listCantieri);
  const addFn = useServerFn(addCommessaMember);
  const updateFn = useServerFn(updateCommessaMember);
  const removeFn = useServerFn(removeCommessaMember);
  const [addOpen, setAddOpen] = useState(false);
  const [removeDlg, setRemoveDlg] = useState<any>(null);
  const [filterCantiere, setFilterCantiere] = useState<string>("__all__");
  const [filterRuolo, setFilterRuolo] = useState<string>("__all__");

  const { data: members = [] } = useQuery({
    queryKey: ["commessa-members", commessa.id],
    queryFn: async () => await listMembersFn({ data: { commessa_id: commessa.id } }),
  });
  const { data: cantieri = [] } = useQuery({
    queryKey: ["cantieri-lite", commessa.id],
    queryFn: async () => await listCantieriFn({ data: { commessa_id: commessa.id } }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["commessa-members", commessa.id] });

  const filtered = (members as any[]).filter((m) =>
    (filterCantiere === "__all__" || (filterCantiere === "__none__" ? !m.cantiere_id : m.cantiere_id === filterCantiere))
    && (filterRuolo === "__all__" || m.ruolo_operativo === filterRuolo)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Select value={filterCantiere} onValueChange={setFilterCantiere}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Filtro cantiere" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tutti i cantieri</SelectItem>
              <SelectItem value="__none__">Assegnati a commessa (no cantiere)</SelectItem>
              {(cantieri as any[]).map((k) => <SelectItem key={k.id} value={k.id}>{k.codice} — {k.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterRuolo} onValueChange={setFilterRuolo}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Filtro ruolo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tutti i ruoli</SelectItem>
              {Object.entries(RUOLI_OP_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {canManage && !commessa.closed_at && !commessa.archived_at && (
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" />Aggiungi membro</Button>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Utente</th>
                <th className="text-left p-3">Ruolo</th>
                <th className="text-left p-3">Cantiere</th>
                <th className="text-left p-3">Inizio</th>
                <th className="text-left p-3">Fine</th>
                <th className="text-left p-3">Stato</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m: any) => {
                const cant = (cantieri as any[]).find((k) => k.id === m.cantiere_id);
                return (
                  <tr key={m.id} className="border-t">
                    <td className="p-3">{fullName(m.profile)}<div className="text-xs text-muted-foreground">{m.profile?.email}</div></td>
                    <td className="p-3">{RUOLI_OP_LABEL[m.ruolo_operativo] ?? m.ruolo_operativo}</td>
                    <td className="p-3 text-xs">{cant ? `${cant.codice} — ${cant.nome}` : <span className="text-muted-foreground">Commessa intera</span>}</td>
                    <td className="p-3">{dateIt(m.data_inizio)}</td>
                    <td className="p-3">{dateIt(m.data_fine)}</td>
                    <td className="p-3">
                      {m.is_active && !m.archived_at ? <Badge variant="default">Attivo</Badge> : <Badge variant="secondary">Terminato</Badge>}
                    </td>
                    <td className="p-3 text-right">
                      {canManage && m.is_active && !m.archived_at && (
                        <Button size="sm" variant="ghost" onClick={() => setRemoveDlg(m)}>Rimuovi</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Nessun membro</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AddMemberDialog
        open={addOpen} onOpenChange={setAddOpen}
        commessaId={commessa.id} cantieri={cantieri as any[]} onDone={invalidate}
      />
      <ConfirmDialog
        open={!!removeDlg} onOpenChange={(v: boolean) => !v && setRemoveDlg(null)}
        title="Rimuovi membro"
        description="Il membro sarà disattivato ma lo storico resterà consultabile."
        requireMotivazione confirmLabel="Rimuovi" destructive
        onConfirm={async ({ motivazione }) => {
          await removeFn({ data: { id: removeDlg.id, motivazione: motivazione! } });
          toast.success("Membro rimosso"); invalidate(); setRemoveDlg(null);
        }}
      />
    </div>
  );
}

function AddMemberDialog({ open, onOpenChange, commessaId, cantieri, onDone }: any) {
  const listFn = useServerFn(listAssignableMembers);
  const addFn = useServerFn(addCommessaMember);
  const { data: users = [] } = useQuery({
    queryKey: ["assignable-members"], enabled: open,
    queryFn: async () => await listFn(),
  });
  const [userId, setUserId] = useState("");
  const [ruolo, setRuolo] = useState<string>("operaio");
  const [cantiereId, setCantiereId] = useState<string>("__none__");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Aggiungi membro</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Utente *</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Seleziona utente attivo" /></SelectTrigger>
              <SelectContent>
                {(users as any[]).map((u) => <SelectItem key={u.id} value={u.id}>{fullName(u)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ruolo operativo *</Label>
            <Select value={ruolo} onValueChange={setRuolo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(RUOLI_OP_LABEL).filter(([v]) => v !== "responsabile_commessa").map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground mt-1">Per il responsabile principale usa "Cambia responsabile" nella panoramica.</div>
          </div>
          <div>
            <Label>Cantiere</Label>
            <Select value={cantiereId} onValueChange={setCantiereId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Assegna all'intera commessa</SelectItem>
                {(cantieri as any[]).filter((k) => !k.archived_at).map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.codice} — {k.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
            <Button disabled={saving || !userId} onClick={async () => {
              setSaving(true);
              try {
                await addFn({ data: {
                  commessa_id: commessaId, user_id: userId,
                  ruolo_operativo: ruolo as any,
                  cantiere_id: cantiereId === "__none__" ? null : cantiereId,
                }});
                toast.success("Membro aggiunto"); onDone(); onOpenChange(false);
                setUserId(""); setRuolo("operaio"); setCantiereId("__none__");
              } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
            }}>Aggiungi</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============= RAPPORTINI TAB =============
function RapportiniTab({ commessaId }: any) {
  const listFn = useServerFn(listRapportiniByCommessa);
  const { data = [] } = useQuery({
    queryKey: ["rapportini-commessa", commessaId],
    queryFn: async () => await listFn({ data: { commessa_id: commessaId } }),
  });
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 flex justify-between items-center border-b">
          <div className="text-sm text-muted-foreground">Rapportini collegati ({data.length})</div>
          <Button asChild size="sm" variant="outline"><Link to="/rapportini">Vai al modulo</Link></Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Data</th>
              <th className="text-left p-3">Utente</th>
              <th className="text-left p-3">Cantiere</th>
              <th className="text-right p-3">Ore</th>
              <th className="text-left p-3">Lavorazione</th>
            </tr>
          </thead>
          <tbody>
            {(data as any[]).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">{dateIt(r.data)}</td>
                <td className="p-3">{fullName(r.user)}</td>
                <td className="p-3 text-xs">{r.cantiere ? `${r.cantiere.codice} — ${r.cantiere.nome}` : "—"}</td>
                <td className="p-3 text-right">{Number(r.ore ?? 0).toFixed(2)}</td>
                <td className="p-3 text-muted-foreground truncate max-w-xs">{r.lavorazione ?? "—"}</td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Nessun rapportino</td></tr>}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ============= DOCUMENTI TAB =============
function DocumentiTab({ commessaId }: any) {
  const listFn = useServerFn(listDocumentiByCommessa);
  const { data = [] } = useQuery({
    queryKey: ["documenti-commessa", commessaId],
    queryFn: async () => await listFn({ data: { commessa_id: commessaId } }),
  });
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 flex justify-between items-center border-b">
          <div className="text-sm text-muted-foreground">Documenti collegati ({data.length})</div>
          <Button asChild size="sm" variant="outline"><Link to="/documenti">Vai al modulo</Link></Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Nome</th>
              <th className="text-left p-3">Categoria</th>
              <th className="text-left p-3">Cantiere</th>
              <th className="text-left p-3">Data</th>
              <th className="text-left p-3">Scadenza</th>
            </tr>
          </thead>
          <tbody>
            {(data as any[]).map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">{r.nome}</td>
                <td className="p-3 text-xs text-muted-foreground">{r.categoria ?? "—"}</td>
                <td className="p-3 text-xs">{r.cantiere ? `${r.cantiere.codice} — ${r.cantiere.nome}` : "—"}</td>
                <td className="p-3">{dateIt(r.data_documento)}</td>
                <td className="p-3">{dateIt(r.data_scadenza)}</td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Nessun documento</td></tr>}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ============= STORICO TAB =============
const AUDIT_LABELS: Record<string, string> = {
  "commessa.created": "Commessa creata",
  "commessa.updated": "Commessa aggiornata",
  "commessa.state_changed": "Cambio stato",
  "commessa.closed": "Commessa chiusa",
  "commessa.reopened": "Commessa riaperta",
  "commessa.archived": "Commessa archiviata",
  "commessa.restored": "Commessa ripristinata",
  "commessa.responsabile_changed": "Responsabile modificato",
  "commessa.converted_from_preventivo": "Convertita da preventivo",
  "commessa.member_added": "Membro aggiunto",
  "commessa.member_updated": "Membro aggiornato",
  "commessa.member_removed": "Membro rimosso",
  "cantiere.created": "Cantiere creato",
  "cantiere.updated": "Cantiere aggiornato",
  "cantiere.archived": "Cantiere archiviato",
  "cantiere.restored": "Cantiere ripristinato",
  "cantiere.capocantiere_changed": "Capocantiere modificato",
};

function StoricoTab({ commessaId }: any) {
  const listFn = useServerFn(listCommessaAudit);
  const { data = [] } = useQuery({
    queryKey: ["audit-commessa", commessaId],
    queryFn: async () => await listFn({ data: { commessa_id: commessaId, limit: 100 } }),
  });
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Quando</th>
              <th className="text-left p-3">Chi</th>
              <th className="text-left p-3">Azione</th>
              <th className="text-left p-3">Dettagli</th>
            </tr>
          </thead>
          <tbody>
            {(data as any[]).map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="p-3 text-xs">{new Date(r.created_at).toLocaleString("it-IT")}</td>
                <td className="p-3">{fullName(r.user)}</td>
                <td className="p-3 font-medium">{AUDIT_LABELS[r.action] ?? r.action}</td>
                <td className="p-3 text-xs text-muted-foreground">{summarizeAudit(r)}</td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Nessuna voce nello storico</td></tr>}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function summarizeAudit(r: any): string {
  const m = r.metadata ?? {};
  if (r.action === "commessa.state_changed") return `Da ${m.stato_precedente ?? "?"} a ${m.stato_nuovo ?? "?"}${m.motivazione ? ` — ${m.motivazione}` : ""}`;
  if (r.action === "commessa.responsabile_changed") return `Responsabile modificato`;
  if (r.action === "commessa.updated") return `Campi: ${(m.campi ?? []).join(", ")}`;
  if (r.action === "commessa.closed" || r.action === "commessa.archived" || r.action === "cantiere.archived") return m.motivazione ?? "";
  if (r.action === "cantiere.created") return `${m.codice ?? ""} — ${m.nome ?? ""}`;
  if (r.action === "commessa.member_added") return `${RUOLI_OP_LABEL[m.ruolo_operativo] ?? m.ruolo_operativo}`;
  return "";
}
