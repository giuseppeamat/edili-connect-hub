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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, AlertTriangle, Archive, RotateCcw, Scale, Calculator, ArrowUp, ArrowDown, Info } from "lucide-react";
import { dateIt } from "@/lib/format";
import {
  listCommessaFasi, createCommessaFase, updateCommessaFase,
  updateFaseAvanzamento, changeFaseStato,
  archiveCommessaFase, restoreCommessaFase,
  distribuisciPesiEqualmente, setCommessaAvanzamentoModalita,
  reorderCommessaFasi,
} from "@/lib/commessa-fasi.functions";
import { listCantieri } from "@/lib/cantieri.functions";
import { listResponsabiliCandidati } from "@/lib/commesse.functions";
import { ConfirmDialog } from "@/components/commesse/confirm-dialog";

const STATI_LABEL: Record<string, string> = {
  non_iniziata: "Non iniziata", in_corso: "In corso", sospesa: "Sospesa",
  completata: "Completata", annullata: "Annullata",
};
const STATI_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  non_iniziata: "outline", in_corso: "default", sospesa: "secondary",
  completata: "secondary", annullata: "destructive",
};

type Transizione = {
  value: string; label: string;
  needsMotivo?: boolean;
  warning?: string;
};
const TRANSIZIONI: Record<string, Transizione[]> = {
  non_iniziata: [
    { value: "in_corso", label: "→ In corso" },
    { value: "sospesa", label: "→ Sospesa" },
    { value: "annullata", label: "→ Annullata", needsMotivo: true,
      warning: "La fase sarà esclusa dal calcolo dell'avanzamento della commessa." },
  ],
  in_corso: [
    { value: "sospesa", label: "→ Sospesa" },
    { value: "completata", label: "→ Completata",
      warning: "L'avanzamento verrà impostato al 100%." },
    { value: "annullata", label: "→ Annullata", needsMotivo: true,
      warning: "La fase sarà esclusa dal calcolo dell'avanzamento della commessa." },
  ],
  sospesa: [
    { value: "in_corso", label: "→ In corso" },
    { value: "annullata", label: "→ Annullata", needsMotivo: true,
      warning: "La fase sarà esclusa dal calcolo dell'avanzamento della commessa." },
  ],
  completata: [
    { value: "in_corso", label: "→ Riapri (in corso)", needsMotivo: true,
      warning: "La fase tornerà in corso e l'avanzamento dovrà essere inferiore al 100%." },
  ],
  annullata: [],
};

type FaseRow = any;

/** Detect optimistic-locking / concurrency errors from the server error mapper. */
function isConflictError(msg: string): boolean {
  const m = (msg || "").toLowerCase();
  return m.includes("modificat") && (m.includes("altro utente") || m.includes("concorrenza"));
}

/**
 * Wrap a mutation call. On concurrency conflict: show clear banner + refetch.
 * Never silently retry or overwrite.
 */
async function runWithConflict<T>(
  op: () => Promise<T>,
  opts: {
    onConflict: (message: string) => void;
    successMsg?: string;
    onSuccess?: () => void;
  },
): Promise<{ ok: boolean; conflict?: boolean; error?: string }> {
  try {
    await op();
    if (opts.successMsg) toast.success(opts.successMsg);
    opts.onSuccess?.();
    return { ok: true };
  } catch (e: any) {
    const msg: string = e?.message ?? "Operazione non riuscita";
    if (isConflictError(msg)) {
      opts.onConflict(msg);
      return { ok: false, conflict: true, error: msg };
    }
    toast.error(msg || "Non è stato possibile completare l'operazione. Riprova.");
    return { ok: false, error: msg };
  }
}

