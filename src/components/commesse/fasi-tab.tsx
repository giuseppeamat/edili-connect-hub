import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, AlertTriangle, Archive, RotateCcw, Scale, Calculator } from "lucide-react";
import { dateIt } from "@/lib/format";
import {
  listCommessaFasi, createCommessaFase, updateCommessaFase,
  updateFaseAvanzamento, changeFaseStato,
  archiveCommessaFase, restoreCommessaFase,
  distribuisciPesiEqualmente, setCommessaAvanzamentoModalita,
} from "@/lib/commessa-fasi.functions";
import { ConfirmDialog } from "@/components/commesse/confirm-dialog";

const STATI_LABEL: Record<string, string> = {
  non_iniziata: "Non iniziata", in_corso: "In corso", sospesa: "Sospesa",
  completata: "Completata", annullata: "Annullata",
};
const STATI_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  non_iniziata: "outline", in_corso: "default", sospesa: "secondary",
  completata: "secondary", annullata: "destructive",
};

const TRANSIZIONI: Record<string, { value: string; label: string; needsMotivo?: boolean }[]> = {
  non_iniziata: [{ value: "in_corso", label: "→ In corso" }, { value: "annullata", label: "→ Annullata", needsMotivo: true }],
  in_corso: [{ value: "sospesa", label: "→ Sospesa" }, { value: "completata", label: "→ Completata" }, { value: "annullata", label: "→ Annullata", needsMotivo: true }],
  sospesa: [{ value: "in_corso", label: "→ In corso" }, { value: "annullata", label: "→ Annullata", needsMotivo: true }],
  completata: [{ value: "in_corso", label: "→ Riapri (in corso)" }],
  annullata: [{ value: "non_iniziata", label: "→ Ripristina" }],
};

type FaseRow = any;

export function FasiTab({
  commessaId, canManage, avanzamentoModalita,
}: {
  commessaId: string;
  canManage: boolean;
  avanzamentoModalita: string;
}) {
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editFase, setEditFase] = useState<FaseRow | null>(null);
  const [progressFase, setProgressFase] = useState<FaseRow | null>(null);
  const [stateDlg, setStateDlg] = useState<{ fase: FaseRow; nuovo: string; needsMotivo?: boolean } | null>(null);
  const [archDlg, setArchDlg] = useState<FaseRow | null>(null);

  const listFn = useServerFn(listCommessaFasi);
  const query = useQuery({
    queryKey: ["commessa-fasi", commessaId, includeArchived],
    queryFn: () => listFn({ data: { commessa_id: commessaId, includeArchived } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["commessa-fasi", commessaId] });
    qc.invalidateQueries({ queryKey: ["commessa-detail", commessaId] });
  };

  const distribuisciFn = useServerFn(distribuisciPesiEqualmente);
  const setModalitaFn = useServerFn(setCommessaAvanzamentoModalita);
  const distribuisciMut = useMutation({
    mutationFn: () => distribuisciFn({ data: { commessa_id: commessaId } }),
    onSuccess: () => { toast.success("Pesi distribuiti equamente"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const setModalitaMut = useMutation({
    mutationFn: (args: { modalita: "manuale" | "fasi"; expected_updated_at: string; motivazione?: string | null }) =>
      setModalitaFn({ data: { commessa_id: commessaId, ...args } }),
    onSuccess: () => { toast.success("Modalità avanzamento aggiornata"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const fasi: FaseRow[] = query.data ?? [];
  const pesoTot = useMemo(() =>
    fasi.filter((f) => !f.archived_at && f.stato !== "annullata")
        .reduce((s, f) => s + Number(f.peso_percentuale ?? 0), 0),
    [fasi]);
  const pesoOk = Math.abs(pesoTot - 100) < 0.5 || pesoTot === 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Modalità avanzamento:</Label>
            <Select
              value={avanzamentoModalita}
              onValueChange={(v) => setModalitaMut.mutate(v as any)}
              disabled={!canManage || setModalitaMut.isPending}
            >
              <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manuale">Manuale</SelectItem>
                <SelectItem value="fasi">Calcolata dalle fasi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={pesoOk ? "secondary" : "destructive"} className="gap-1">
              <Scale className="h-3 w-3" />
              Somma pesi: {pesoTot.toFixed(2)}%
            </Badge>
            {!pesoOk && <span className="text-xs text-muted-foreground">Ideale: 100%</span>}
          </div>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => distribuisciMut.mutate()} disabled={distribuisciMut.isPending || fasi.length === 0}>
              <Calculator className="h-4 w-4 mr-1" />Distribuisci equamente
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setIncludeArchived((v) => !v)}>
              {includeArchived ? "Nascondi archiviate" : "Mostra archiviate"}
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />Nuova fase
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      {query.isLoading && <div className="text-center text-muted-foreground py-8">Caricamento…</div>}
      {!query.isLoading && fasi.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Nessuna fase pianificata. {canManage && "Crea la prima per iniziare la pianificazione operativa."}
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {fasi.map((f) => <FaseRowCard key={f.id} fase={f} canManage={canManage}
          onEdit={() => setEditFase(f)}
          onProgress={() => setProgressFase(f)}
          onState={(nuovo, needsMotivo) => setStateDlg({ fase: f, nuovo, needsMotivo })}
          onArchive={() => setArchDlg(f)}
          onRestore={() => invalidate()}
        />)}
      </div>

      {/* Dialogs */}
      {createOpen && <FaseFormDialog commessaId={commessaId} onClose={() => setCreateOpen(false)} onDone={invalidate} />}
      {editFase && <FaseFormDialog fase={editFase} commessaId={commessaId} onClose={() => setEditFase(null)} onDone={invalidate} />}
      {progressFase && <ProgressDialog fase={progressFase} onClose={() => setProgressFase(null)} onDone={invalidate} />}
      {stateDlg && <StateChangeDialog data={stateDlg} onClose={() => setStateDlg(null)} onDone={invalidate} />}
      {archDlg && <ArchiveDialog fase={archDlg} onClose={() => setArchDlg(null)} onDone={invalidate} />}
    </div>
  );
}

function FaseRowCard({ fase, canManage, onEdit, onProgress, onState, onArchive, onRestore }: {
  fase: FaseRow; canManage: boolean;
  onEdit: () => void; onProgress: () => void;
  onState: (nuovo: string, needsMotivo?: boolean) => void;
  onArchive: () => void; onRestore: () => void;
}) {
  const oggi = new Date().toISOString().slice(0,10);
  const inRitardo = fase.data_fine_prevista && fase.data_fine_prevista < oggi
    && fase.stato !== "completata" && fase.stato !== "annullata" && !fase.archived_at;
  const transizioni = TRANSIZIONI[fase.stato] ?? [];
  const restoreFn = useServerFn(restoreCommessaFase);

  return (
    <Card className={fase.archived_at ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-medium">{fase.titolo}</span>
              <Badge variant={STATI_VARIANT[fase.stato]}>{STATI_LABEL[fase.stato] ?? fase.stato}</Badge>
              {inRitardo && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />In ritardo
                </Badge>
              )}
              {fase.archived_at && <Badge variant="outline">Archiviata</Badge>}
              <span className="text-xs text-muted-foreground">Peso: <span className="font-medium">{Number(fase.peso_percentuale ?? 0).toFixed(2)}%</span></span>
            </div>
            {fase.descrizione && <p className="text-sm text-muted-foreground mb-2">{fase.descrizione}</p>}
            <div className="flex items-center gap-3 mb-2">
              <Progress value={Number(fase.avanzamento_percentuale ?? 0)} className="flex-1 h-2" />
              <span className="text-sm font-medium min-w-[3rem] text-right">{Number(fase.avanzamento_percentuale ?? 0).toFixed(0)}%</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {fase.cantiere && <span>Cantiere: <span className="font-medium">{fase.cantiere.codice} · {fase.cantiere.nome}</span></span>}
              {fase.responsabile && <span>Resp.: <span className="font-medium">{[fase.responsabile.nome, fase.responsabile.cognome].filter(Boolean).join(" ") || fase.responsabile.email}</span></span>}
              {fase.data_inizio_prevista && <span>Inizio prev.: {dateIt(fase.data_inizio_prevista)}</span>}
              {fase.data_fine_prevista && <span>Fine prev.: {dateIt(fase.data_fine_prevista)}</span>}
              {fase.data_inizio_effettiva && <span>Inizio eff.: {dateIt(fase.data_inizio_effettiva)}</span>}
              {fase.data_fine_effettiva && <span>Fine eff.: {dateIt(fase.data_fine_effettiva)}</span>}
            </div>
          </div>
          {canManage && !fase.archived_at && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onProgress}>Aggiorna avanzamento</DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit}>Modifica dati</DropdownMenuItem>
                {transizioni.length > 0 && <DropdownMenuSeparator />}
                {transizioni.length > 0 && <DropdownMenuLabel className="text-xs">Cambia stato</DropdownMenuLabel>}
                {transizioni.map((t) => (
                  <DropdownMenuItem key={t.value} onClick={() => onState(t.value, t.needsMotivo)}>{t.label}</DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onArchive} className="text-destructive">
                  <Archive className="h-4 w-4 mr-2" />Archivia
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canManage && fase.archived_at && (
            <Button size="sm" variant="ghost" onClick={async () => {
              try { await restoreFn({ data: { id: fase.id } }); toast.success("Ripristinata"); onRestore(); }
              catch (e: any) { toast.error(e.message); }
            }}>
              <RotateCcw className="h-4 w-4 mr-1" />Ripristina
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FaseFormDialog({ fase, commessaId, onClose, onDone }: { fase?: FaseRow; commessaId: string; onClose: () => void; onDone: () => void }) {
  const isEdit = !!fase;
  const [titolo, setTitolo] = useState(fase?.titolo ?? "");
  const [descrizione, setDescrizione] = useState(fase?.descrizione ?? "");
  const [peso, setPeso] = useState<string>(String(fase?.peso_percentuale ?? "0"));
  const [dip, setDip] = useState(fase?.data_inizio_prevista ?? "");
  const [dfp, setDfp] = useState(fase?.data_fine_prevista ?? "");
  const [note, setNote] = useState(fase?.note ?? "");
  const createFn = useServerFn(createCommessaFase);
  const updateFn = useServerFn(updateCommessaFase);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const payload: any = {
        titolo, descrizione: descrizione || null,
        peso_percentuale: Number(peso) || 0,
        data_inizio_prevista: dip || null,
        data_fine_prevista: dfp || null,
        note: note || null,
      };
      if (isEdit) await updateFn({ data: { id: fase!.id, ...payload } });
      else await createFn({ data: { commessa_id: commessaId, ...payload } });
      toast.success(isEdit ? "Fase aggiornata" : "Fase creata");
      onDone(); onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setPending(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? "Modifica fase" : "Nuova fase"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Titolo *</Label><Input value={titolo} onChange={(e) => setTitolo(e.target.value)} required /></div>
          <div><Label>Descrizione</Label><Textarea value={descrizione} onChange={(e) => setDescrizione(e.target.value)} rows={2} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Peso %</Label>
              <Input type="number" min={0} max={100} step="0.01" value={peso} onChange={(e) => setPeso(e.target.value)} />
            </div>
            <div><Label>Inizio prev.</Label><Input type="date" value={dip} onChange={(e) => setDip(e.target.value)} /></div>
            <div><Label>Fine prev.</Label><Input type="date" value={dfp} onChange={(e) => setDfp(e.target.value)} /></div>
          </div>
          <div><Label>Note</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvataggio…" : (isEdit ? "Salva" : "Crea")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProgressDialog({ fase, onClose, onDone }: { fase: FaseRow; onClose: () => void; onDone: () => void }) {
  const [val, setVal] = useState<string>(String(fase.avanzamento_percentuale ?? 0));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const fn = useServerFn(updateFaseAvanzamento);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      await fn({ data: { id: fase.id, avanzamento_percentuale: Number(val), note: note || null } });
      toast.success("Avanzamento aggiornato"); onDone(); onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setPending(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Aggiorna avanzamento — {fase.titolo}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Avanzamento % (0–100)</Label>
            <Input type="number" min={0} max={100} step="1" value={val} onChange={(e) => setVal(e.target.value)} required />
          </div>
          <div><Label>Nota (opzionale)</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvataggio…" : "Salva"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StateChangeDialog({ data, onClose, onDone }: {
  data: { fase: FaseRow; nuovo: string; needsMotivo?: boolean };
  onClose: () => void; onDone: () => void;
}) {
  const fn = useServerFn(changeFaseStato);
  const [pending, setPending] = useState(false);
  return (
    <ConfirmDialog
      open onOpenChange={(v) => !v && onClose()}
      title={`Cambio stato: ${STATI_LABEL[data.nuovo] ?? data.nuovo}`}
      description={`Fase: ${data.fase.titolo}`}
      requireMotivazione={data.needsMotivo}
      isPending={pending}
      onConfirm={async ({ motivazione }) => {
        setPending(true);
        try {
          await fn({ data: { id: data.fase.id, stato: data.nuovo as any, motivazione: motivazione ?? null } });
          toast.success("Stato aggiornato"); onDone(); onClose();
        } finally { setPending(false); }
      }}
    />
  );
}

function ArchiveDialog({ fase, onClose, onDone }: { fase: FaseRow; onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(archiveCommessaFase);
  const [pending, setPending] = useState(false);
  return (
    <ConfirmDialog
      open onOpenChange={(v) => !v && onClose()}
      title="Archivia fase" description={`La fase "${fase.titolo}" sarà nascosta dagli elenchi principali.`}
      destructive confirmLabel="Archivia" isPending={pending}
      onConfirm={async () => {
        setPending(true);
        try {
          await fn({ data: { id: fase.id } });
          toast.success("Fase archiviata"); onDone(); onClose();
        } finally { setPending(false); }
      }}
    />
  );
}