export function FasiTab({
  commessaId, canManage, avanzamentoModalita, commessaUpdatedAt,
  commessaClosed, commessaArchived,
}: {
  commessaId: string;
  canManage: boolean;
  avanzamentoModalita: string;
  commessaUpdatedAt: string;
  commessaClosed?: boolean;
  commessaArchived?: boolean;
}) {
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editFase, setEditFase] = useState<FaseRow | null>(null);
  const [progressFase, setProgressFase] = useState<FaseRow | null>(null);
  const [stateDlg, setStateDlg] = useState<{ fase: FaseRow; transizione: Transizione } | null>(null);
  const [archDlg, setArchDlg] = useState<FaseRow | null>(null);
  const [restoreDlg, setRestoreDlg] = useState<FaseRow | null>(null);
  const [modalitaDlg, setModalitaDlg] = useState<"manuale" | "fasi" | null>(null);
  const [distribDlg, setDistribDlg] = useState(false);

  const readOnly = !!(commessaClosed || commessaArchived);
  const effectiveManage = canManage && !readOnly;

  const listFn = useServerFn(listCommessaFasi);
  const query = useQuery({
    queryKey: ["commessa-fasi", commessaId, includeArchived],
    queryFn: () => listFn({ data: { commessa_id: commessaId, includeArchived } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["commessa-fasi", commessaId] });
    qc.invalidateQueries({ queryKey: ["commessa-detail", commessaId] });
  };
  const refetchAndBanner = async (msg: string) => {
    toast.error(msg);
    await query.refetch();
    qc.invalidateQueries({ queryKey: ["commessa-detail", commessaId] });
  };

  const fasi: FaseRow[] = query.data ?? [];
  const attive = useMemo(
    () => fasi.filter((f) => !f.archived_at && f.stato !== "annullata"),
    [fasi],
  );
  const pesoTot = useMemo(
    () => attive.reduce((s, f) => s + Number(f.peso_percentuale ?? 0), 0),
    [attive],
  );
  const pesoDiff = 100 - pesoTot;
  const pesoOk = Math.abs(pesoDiff) < 0.5;

  const reorderFn = useServerFn(reorderCommessaFasi);
  const moveMut = useMutation({
    mutationFn: async (args: { faseId: string; dir: -1 | 1 }) => {
      const idx = attive.findIndex((f) => f.id === args.faseId);
      if (idx < 0) throw new Error("Fase non trovata");
      const target = idx + args.dir;
      if (target < 0 || target >= attive.length) return;
      const newOrder = attive.map((f) => f.id);
      [newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]];
      await reorderFn({ data: { commessa_id: commessaId, order: newOrder } });
    },
    onSuccess: () => invalidate(),
    onError: async (e: any) => {
      if (isConflictError(e?.message ?? "")) await refetchAndBanner(e.message);
      else toast.error(e?.message ?? "Riordino non riuscito");
    },
  });

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            La commessa è {commessaClosed ? "chiusa" : "archiviata"}: tutte le fasi sono in sola lettura.
            Riaprila o ripristinala per apportare modifiche.
          </span>
        </div>
      )}

      {/* Toolbar */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Modalità avanzamento:</Label>
            <Select
              value={avanzamentoModalita}
              onValueChange={(v) => setModalitaDlg(v as any)}
              disabled={!effectiveManage}
            >
              <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manuale">Manuale</SelectItem>
                <SelectItem value="fasi">Calcolata dalle fasi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={pesoOk ? "secondary" : (pesoTot === 0 ? "outline" : "destructive")} className="gap-1">
              <Scale className="h-3 w-3" />
              Somma pesi: {pesoTot.toFixed(2)}%
            </Badge>
            {!pesoOk && (
              <span className="text-xs text-muted-foreground">
                {pesoTot === 0 ? "Ideale: 100%" : `Differenza da 100%: ${pesoDiff > 0 ? "+" : ""}${pesoDiff.toFixed(2)}%`}
              </span>
            )}
          </div>

          {effectiveManage && (
            <Button size="sm" variant="outline" onClick={() => setDistribDlg(true)} disabled={attive.length === 0}>
              <Calculator className="h-4 w-4 mr-1" />Distribuisci equamente
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setIncludeArchived((v) => !v)}>
              {includeArchived ? "Nascondi archiviate" : "Mostra archiviate"}
            </Button>
            {effectiveManage && (
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
          Nessuna fase pianificata. {effectiveManage && "Crea la prima per iniziare la pianificazione operativa."}
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {fasi.map((f) => {
          const activeIdx = attive.findIndex((x) => x.id === f.id);
          return (
            <FaseRowCard
              key={f.id}
              fase={f}
              canManage={effectiveManage}
              canMoveUp={activeIdx > 0}
              canMoveDown={activeIdx >= 0 && activeIdx < attive.length - 1}
              onMove={(dir) => moveMut.mutate({ faseId: f.id, dir })}
              onEdit={() => setEditFase(f)}
              onProgress={() => setProgressFase(f)}
              onState={(transizione) => setStateDlg({ fase: f, transizione })}
              onArchive={() => setArchDlg(f)}
              onRestore={() => setRestoreDlg(f)}
            />
          );
        })}
      </div>

      {createOpen && (
        <FaseFormDialog
          commessaId={commessaId}
          onClose={() => setCreateOpen(false)}
          onDone={invalidate}
          onConflict={refetchAndBanner}
        />
      )}
      {editFase && (
        <FaseFormDialog
          key={editFase.id + editFase.updated_at}
          fase={editFase}
          commessaId={commessaId}
          onClose={() => setEditFase(null)}
          onDone={invalidate}
          onConflict={refetchAndBanner}
        />
      )}
      {progressFase && (
        <ProgressDialog
          key={progressFase.id + progressFase.updated_at}
          fase={progressFase}
          onClose={() => setProgressFase(null)}
          onDone={invalidate}
          onConflict={refetchAndBanner}
        />
      )}
      {stateDlg && (
        <StateChangeDialog
          data={stateDlg}
          onClose={() => setStateDlg(null)}
          onDone={invalidate}
          onConflict={refetchAndBanner}
        />
      )}
      {archDlg && (
        <ArchiveDialog
          fase={archDlg}
          onClose={() => setArchDlg(null)}
          onDone={invalidate}
          onConflict={refetchAndBanner}
        />
      )}
      {restoreDlg && (
        <RestoreDialog
          fase={restoreDlg}
          onClose={() => setRestoreDlg(null)}
          onDone={invalidate}
          onConflict={refetchAndBanner}
        />
      )}
      {modalitaDlg && (
        <ModalitaDialog
          commessaId={commessaId}
          commessaUpdatedAt={commessaUpdatedAt}
          modalitaAttuale={avanzamentoModalita as any}
          modalitaTarget={modalitaDlg}
          fasiAttive={attive}
          pesoTot={pesoTot}
          onClose={() => setModalitaDlg(null)}
          onDone={invalidate}
          onConflict={async (m) => {
            toast.error(m);
            qc.invalidateQueries({ queryKey: ["commessa-detail", commessaId] });
          }}
        />
      )}
      {distribDlg && (
        <DistribuisciDialog
          commessaId={commessaId}
          fasiAttive={attive}
          onClose={() => setDistribDlg(false)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase row
// ─────────────────────────────────────────────────────────────────────────────
function FaseRowCard({
  fase, canManage, canMoveUp, canMoveDown, onMove,
  onEdit, onProgress, onState, onArchive, onRestore,
}: {
  fase: FaseRow; canManage: boolean;
  canMoveUp: boolean; canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void; onProgress: () => void;
  onState: (t: Transizione) => void;
  onArchive: () => void; onRestore: () => void;
}) {
  const transizioni = TRANSIZIONI[fase.stato] ?? [];
  const isAnnullata = fase.stato === "annullata";
  const isArchiviata = !!fase.archived_at;
  const ritardo = fase.ritardo ?? null;

  return (
    <Card className={isArchiviata ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-medium">{fase.titolo}</span>
              <Badge variant={STATI_VARIANT[fase.stato]}>{STATI_LABEL[fase.stato] ?? fase.stato}</Badge>
              {ritardo?.is_late && !isArchiviata && !isAnnullata && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {ritardo.late_type === "start_delay"
                    ? `Avvio in ritardo di ${ritardo.days_late} gg`
                    : `In ritardo di ${ritardo.days_late} gg`}
                </Badge>
              )}
              {isArchiviata && <Badge variant="outline">Archiviata</Badge>}
              <span className="text-xs text-muted-foreground">
                Peso: <span className="font-medium">{Number(fase.peso_percentuale ?? 0).toFixed(2)}%</span>
              </span>
            </div>
            {fase.descrizione && <p className="text-sm text-muted-foreground mb-2">{fase.descrizione}</p>}
            <div className="flex items-center gap-3 mb-2">
              <Progress value={Number(fase.avanzamento_percentuale ?? 0)} className="flex-1 h-2" />
              <span className="text-sm font-medium min-w-[3rem] text-right">
                {Number(fase.avanzamento_percentuale ?? 0).toFixed(0)}%
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {fase.cantiere
                ? <span>Cantiere: <span className="font-medium">{fase.cantiere.codice} · {fase.cantiere.nome}</span></span>
                : <span className="italic">Fase generale della commessa</span>}
              {fase.responsabile && (
                <span>
                  Resp.: <span className="font-medium">
                    {[fase.responsabile.nome, fase.responsabile.cognome].filter(Boolean).join(" ") || fase.responsabile.email}
                  </span>
                </span>
              )}
              {fase.data_inizio_prevista && <span>Inizio prev.: {dateIt(fase.data_inizio_prevista)}</span>}
              {fase.data_fine_prevista && <span>Fine prev.: {dateIt(fase.data_fine_prevista)}</span>}
              {fase.data_inizio_effettiva && <span>Inizio eff.: {dateIt(fase.data_inizio_effettiva)}</span>}
              {fase.data_fine_effettiva && <span>Fine eff.: {dateIt(fase.data_fine_effettiva)}</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-start gap-1">
            {canManage && !isArchiviata && !isAnnullata && (
              <div className="flex flex-col">
                <Button size="icon" variant="ghost" className="h-6 w-6"
                        disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label="Sposta su">
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6"
                        disabled={!canMoveDown} onClick={() => onMove(1)} aria-label="Sposta giù">
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {canManage && !isArchiviata && !isAnnullata && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="Azioni fase"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onProgress}>Aggiorna avanzamento</DropdownMenuItem>
                  <DropdownMenuItem onClick={onEdit}>Modifica dati</DropdownMenuItem>
                  {transizioni.length > 0 && <DropdownMenuSeparator />}
                  {transizioni.length > 0 && <DropdownMenuLabel className="text-xs">Cambia stato</DropdownMenuLabel>}
                  {transizioni.map((t) => (
                    <DropdownMenuItem key={t.value} onClick={() => onState(t)}>{t.label}</DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onArchive} className="text-destructive">
                    <Archive className="h-4 w-4 mr-2" />Archivia
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canManage && isArchiviata && (
              <Button size="sm" variant="ghost" onClick={onRestore}>
                <RotateCcw className="h-4 w-4 mr-1" />Ripristina
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Edit Form
// ─────────────────────────────────────────────────────────────────────────────
function FaseFormDialog({
  fase, commessaId, onClose, onDone, onConflict,
}: {
  fase?: FaseRow; commessaId: string;
  onClose: () => void; onDone: () => void;
  onConflict: (msg: string) => Promise<void>;
}) {
  const isEdit = !!fase;
  const [titolo, setTitolo] = useState(fase?.titolo ?? "");
  const [descrizione, setDescrizione] = useState(fase?.descrizione ?? "");
  const [peso, setPeso] = useState<string>(String(fase?.peso_percentuale ?? "0"));
  const [dip, setDip] = useState<string>(fase?.data_inizio_prevista ?? "");
  const [dfp, setDfp] = useState<string>(fase?.data_fine_prevista ?? "");
  const [note, setNote] = useState<string>(fase?.note ?? "");
  const [cantiereId, setCantiereId] = useState<string>(fase?.cantiere_id ?? "__none__");
  const [respId, setRespId] = useState<string>(fase?.responsabile_id ?? "__none__");
  const [pending, setPending] = useState(false);
  const [errBanner, setErrBanner] = useState<string | null>(null);

  const listCantieriFn = useServerFn(listCantieri);
  const listRespFn = useServerFn(listResponsabiliCandidati);
  const createFn = useServerFn(createCommessaFase);
  const updateFn = useServerFn(updateCommessaFase);

  const { data: cantieri = [] } = useQuery({
    queryKey: ["cantieri-per-commessa", commessaId],
    queryFn: () => listCantieriFn({ data: { commessa_id: commessaId, includeArchived: false } }),
  });
  const { data: candidati = [] } = useQuery({
    queryKey: ["responsabili-candidati"],
    queryFn: () => listRespFn(),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrBanner(null);
    if (dip && dfp && dfp < dip) {
      setErrBanner("La data di fine prevista non può essere antecedente alla data di inizio prevista.");
      return;
    }
    setPending(true);
    try {
      const payload = {
        titolo,
        descrizione: descrizione || null,
        peso_percentuale: Number(peso) || 0,
        data_inizio_prevista: dip || null,
        data_fine_prevista: dfp || null,
        note: note || null,
        cantiere_id: cantiereId === "__none__" ? null : cantiereId,
        responsabile_id: respId === "__none__" ? null : respId,
      };
      if (isEdit) {
        await updateFn({ data: { id: fase!.id, expected_updated_at: fase!.updated_at, ...payload } });
        toast.success("Fase aggiornata");
      } else {
        await createFn({ data: { commessa_id: commessaId, ...payload } });
        toast.success("Fase creata");
      }
      onDone(); onClose();
    } catch (e: any) {
      const msg = e?.message ?? "Non è stato possibile completare l'operazione. Riprova.";
      if (isConflictError(msg)) {
        setErrBanner(
          "Questa fase è stata modificata da un altro utente. I dati sono stati aggiornati: controllali prima di riprovare.",
        );
        await onConflict(msg);
      } else {
        setErrBanner(msg);
      }
    } finally { setPending(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifica fase" : "Nuova fase"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Aggiorna i dati anagrafici e di pianificazione. Stato e avanzamento si modificano dalle azioni dedicate."
              : "Compila i dati della fase. Potrai aggiornare stato e avanzamento successivamente."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {errBanner && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errBanner}</span>
            </div>
          )}
          <div>
            <Label htmlFor="fase-titolo">Titolo *</Label>
            <Input id="fase-titolo" value={titolo} onChange={(e) => setTitolo(e.target.value)} required autoFocus maxLength={200} />
          </div>
          <div>
            <Label htmlFor="fase-desc">Descrizione</Label>
            <Textarea id="fase-desc" value={descrizione} onChange={(e) => setDescrizione(e.target.value)} rows={2} maxLength={2000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fase-cantiere">Cantiere</Label>
              <Select value={cantiereId} onValueChange={setCantiereId}>
                <SelectTrigger id="fase-cantiere"><SelectValue placeholder="Fase generale della commessa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Fase generale della commessa</SelectItem>
                  {(cantieri as any[]).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.codice} · {c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="fase-resp">Responsabile</Label>
              <Select value={respId} onValueChange={setRespId}>
                <SelectTrigger id="fase-resp"><SelectValue placeholder="Non assegnato" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Non assegnato</SelectItem>
                  {(candidati as any[]).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {[r.nome, r.cognome].filter(Boolean).join(" ") || r.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="fase-peso">Peso %</Label>
              <Input id="fase-peso" type="number" min={0} max={100} step="0.01"
                     value={peso} onChange={(e) => setPeso(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fase-dip">Inizio prev.</Label>
              <Input id="fase-dip" type="date" value={dip} onChange={(e) => setDip(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fase-dfp">Fine prev.</Label>
              <Input id="fase-dfp" type="date" value={dfp} onChange={(e) => setDfp(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="fase-note">Note</Label>
            <Textarea id="fase-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Annulla</Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvataggio…" : (isEdit ? "Salva" : "Crea")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress dialog
// ─────────────────────────────────────────────────────────────────────────────
function ProgressDialog({
  fase, onClose, onDone, onConflict,
}: {
  fase: FaseRow;
  onClose: () => void; onDone: () => void;
  onConflict: (msg: string) => Promise<void>;
}) {
  const attuale = Number(fase.avanzamento_percentuale ?? 0);
  const [val, setVal] = useState<string>(String(attuale));
  const [motivazione, setMotivazione] = useState("");
  const [pending, setPending] = useState(false);
  const [errBanner, setErrBanner] = useState<string | null>(null);
  const fn = useServerFn(updateFaseAvanzamento);

  const nuovo = Number(val);
  const delta = Number.isFinite(nuovo) ? nuovo - attuale : 0;
  const isReduce = Number.isFinite(nuovo) && nuovo < attuale;
  const isCompleta = nuovo === 100;
  const zeroSuCompletata = nuovo === 0 && fase.stato === "completata";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrBanner(null);
    if (!Number.isFinite(nuovo) || nuovo < 0 || nuovo > 100) {
      setErrBanner("Valore avanzamento deve essere compreso tra 0 e 100.");
      return;
    }
    if (zeroSuCompletata) {
      setErrBanner("Per riaprire una fase completata usa l'azione dedicata di cambio stato.");
      return;
    }
    if (isReduce && !motivazione.trim()) {
      setErrBanner("Motivazione obbligatoria per ridurre l'avanzamento.");
      return;
    }
    setPending(true);
    try {
      await fn({
        data: {
          id: fase.id,
          expected_updated_at: fase.updated_at,
          avanzamento_percentuale: nuovo,
          motivazione: motivazione.trim() || null,
        },
      });
      toast.success("Avanzamento aggiornato");
      onDone(); onClose();
    } catch (e: any) {
      const msg = e?.message ?? "Operazione non riuscita";
      if (isConflictError(msg)) {
        setErrBanner("Questa fase è stata modificata da un altro utente. I dati sono stati aggiornati: controllali prima di riprovare.");
        await onConflict(msg);
      } else {
        setErrBanner(msg);
      }
    } finally { setPending(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Aggiorna avanzamento — {fase.titolo}</DialogTitle>
          <DialogDescription>Avanzamento attuale: <b>{attuale.toFixed(0)}%</b></DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {errBanner && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errBanner}</span>
            </div>
          )}
          <div>
            <Label htmlFor="prog-val">Nuovo avanzamento % (0–100)</Label>
            <Input id="prog-val" type="number" min={0} max={100} step="1"
                   value={val} onChange={(e) => setVal(e.target.value)} required autoFocus />
            {Number.isFinite(nuovo) && (
              <p className={`text-xs mt-1 ${delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                Variazione: {delta > 0 ? "+" : ""}{delta.toFixed(0)} punti percentuali
              </p>
            )}
          </div>
          {isCompleta && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Il 100% completerà la fase (stato: Completata).</span>
            </div>
          )}
          <div>
            <Label htmlFor="prog-mot">Motivazione {isReduce && "*"}</Label>
            <Textarea id="prog-mot" value={motivazione} onChange={(e) => setMotivazione(e.target.value)} rows={2}
                      placeholder={isReduce ? "Obbligatoria in caso di riduzione avanzamento…" : "Facoltativa"}
                      required={isReduce} maxLength={500} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Annulla</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvataggio…" : "Salva"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State change
// ─────────────────────────────────────────────────────────────────────────────
function StateChangeDialog({
  data, onClose, onDone, onConflict,
}: {
  data: { fase: FaseRow; transizione: Transizione };
  onClose: () => void; onDone: () => void;
  onConflict: (msg: string) => Promise<void>;
}) {
  const fn = useServerFn(changeFaseStato);
  const [pending, setPending] = useState(false);

  return (
    <ConfirmDialog
      open onOpenChange={(v) => !v && !pending && onClose()}
      title={`Cambio stato: ${STATI_LABEL[data.transizione.value] ?? data.transizione.value}`}
      description={`Fase: ${data.fase.titolo} (stato attuale: ${STATI_LABEL[data.fase.stato] ?? data.fase.stato})`}
      warning={data.transizione.warning}
      requireMotivazione={data.transizione.needsMotivo}
      motivazionePlaceholder="Motivo del cambio stato…"
      isPending={pending}
      onConfirm={async ({ motivazione }) => {
        setPending(true);
        try {
          await fn({
            data: {
              id: data.fase.id,
              expected_updated_at: data.fase.updated_at,
              stato: data.transizione.value as any,
              motivazione: motivazione ?? null,
            },
          });
          toast.success("Stato aggiornato");
          onDone(); onClose();
        } catch (e: any) {
          const msg = e?.message ?? "Operazione non riuscita";
          if (isConflictError(msg)) {
            await onConflict(
              "Questa fase è stata modificata da un altro utente. I dati sono stati aggiornati: controllali prima di riprovare.",
            );
            onClose();
          } else {
            throw new Error(msg);
          }
        } finally { setPending(false); }
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive
// ─────────────────────────────────────────────────────────────────────────────
function ArchiveDialog({
  fase, onClose, onDone, onConflict,
}: {
  fase: FaseRow;
  onClose: () => void; onDone: () => void;
  onConflict: (msg: string) => Promise<void>;
}) {
  const fn = useServerFn(archiveCommessaFase);
  const [pending, setPending] = useState(false);
  const richiedeMotivo = fase.stato === "in_corso" || fase.stato === "completata";
  return (
    <ConfirmDialog
      open onOpenChange={(v) => !v && !pending && onClose()}
      title="Archivia fase"
      description={`La fase "${fase.titolo}" sarà nascosta dagli elenchi principali.`}
      warning="La fase archiviata sarà esclusa dal calcolo dell'avanzamento della commessa e resterà consultabile in sola lettura."
      destructive confirmLabel="Archivia"
      requireMotivazione={richiedeMotivo}
      motivazionePlaceholder="Motivo dell'archiviazione…"
      isPending={pending}
      onConfirm={async ({ motivazione }) => {
        setPending(true);
        try {
          await fn({
            data: {
              id: fase.id,
              expected_updated_at: fase.updated_at,
              motivazione: motivazione ?? null,
            },
          });
          toast.success("Fase archiviata"); onDone(); onClose();
        } catch (e: any) {
          const msg = e?.message ?? "Operazione non riuscita";
          if (isConflictError(msg)) {
            await onConflict("Questa fase è stata modificata da un altro utente. I dati sono stati aggiornati.");
            onClose();
          } else {
            throw new Error(msg);
          }
        } finally { setPending(false); }
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore
// ─────────────────────────────────────────────────────────────────────────────
function RestoreDialog({
  fase, onClose, onDone, onConflict,
}: {
  fase: FaseRow;
  onClose: () => void; onDone: () => void;
  onConflict: (msg: string) => Promise<void>;
}) {
  const fn = useServerFn(restoreCommessaFase);
  const [pending, setPending] = useState(false);
  return (
    <ConfirmDialog
      open onOpenChange={(v) => !v && !pending && onClose()}
      title="Ripristina fase"
      description={`La fase "${fase.titolo}" tornerà visibile negli elenchi.`}
      warning={`Stato (${STATI_LABEL[fase.stato] ?? fase.stato}) e avanzamento (${Number(fase.avanzamento_percentuale ?? 0).toFixed(0)}%) resteranno invariati. Una fase annullata NON verrà riattivata automaticamente.`}
      confirmLabel="Ripristina"
      isPending={pending}
      onConfirm={async () => {
        setPending(true);
        try {
          await fn({ data: { id: fase.id, expected_updated_at: fase.updated_at } });
          toast.success("Fase ripristinata"); onDone(); onClose();
        } catch (e: any) {
          const msg = e?.message ?? "Operazione non riuscita";
          if (isConflictError(msg)) {
            await onConflict("Questa fase è stata modificata da un altro utente. I dati sono stati aggiornati.");
            onClose();
          } else {
            throw new Error(msg);
          }
        } finally { setPending(false); }
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modalità dialog (manuale ↔ fasi)
// ─────────────────────────────────────────────────────────────────────────────
function ModalitaDialog({
  commessaId, commessaUpdatedAt, modalitaAttuale, modalitaTarget,
  fasiAttive, pesoTot, onClose, onDone, onConflict,
}: {
  commessaId: string;
  commessaUpdatedAt: string;
  modalitaAttuale: "manuale" | "fasi";
  modalitaTarget: "manuale" | "fasi";
  fasiAttive: FaseRow[];
  pesoTot: number;
  onClose: () => void; onDone: () => void;
  onConflict: (msg: string) => Promise<void>;
}) {
  const fn = useServerFn(setCommessaAvanzamentoModalita);
  const [pending, setPending] = useState(false);
  const [motivazione, setMotivazione] = useState("");
  const [confermaPesoZero, setConfermaPesoZero] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isNoop = modalitaAttuale === modalitaTarget;
  const isManualeToFasi = modalitaAttuale === "manuale" && modalitaTarget === "fasi";
  const isFasiToManuale = modalitaAttuale === "fasi" && modalitaTarget === "manuale";
  const pesoZero = pesoTot === 0;

  // Anteprima ponderata
  const anteprima = useMemo(() => {
    if (!isManualeToFasi || pesoTot === 0) return null;
    const num = fasiAttive.reduce(
      (s, f) => s + Number(f.peso_percentuale ?? 0) * Number(f.avanzamento_percentuale ?? 0),
      0,
    );
    return num / pesoTot;
  }, [fasiAttive, pesoTot, isManualeToFasi]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (isNoop) { onClose(); return; }
    if (isFasiToManuale && !motivazione.trim()) {
      setErr("Motivazione obbligatoria per tornare all'avanzamento manuale.");
      return;
    }
    if (isManualeToFasi && pesoZero && !confermaPesoZero) {
      setErr("Il peso totale è 0. Conferma esplicita richiesta.");
      return;
    }
    setPending(true);
    try {
      await fn({
        data: {
          commessa_id: commessaId,
          modalita: modalitaTarget,
          expected_updated_at: commessaUpdatedAt,
          motivazione: motivazione.trim() || null,
          conferma_peso_zero: isManualeToFasi ? confermaPesoZero : false,
        },
      });
      toast.success("Modalità avanzamento aggiornata");
      onDone(); onClose();
    } catch (e: any) {
      const msg = e?.message ?? "Operazione non riuscita";
      if (isConflictError(msg)) {
        setErr("Questa commessa è stata modificata da un altro utente. I dati sono stati aggiornati.");
        await onConflict(msg);
      } else {
        setErr(msg);
      }
    } finally { setPending(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cambia modalità avanzamento</DialogTitle>
          <DialogDescription>
            Da <b>{modalitaAttuale === "manuale" ? "Manuale" : "Calcolata dalle fasi"}</b>{" "}
            a <b>{modalitaTarget === "manuale" ? "Manuale" : "Calcolata dalle fasi"}</b>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {err && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{err}</span>
            </div>
          )}

          <div className="rounded-md border p-3 text-xs space-y-1">
            <div>Fasi attive (non archiviate né annullate): <b>{fasiAttive.length}</b></div>
            <div>Peso totale attivi: <b>{pesoTot.toFixed(2)}%</b></div>
            {isManualeToFasi && anteprima !== null && (
              <div>Anteprima avanzamento ponderato: <b>{anteprima.toFixed(1)}%</b></div>
            )}
          </div>

          {isManualeToFasi && pesoZero && (
            <>
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Il peso totale delle fasi attive è 0. Fino all'assegnazione dei pesi,
                  l'avanzamento calcolato resterà indeterminato.
                </span>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confermaPesoZero}
                       onChange={(e) => setConfermaPesoZero(e.target.checked)} className="mt-0.5" />
                <span>Confermo di voler procedere con peso totale = 0.</span>
              </label>
            </>
          )}

          {isFasiToManuale && (
            <>
              <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Il valore attuale di avanzamento della commessa verrà conservato.</span>
              </div>
              <div>
                <Label htmlFor="mod-mot">Motivazione *</Label>
                <Textarea id="mod-mot" value={motivazione} onChange={(e) => setMotivazione(e.target.value)}
                          rows={2} required maxLength={500}
                          placeholder="Perché torniamo alla modalità manuale?" />
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Annulla</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvataggio…" : "Conferma"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribuzione pesi
// ─────────────────────────────────────────────────────────────────────────────
function DistribuisciDialog({
  commessaId, fasiAttive, onClose, onDone,
}: {
  commessaId: string;
  fasiAttive: FaseRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const fn = useServerFn(distribuisciPesiEqualmente);
  const [pending, setPending] = useState(false);

  const n = fasiAttive.length;
  const anteprima = useMemo(() => {
    if (n === 0) return [] as number[];
    const base = Math.floor((100 / n) * 100) / 100;
    const arr = new Array(n).fill(base);
    const sum = base * n;
    arr[n - 1] = Number((base + (100 - sum)).toFixed(2));
    return arr;
  }, [n]);

  return (
    <ConfirmDialog
      open onOpenChange={(v) => !v && !pending && onClose()}
      title="Distribuisci pesi equamente"
      description={`Le ${n} fasi attive riceveranno un peso uniforme. Le fasi archiviate o annullate non verranno modificate.`}
      confirmLabel="Distribuisci"
      isPending={pending}
      warning={n === 0 ? "Non ci sono fasi attive da modificare." : `Anteprima: ${anteprima.map((v) => v.toFixed(2)).join(" / ")}%`}
      onConfirm={async () => {
        if (n === 0) { onClose(); return; }
        setPending(true);
        try {
          await fn({ data: { commessa_id: commessaId } });
          toast.success("Pesi distribuiti equamente");
          onDone(); onClose();
        } catch (e: any) {
          throw new Error(e?.message ?? "Operazione non riuscita");
        } finally { setPending(false); }
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual commessa progress dialog (esportato per uso in Panoramica)
// ─────────────────────────────────────────────────────────────────────────────
export { ManualCommessaProgressDialog };

import { updateManualCommessaProgress } from "@/lib/commesse.functions";

function ManualCommessaProgressDialog({
  open, onOpenChange, commessa, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  commessa: { id: string; updated_at: string; avanzamento_pct?: number | null };
  onDone: () => void;
}) {
  const attuale = Number(commessa.avanzamento_pct ?? 0);
  const [val, setVal] = useState<string>(String(attuale));
  const [motivazione, setMotivazione] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fn = useServerFn(updateManualCommessaProgress);

  const nuovo = Number(val);
  const isReduce = Number.isFinite(nuovo) && nuovo < attuale;
  const delta = Number.isFinite(nuovo) ? nuovo - attuale : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!Number.isFinite(nuovo) || nuovo < 0 || nuovo > 100) {
      setErr("Valore fuori range (0–100)."); return;
    }
    if (isReduce && !motivazione.trim()) {
      setErr("Motivazione obbligatoria per ridurre l'avanzamento."); return;
    }
    setPending(true);
    try {
      await fn({
        data: {
          commessaId: commessa.id,
          avanzamentoPercentuale: nuovo,
          expectedUpdatedAt: commessa.updated_at,
          motivazione: motivazione.trim() || null,
        },
      });
      toast.success("Avanzamento commessa aggiornato");
      onDone(); onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message ?? "Operazione non riuscita";
      if (isConflictError(msg)) {
        setErr("Questa commessa è stata modificata da un altro utente. I dati sono stati aggiornati.");
      } else {
        setErr(msg);
      }
    } finally { setPending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !pending && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Aggiorna avanzamento commessa</DialogTitle>
          <DialogDescription>Valore attuale: <b>{attuale.toFixed(0)}%</b> (modalità manuale)</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {err && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{err}</span>
            </div>
          )}
          <div>
            <Label htmlFor="mprog-val">Nuovo avanzamento % (0–100)</Label>
            <Input id="mprog-val" type="number" min={0} max={100} step="1"
                   value={val} onChange={(e) => setVal(e.target.value)} required autoFocus />
            {Number.isFinite(nuovo) && (
              <p className={`text-xs mt-1 ${delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                Variazione: {delta > 0 ? "+" : ""}{delta.toFixed(0)} punti percentuali
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="mprog-mot">Motivazione {isReduce && "*"}</Label>
            <Textarea id="mprog-mot" value={motivazione} onChange={(e) => setMotivazione(e.target.value)}
                      rows={2} required={isReduce} maxLength={500}
                      placeholder={isReduce ? "Obbligatoria per riduzione…" : "Facoltativa"} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Annulla</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvataggio…" : "Salva"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
