import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle, Plus, Archive, ArchiveRestore, Pencil, ArrowUp, ArrowDown,
  Lock, RefreshCcw, DownloadCloud, Settings2, BookmarkPlus, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { eur, num as fmtNum, dateIt } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  listCommessaBudgetVoci, getCommessaBudgetSummary,
  createCommessaBudgetVoce, updateCommessaBudgetVoce,
  archiveCommessaBudgetVoce, restoreCommessaBudgetVoce,
  reorderCommessaBudgetVoci, importBudgetFromPreventivo,
  setCommessaBudgetMode, updateManualCommessaBudget, setCommessaBaseline,
  listBudgetAssignableCantieriFasi, listBudgetFornitori,
  getBudgetPreventivoInfo, BUDGET_CATEGORIES,
} from "@/lib/commessa-budget.functions";
import { isCommessaBudgetLocked, commessaLockReason, BUDGET_MSG } from "@/lib/commessa-lock";


// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const CONFLICT_MSG =
  "Il budget è stato modificato da un altro utente. I dati sono stati aggiornati: controllali prima di riprovare.";

const nz = (n: any) => (n === null || n === undefined ? null : Number(n));
const displayEur = (n: any) => (n === null || n === undefined ? "—" : eur(Number(n)));
const displayPct = (n: any) =>
  n === null || n === undefined ? "—" : `${fmtNum(Number(n), 2)}%`;

function isConflict(e: any) {
  const m = (e?.message ?? "").toString();
  return /modificato da un altro utente|conflitto di concorrenza/i.test(m);
}

const COSTO_CAT_LABEL: Record<string, string> = {
  manodopera: "Manodopera", materiali: "Materiali", subappalti: "Subappalti",
  noleggi: "Noleggi", mezzi: "Mezzi", trasporti: "Trasporti",
  consulenze: "Consulenze", sicurezza: "Sicurezza", smaltimenti: "Smaltimenti",
  utenze: "Utenze", spese_generali: "Spese generali", imprevisti: "Imprevisti",
  altro: "Altro",
};
const RICAVO_CAT_LABEL: Record<string, string> = {
  contratto: "Contratto", extra_approvato: "Extra approvato",
  extra_non_approvato: "Extra non approvato", variante: "Variante",
  rimborso: "Rimborso", altro: "Altro",
};
const FONTE_LABEL: Record<string, string> = {
  preventivo: "Da preventivo", manuale: "Manuale", rapportino: "Rapportino",
  acquisto: "Acquisto", fattura: "Fattura", variante: "Variante", altro: "Altro",
};

function catLabel(tipo: string, categoria: string | null | undefined) {
  if (!categoria) return "—";
  return tipo === "ricavo" ? (RICAVO_CAT_LABEL[categoria] ?? categoria) : (COSTO_CAT_LABEL[categoria] ?? categoria);
}

// ---------------------------------------------------------------------------
// BUDGET TAB (root)
// ---------------------------------------------------------------------------
export function BudgetTab({
  commessa, commessaId, isClosed, isArchived,
}: {
  commessa?: { stato?: string | null; closed_at?: string | null; archived_at?: string | null } | null;
  commessaId: string;
  isClosed: boolean;
  isArchived: boolean;
}) {
  const user = useCurrentUser();
  const qc = useQueryClient();

  const lockInput = {
    stato: commessa?.stato ?? null,
    closed_at: commessa?.closed_at ?? (isClosed ? "1" : null),
    archived_at: commessa?.archived_at ?? (isArchived ? "1" : null),
  };
  const locked = isCommessaBudgetLocked(lockInput);
  const lockReason = commessaLockReason(lockInput);

  const getSummaryFn = useServerFn(getCommessaBudgetSummary);
  const listVociFn = useServerFn(listCommessaBudgetVoci);
  const listAssignFn = useServerFn(listBudgetAssignableCantieriFasi);
  const listForniFn = useServerFn(listBudgetFornitori);
  const getPrevFn = useServerFn(getBudgetPreventivoInfo);

  const canView = user.canViewCommessaBudget;
  const canEdit = user.canEditCommessaBudget && !locked;
  const canImport = user.canImportCommessaBudget && !locked;
  const canBaseline = user.canManageCommessaBaseline && !locked;
  const canManualUpd = user.canEditManualCommessaBudget && !locked;
  const canChangeMode = user.canChangeCommessaBudgetMode && !locked;


  const [filters, setFilters] = useState<{
    tipo?: "ricavo" | "costo"; categoria?: string;
    cantiere_id?: string; fase_id?: string; fornitore_id?: string;
    fonte?: string; includeArchived: boolean; onlyLocked: boolean; withScostamento: boolean;
  }>({ includeArchived: false, onlyLocked: false, withScostamento: false });

  const summaryQ = useQuery({
    queryKey: ["commessa-budget-summary", commessaId],
    queryFn: () => getSummaryFn({ data: { commessa_id: commessaId } }),
    enabled: canView,
  });

  const vociQ = useQuery({
    queryKey: ["commessa-budget-voci", commessaId, filters],
    queryFn: () => listVociFn({ data: { commessa_id: commessaId, ...filters } }),
    enabled: canView,
  });

  const assignQ = useQuery({
    queryKey: ["commessa-budget-assignables", commessaId],
    queryFn: () => listAssignFn({ data: { commessa_id: commessaId } }),
    enabled: canView,
  });

  const forniQ = useQuery({
    queryKey: ["commessa-budget-fornitori"],
    queryFn: () => listForniFn({}),
    enabled: canView,
  });

  const prevQ = useQuery({
    queryKey: ["commessa-budget-preventivo", commessaId],
    queryFn: () => getPrevFn({ data: { commessa_id: commessaId } }),
    enabled: canView,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["commessa-budget-summary", commessaId] });
    qc.invalidateQueries({ queryKey: ["commessa-budget-voci", commessaId] });
    qc.invalidateQueries({ queryKey: ["commessa-detail", commessaId] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["commesse-board"] });
  };

  const [voceDlg, setVoceDlg] = useState<{ open: boolean; voce?: any }>({ open: false });
  const [importDlg, setImportDlg] = useState(false);
  const [modeDlg, setModeDlg] = useState(false);
  const [manualDlg, setManualDlg] = useState(false);
  const [baselineDlg, setBaselineDlg] = useState(false);
  const [archDlg, setArchDlg] = useState<{ open: boolean; voce?: any }>({ open: false });
  const [restoreDlg, setRestoreDlg] = useState<{ open: boolean; voce?: any }>({ open: false });

  if (!canView) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Non hai i permessi per visualizzare il budget di questa commessa.
        </CardContent>
      </Card>
    );
  }
  if (summaryQ.isLoading) return <div className="p-6 text-muted-foreground">Caricamento budget…</div>;
  if (summaryQ.error) return <div className="p-6 text-destructive">{(summaryQ.error as Error).message}</div>;

  const s = summaryQ.data as any;
  const voci: any[] = vociQ.data ?? [];
  const modalita: "manuale" | "analitico" = s?.budget_modalita ?? "manuale";
  const isAnalytic = modalita === "analitico";
  const vociAttive = voci.filter((v) => !v.archived_at);
  const rowsFiltered = filters.withScostamento
    ? voci.filter((v) => {
        const prev = Number(v.importo_previsto ?? 0);
        const cur = v.tipo === "costo"
          ? Number(v.importo_sostenuto ?? 0) + Number(v.costo_residuo_stimato ?? 0)
          : Number(v.importo_impegnato ?? 0);
        return Math.abs(cur - prev) > 0.005;
      })
    : voci;

  const alerts = computeAlerts(s, vociAttive, prevQ.data);

  return (
    <div className="space-y-4">
      {/* SOLA LETTURA */}
      {locked && (
        <Card className="border-amber-300">
          <CardContent className="p-3 flex items-start gap-2 text-sm text-amber-900">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{lockReason}</span>
          </CardContent>
        </Card>
      )}

      {/* HEADER — MODALITÀ BUDGET (distinta dallo stato commessa) */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Modalità Budget</span>
              <Badge variant={isAnalytic ? "default" : "secondary"}>
                {isAnalytic ? "Analitico" : "Manuale"}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Ultimo ricalcolo: {s?.budget_calcolato_at ? new Date(s.budget_calcolato_at).toLocaleString("it-IT") : "—"}
            </div>
            {s?.preventivo_id && (
              <div className="text-xs text-muted-foreground">
                Preventivo collegato: <span className="font-medium">{prevQ.data?.numero ?? "…"}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canChangeMode && (
              <Button size="sm" variant="outline" onClick={() => setModeDlg(true)}>
                <Settings2 className="h-4 w-4 mr-1" />
                {isAnalytic ? "Passa a manuale" : "Passa ad analitico"}
              </Button>
            )}
            {!canChangeMode && !locked && user.canViewCommessaBudget && (
              <span className="text-xs text-muted-foreground">{BUDGET_MSG.notAuthorized}</span>
            )}
            {canManualUpd && !isAnalytic && (
              <Button size="sm" variant="outline" onClick={() => setManualDlg(true)}>
                <Pencil className="h-4 w-4 mr-1" />Aggiorna manuale
              </Button>
            )}
            {canImport && isAnalytic && s?.preventivo_id && (
              <Button size="sm" variant="outline" onClick={() => setImportDlg(true)}>
                <DownloadCloud className="h-4 w-4 mr-1" />Importa da preventivo
              </Button>
            )}
            {canEdit && isAnalytic && (
              <Button size="sm" onClick={() => setVoceDlg({ open: true })}>
                <Plus className="h-4 w-4 mr-1" />Nuova voce
              </Button>
            )}
            {!isAnalytic && user.canEditCommessaBudget && !locked && (
              <span className="text-xs text-muted-foreground">{BUDGET_MSG.manualMode}</span>
            )}
            {locked && user.canEditCommessaBudget && (
              <span className="text-xs text-muted-foreground">{BUDGET_MSG.locked}</span>
            )}
          </div>
        </CardContent>
      </Card>


      {/* KPI */}
      <KpiGrid s={s} />

      {/* ALERT */}
      {alerts.length > 0 && (
        <Card className="border-amber-300">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-600" />Segnalazioni
            </div>
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
              {alerts.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* FILTRI */}
      {isAnalytic && (
        <Card>
          <CardContent className="p-3 flex flex-wrap items-end gap-2">
            <FilterSelect label="Tipo" value={filters.tipo} onValueChange={(v) => setFilters({ ...filters, tipo: v as any, categoria: undefined })}
              options={[{ value: "ricavo", label: "Ricavo" }, { value: "costo", label: "Costo" }]} />
            <FilterSelect label="Categoria" value={filters.categoria}
              onValueChange={(v) => setFilters({ ...filters, categoria: v })}
              options={(filters.tipo === "ricavo" ? RICAVO_CAT.map((c) => ({ value: c, label: RICAVO_CAT_LABEL[c] })) :
                        filters.tipo === "costo" ? COSTO_CAT.map((c) => ({ value: c, label: COSTO_CAT_LABEL[c] })) :
                        [...COSTO_CAT.map((c) => ({ value: c, label: COSTO_CAT_LABEL[c] })), ...RICAVO_CAT.map((c) => ({ value: c, label: RICAVO_CAT_LABEL[c] }))])} />
            <FilterSelect label="Cantiere" value={filters.cantiere_id}
              onValueChange={(v) => setFilters({ ...filters, cantiere_id: v })}
              options={(assignQ.data?.cantieri ?? []).map((c: any) => ({ value: c.id, label: c.label }))} />
            <FilterSelect label="Fase" value={filters.fase_id}
              onValueChange={(v) => setFilters({ ...filters, fase_id: v })}
              options={(assignQ.data?.fasi ?? []).map((f: any) => ({ value: f.id, label: f.label }))} />
            <FilterSelect label="Fornitore" value={filters.fornitore_id}
              onValueChange={(v) => setFilters({ ...filters, fornitore_id: v })}
              options={(forniQ.data ?? []).map((f: any) => ({ value: f.id, label: f.label }))} />
            <FilterSelect label="Fonte" value={filters.fonte}
              onValueChange={(v) => setFilters({ ...filters, fonte: v })}
              options={Object.entries(FONTE_LABEL).map(([value, label]) => ({ value, label }))} />
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={filters.includeArchived} onCheckedChange={(v) => setFilters({ ...filters, includeArchived: !!v })} />
              Archiviate
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={filters.onlyLocked} onCheckedChange={(v) => setFilters({ ...filters, onlyLocked: !!v })} />
              Solo bloccate
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={filters.withScostamento} onCheckedChange={(v) => setFilters({ ...filters, withScostamento: !!v })} />
              Con scostamento
            </label>
            <Button size="sm" variant="ghost" onClick={() =>
              setFilters({ includeArchived: false, onlyLocked: false, withScostamento: false })
            }>Pulisci</Button>
          </CardContent>
        </Card>
      )}

      {/* LISTA VOCI */}
      {isAnalytic ? (
        <VociTable
          voci={rowsFiltered}
          commessaId={commessaId}
          canEdit={canEdit}
          onEdit={(v: any) => setVoceDlg({ open: true, voce: v })}
          onArchive={(v: any) => setArchDlg({ open: true, voce: v })}
          onRestore={(v: any) => setRestoreDlg({ open: true, voce: v })}
          onDone={invalidateAll}
          summaryUpdatedAt={s?.updated_at}
        />
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Budget in modalità manuale: gli aggregati sopra sono modificabili con "Aggiorna manuale".
            {" "}{BUDGET_MSG.manualMode}
          </CardContent>
        </Card>
      )}


      {/* BASELINE */}
      <BaselineCard s={s} canBaseline={canBaseline} onOpen={() => setBaselineDlg(true)} />

      {/* DIALOGS */}
      {voceDlg.open && (
        <VoceFormDialog
          open={voceDlg.open}
          onClose={() => setVoceDlg({ open: false })}
          voce={voceDlg.voce}
          commessaId={commessaId}
          summaryUpdatedAt={s?.updated_at}
          cantieri={assignQ.data?.cantieri ?? []}
          fasi={assignQ.data?.fasi ?? []}
          fornitori={forniQ.data ?? []}
          onDone={invalidateAll}
        />
      )}
      {archDlg.open && (
        <ArchiveVoceDialog open={archDlg.open} voce={archDlg.voce}
          onClose={() => setArchDlg({ open: false })} onDone={invalidateAll} />
      )}
      {restoreDlg.open && (
        <RestoreVoceDialog open={restoreDlg.open} voce={restoreDlg.voce}
          onClose={() => setRestoreDlg({ open: false })} onDone={invalidateAll} />
      )}
      {importDlg && (
        <ImportPreventivoDialog open={importDlg} onClose={() => setImportDlg(false)}
          commessaId={commessaId} preventivo={prevQ.data} summaryUpdatedAt={s?.updated_at}
          onDone={invalidateAll} />
      )}
      {modeDlg && (
        <ChangeModeDialog open={modeDlg} onClose={() => setModeDlg(false)}
          commessaId={commessaId} currentMode={modalita} vociAttiveCount={vociAttive.length}
          summaryUpdatedAt={s?.updated_at} onDone={invalidateAll} />
      )}
      {manualDlg && (
        <ManualBudgetDialog open={manualDlg} onClose={() => setManualDlg(false)}
          commessaId={commessaId} summary={s} onDone={invalidateAll} />
      )}
      {baselineDlg && (
        <BaselineDialog open={baselineDlg} onClose={() => setBaselineDlg(false)}
          commessaId={commessaId} summary={s} onDone={invalidateAll} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const COSTO_CAT = Object.keys(COSTO_CAT_LABEL);
const RICAVO_CAT = Object.keys(RICAVO_CAT_LABEL);

function FilterSelect({
  label, value, onValueChange, options,
}: {
  label: string;
  value?: string;
  onValueChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="min-w-[140px]">
      <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
      <Select value={value ?? "__all__"} onValueChange={(v) => onValueChange(v === "__all__" ? undefined : v)}>
        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Tutti</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
function KpiGrid({ s }: { s: any }) {
  const cards: { label: string; value: string; tone?: "neg" | "pos" }[] = [
    { label: "Ricavi previsti", value: displayEur(s?.ricavi_previsti) },
    { label: "Ricavi aggiornati", value: displayEur(s?.ricavi_aggiornati) },
    { label: "Costi previsti", value: displayEur(s?.costi_previsti) },
    { label: "Costi impegnati", value: displayEur(s?.costi_impegnati) },
    { label: "Costi sostenuti", value: displayEur(s?.costi_sostenuti) },
    { label: "Costi residui stimati", value: displayEur(s?.costi_residui_stimati) },
    { label: "Costo aggiornato", value: displayEur(s?.costo_aggiornato) },
    { label: "Margine previsto", value: displayEur(s?.margine_previsto), tone: Number(s?.margine_previsto ?? 0) < 0 ? "neg" : "pos" },
    { label: "Margine aggiornato", value: displayEur(s?.margine_aggiornato), tone: Number(s?.margine_aggiornato ?? 0) < 0 ? "neg" : "pos" },
    { label: "Margine %", value: displayPct(s?.margine_percentuale) },
    { label: "Margine % aggiornato", value: displayPct(s?.margine_percentuale_aggiornato) },
    { label: "Scostamento costi", value: displayEur(s?.scostamento_costi), tone: Number(s?.scostamento_costi ?? 0) > 0 ? "neg" : undefined },
    { label: "Scostamento ricavi", value: displayEur(s?.scostamento_ricavi), tone: Number(s?.scostamento_ricavi ?? 0) < 0 ? "neg" : undefined },
    { label: "Scostamento margine", value: displayEur(s?.scostamento_margine), tone: Number(s?.scostamento_margine ?? 0) < 0 ? "neg" : undefined },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">{c.label}</div>
            <div className={`text-sm font-semibold ${c.tone === "neg" ? "text-destructive" : ""}`}>{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function computeAlerts(s: any, voci: any[], prev: any): string[] {
  const out: string[] = [];
  const modalita = s?.budget_modalita ?? "manuale";
  if (modalita === "analitico" && voci.length === 0) out.push("Budget analitico senza voci: aggiungi voci o importa dal preventivo.");
  if (nz(s?.costo_aggiornato) !== null && nz(s?.costi_previsti) !== null && Number(s.costo_aggiornato) > Number(s.costi_previsti))
    out.push("Il costo aggiornato supera i costi previsti.");
  if (nz(s?.margine_aggiornato) !== null && Number(s.margine_aggiornato) < 0) out.push("Margine aggiornato negativo.");
  if (nz(s?.margine_aggiornato) !== null && nz(s?.margine_previsto) !== null && Number(s.margine_aggiornato) < Number(s.margine_previsto))
    out.push("Il margine aggiornato è inferiore al margine previsto.");
  if (nz(s?.ricavi_aggiornati) !== null && nz(s?.ricavi_previsti) !== null && Number(s.ricavi_aggiornati) < Number(s.ricavi_previsti))
    out.push("I ricavi aggiornati sono inferiori ai ricavi previsti.");
  for (const v of voci) {
    if (v.tipo === "costo" && Number(v.importo_sostenuto ?? 0) > Number(v.importo_previsto ?? 0))
      out.push(`Voce "${v.descrizione}": sostenuto superiore al previsto.`);
    if (v.tipo === "costo" && Number(v.importo_impegnato ?? 0) > 0 && !v.fornitore_id)
      out.push(`Voce "${v.descrizione}": impegnata senza fornitore.`);
    if (!v.categoria) out.push(`Voce "${v.descrizione}": categoria mancante.`);
  }
  if (prev && voci.length === 0 && modalita === "analitico")
    out.push("Preventivo collegato ma nessuna voce importata.");
  if (!s?.baseline_created_at) out.push("Baseline economica non ancora impostata.");
  if (modalita === "manuale" && (s?.ricavi_acquisiti === null || s?.ricavi_acquisiti === undefined))
    out.push("Modalità manuale: ricavi acquisiti non valorizzati.");
  return out.slice(0, 20);
}

// ---------------------------------------------------------------------------
function VociTable({
  voci, commessaId, canEdit, onEdit, onArchive, onRestore, onDone, summaryUpdatedAt,
}: any) {
  const reorderFn = useServerFn(reorderCommessaBudgetVoci);
  const qc = useQueryClient();

  const move = useMutation({
    mutationFn: async ({ order }: { order: string[] }) => reorderFn({ data: {
      commessa_id: commessaId, expected_updated_at: summaryUpdatedAt, order,
    } }),
    onSuccess: () => { toast.success("Ordine aggiornato"); onDone(); },
    onError: (e: any) => { toast.error(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore")); qc.invalidateQueries({ queryKey: ["commessa-budget-summary", commessaId] }); qc.invalidateQueries({ queryKey: ["commessa-budget-voci", commessaId] }); },
  });

  if (!voci?.length) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">Nessuna voce.</CardContent></Card>;
  }

  const activeIds = voci.filter((v: any) => !v.archived_at).map((v: any) => v.id);

  const swap = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= activeIds.length) return;
    const ids = [...activeIds];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    move.mutate({ order: ids });
  };

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="p-2 text-left">#</th>
            <th className="p-2 text-left">Tipo</th>
            <th className="p-2 text-left">Categoria</th>
            <th className="p-2 text-left">Descrizione</th>
            <th className="p-2 text-left">Cantiere / Fase</th>
            <th className="p-2 text-left">Fornitore</th>
            <th className="p-2 text-right">Previsto</th>
            <th className="p-2 text-right">Acq. / Impegn.</th>
            <th className="p-2 text-right">Sostenuto</th>
            <th className="p-2 text-right">Residuo</th>
            <th className="p-2 text-right">Scost.</th>
            <th className="p-2 text-left">Fonte</th>
            <th className="p-2 text-right">Azioni</th>
          </tr>
        </thead>
        <tbody>
          {voci.map((v: any, i: number) => {
            const activeIndex = v.archived_at ? -1 : activeIds.indexOf(v.id);
            const prev = Number(v.importo_previsto ?? 0);
            const curr = v.tipo === "costo"
              ? Number(v.importo_sostenuto ?? 0) + Number(v.costo_residuo_stimato ?? 0)
              : Number(v.importo_impegnato ?? 0);
            const scost = curr - prev;
            return (
              <tr key={v.id} className={`border-t ${v.archived_at ? "opacity-60" : ""}`}>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <span className="tabular-nums">{v.posizione}</span>
                    {canEdit && !v.archived_at && activeIndex >= 0 && (
                      <div className="flex flex-col">
                        <button className="disabled:opacity-30" disabled={activeIndex === 0 || move.isPending} onClick={() => swap(activeIndex, -1)}>
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button className="disabled:opacity-30" disabled={activeIndex === activeIds.length - 1 || move.isPending} onClick={() => swap(activeIndex, +1)}>
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </td>
                <td className="p-2"><Badge variant={v.tipo === "ricavo" ? "default" : "secondary"}>{v.tipo}</Badge></td>
                <td className="p-2">{catLabel(v.tipo, v.categoria)}</td>
                <td className="p-2">
                  <div className="font-medium">{v.descrizione}</div>
                  {v.codice && <div className="text-[10px] text-muted-foreground">{v.codice}</div>}
                </td>
                <td className="p-2">
                  <div>{v.cantiere?.nome ?? v.cantiere?.codice ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{v.fase?.titolo ?? ""}</div>
                </td>
                <td className="p-2">{v.fornitore?.ragione_sociale ?? "—"}</td>
                <td className="p-2 text-right tabular-nums">{displayEur(v.importo_previsto)}</td>
                <td className="p-2 text-right tabular-nums">{displayEur(v.importo_impegnato)}</td>
                <td className="p-2 text-right tabular-nums">{v.tipo === "ricavo" ? "—" : displayEur(v.importo_sostenuto)}</td>
                <td className="p-2 text-right tabular-nums">{v.tipo === "ricavo" ? "—" : displayEur(v.costo_residuo_stimato)}</td>
                <td className={`p-2 text-right tabular-nums ${scost > 0 && v.tipo === "costo" ? "text-destructive" : ""}`}>{eur(scost)}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <span>{FONTE_LABEL[v.fonte] ?? v.fonte}</span>
                    {v.is_locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </td>
                <td className="p-2 text-right">
                  {canEdit && !v.archived_at && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => onEdit(v)} title="Modifica">
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onArchive(v)} title="Archivia">
                        <Archive className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                  {canEdit && v.archived_at && (
                    <Button size="sm" variant="ghost" onClick={() => onRestore(v)} title="Ripristina">
                      <ArchiveRestore className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
function VoceFormDialog({
  open, onClose, voce, commessaId, summaryUpdatedAt,
  cantieri, fasi, fornitori, onDone,
}: any) {
  const isEdit = !!voce;
  const createFn = useServerFn(createCommessaBudgetVoce);
  const updateFn = useServerFn(updateCommessaBudgetVoce);
  const [f, setF] = useState<any>(() => ({
    tipo: voce?.tipo ?? "costo",
    categoria: voce?.categoria ?? "",
    descrizione: voce?.descrizione ?? "",
    sottocategoria: voce?.sottocategoria ?? "",
    codice: voce?.codice ?? "",
    unita_misura: voce?.unita_misura ?? "",
    quantita: voce?.quantita ?? "",
    prezzo_unitario: voce?.prezzo_unitario ?? "",
    importo_previsto: voce?.importo_previsto ?? 0,
    importo_impegnato: voce?.importo_impegnato ?? 0,
    importo_sostenuto: voce?.importo_sostenuto ?? 0,
    costo_residuo_stimato: voce?.costo_residuo_stimato ?? 0,
    cantiere_id: voce?.cantiere_id ?? "",
    fase_id: voce?.fase_id ?? "",
    fornitore_id: voce?.fornitore_id ?? "",
    note: voce?.note ?? "",
  }));
  const [err, setErr] = useState<string | null>(null);
  const locked = !!voce?.is_locked;

  const nOrNull = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));
  const nOr0 = (v: any) => (v === "" || v === null || v === undefined ? 0 : Number(v));
  const calc = useMemo(() => {
    const q = Number(f.quantita || 0), p = Number(f.prezzo_unitario || 0);
    return q > 0 && p > 0 ? q * p : null;
  }, [f.quantita, f.prezzo_unitario]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      if (isEdit) {
        await updateFn({ data: {
          id: voce.id,
          expected_updated_at: voce.updated_at,
          categoria: f.categoria || undefined,
          descrizione: f.descrizione,
          sottocategoria: f.sottocategoria || null,
          codice: f.codice || null,
          unita_misura: f.unita_misura || null,
          quantita: nOrNull(f.quantita) ?? undefined,
          prezzo_unitario: nOrNull(f.prezzo_unitario) ?? undefined,
          importo_previsto: nOr0(f.importo_previsto),
          importo_impegnato: nOr0(f.importo_impegnato),
          importo_sostenuto: f.tipo === "ricavo" ? 0 : nOr0(f.importo_sostenuto),
          costo_residuo_stimato: f.tipo === "ricavo" ? 0 : nOr0(f.costo_residuo_stimato),
          cantiere_id: f.cantiere_id || null,
          fase_id: f.fase_id || null,
          fornitore_id: f.fornitore_id || null,
          note: f.note || null,
        } });
      } else {
        await createFn({ data: {
          commessa_id: commessaId,
          expected_updated_at: summaryUpdatedAt,
          tipo: f.tipo,
          categoria: f.categoria,
          descrizione: f.descrizione,
          sottocategoria: f.sottocategoria || null,
          codice: f.codice || null,
          unita_misura: f.unita_misura || null,
          quantita: nOrNull(f.quantita),
          prezzo_unitario: nOrNull(f.prezzo_unitario),
          importo_previsto: nOr0(f.importo_previsto),
          importo_impegnato: nOr0(f.importo_impegnato),
          importo_sostenuto: f.tipo === "ricavo" ? 0 : nOr0(f.importo_sostenuto),
          costo_residuo_stimato: f.tipo === "ricavo" ? 0 : nOr0(f.costo_residuo_stimato),
          cantiere_id: f.cantiere_id || null,
          fase_id: f.fase_id || null,
          fornitore_id: f.fornitore_id || null,
          note: f.note || null,
        } });
      }
      toast.success(isEdit ? "Voce aggiornata" : "Voce creata");
      onDone();
      onClose();
    } catch (e: any) {
      setErr(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore"));
      if (isConflict(e)) onDone();
    }
  };

  const cats = f.tipo === "ricavo" ? RICAVO_CAT : COSTO_CAT;
  const catLabels = f.tipo === "ricavo" ? RICAVO_CAT_LABEL : COSTO_CAT_LABEL;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifica voce budget" : "Nuova voce budget"}</DialogTitle>
          {locked && <DialogDescription className="text-amber-700">Voce importata da preventivo. Alcuni campi restano bloccati per coerenza.</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo *</Label>
              <Select value={f.tipo} onValueChange={(v) => setF({ ...f, tipo: v, categoria: "" })} disabled={isEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="costo">Costo</SelectItem>
                  <SelectItem value="ricavo">Ricavo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Categoria *</Label>
              <Select value={f.categoria || undefined} onValueChange={(v) => setF({ ...f, categoria: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent>
                  {cats.map((c) => <SelectItem key={c} value={c}>{catLabels[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Descrizione *</Label>
            <Input required maxLength={1000} value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Codice</Label><Input value={f.codice} onChange={(e) => setF({ ...f, codice: e.target.value })} /></div>
            <div><Label>Sottocategoria</Label><Input value={f.sottocategoria} onChange={(e) => setF({ ...f, sottocategoria: e.target.value })} /></div>
            <div><Label>Unità misura</Label><Input value={f.unita_misura} onChange={(e) => setF({ ...f, unita_misura: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Cantiere</Label>
              <Select value={f.cantiere_id || "__none__"} onValueChange={(v) => setF({ ...f, cantiere_id: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nessuno</SelectItem>
                  {cantieri.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fase</Label>
              <Select value={f.fase_id || "__none__"} onValueChange={(v) => setF({ ...f, fase_id: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nessuna</SelectItem>
                  {fasi.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fornitore</Label>
              <Select value={f.fornitore_id || "__none__"} onValueChange={(v) => setF({ ...f, fornitore_id: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nessuno</SelectItem>
                  {fornitori.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Quantità</Label><Input type="number" step="0.01" value={f.quantita} onChange={(e) => setF({ ...f, quantita: e.target.value })} /></div>
            <div><Label>Prezzo unit.</Label><Input type="number" step="0.01" value={f.prezzo_unitario} onChange={(e) => setF({ ...f, prezzo_unitario: e.target.value })} /></div>
            <div>
              <Label>Importo previsto {calc !== null && <span className="text-[10px] text-muted-foreground">(calc: {eur(calc)})</span>}</Label>
              <Input type="number" step="0.01" value={f.importo_previsto} onChange={(e) => setF({ ...f, importo_previsto: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{f.tipo === "ricavo" ? "Acquisito / confermato" : "Impegnato"}</Label>
              <Input type="number" step="0.01" value={f.importo_impegnato} onChange={(e) => setF({ ...f, importo_impegnato: e.target.value })} />
            </div>
            {f.tipo === "costo" && (
              <>
                <div><Label>Sostenuto</Label><Input type="number" step="0.01" value={f.importo_sostenuto} onChange={(e) => setF({ ...f, importo_sostenuto: e.target.value })} /></div>
                <div><Label>Residuo stimato</Label><Input type="number" step="0.01" value={f.costo_residuo_stimato} onChange={(e) => setF({ ...f, costo_residuo_stimato: e.target.value })} /></div>
              </>
            )}
          </div>
          <div><Label>Note</Label><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
            <Button type="submit">{isEdit ? "Salva" : "Crea voce"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function ArchiveVoceDialog({ open, onClose, voce, onDone }: any) {
  const fn = useServerFn(archiveCommessaBudgetVoce);
  const [mot, setMot] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requireMot = !!voce?.is_locked;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (requireMot && !mot.trim()) { setErr("Motivazione obbligatoria per voce bloccata"); return; }
    setBusy(true);
    try {
      await fn({ data: { id: voce.id, expected_updated_at: voce.updated_at, motivazione: mot || null } });
      toast.success("Voce archiviata"); onDone(); onClose();
    } catch (e: any) {
      setErr(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore"));
      if (isConflict(e)) onDone();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Archivia voce</DialogTitle>
          <DialogDescription>La voce verrà esclusa dagli aggregati. Nessuna eliminazione fisica.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Motivazione{requireMot && " *"}</Label>
            <Textarea rows={3} value={mot} onChange={(e) => setMot(e.target.value)} required={requireMot} />
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button type="submit" variant="destructive" disabled={busy}>Archivia</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestoreVoceDialog({ open, onClose, voce, onDone }: any) {
  const fn = useServerFn(restoreCommessaBudgetVoce);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await fn({ data: { id: voce.id, expected_updated_at: voce.updated_at } });
      toast.success("Voce ripristinata"); onDone(); onClose();
    } catch (e: any) {
      setErr(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore"));
      if (isConflict(e)) onDone();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ripristina voce</DialogTitle>
          <DialogDescription>La voce tornerà negli aggregati. In caso di duplicato attivo con la stessa origine preventivo, l'operazione verrà rifiutata.</DialogDescription>
        </DialogHeader>
        {err && <div className="text-sm text-destructive">{err}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
          <Button onClick={submit} disabled={busy}>Ripristina</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function ImportPreventivoDialog({ open, onClose, commessaId, preventivo, summaryUpdatedAt, onDone }: any) {
  const fn = useServerFn(importBudgetFromPreventivo);
  const [strategy, setStrategy] = useState<"init_if_empty" | "add_missing">("add_missing");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fn({ data: { commessa_id: commessaId, expected_updated_at: summaryUpdatedAt, strategy } });
      setResult(r);
      toast.success("Import completato"); onDone();
    } catch (e: any) {
      setErr(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore"));
      if (isConflict(e)) onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importa dal preventivo</DialogTitle>
          <DialogDescription>
            {preventivo ? (
              <>
                Preventivo <span className="font-mono">{preventivo.numero}</span> · v{preventivo.versione} · stato {preventivo.stato} · {preventivo.numero_voci} voci ·
                ricavi {displayEur(preventivo.totale_ricavo ?? preventivo.totale)} · costi {displayEur(preventivo.totale_costo)}
              </>
            ) : "Preventivo non disponibile"}
          </DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="space-y-3">
            <div>
              <Label>Strategia</Label>
              <Select value={strategy} onValueChange={(v) => setStrategy(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="init_if_empty">Inizializza se vuoto</SelectItem>
                  <SelectItem value="add_missing">Aggiungi mancanti</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {err && <div className="text-sm text-destructive">{err}</div>}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
              <Button onClick={submit} disabled={busy}>Importa</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              <li>Ricavi creati: <span className="font-semibold">{result.ricavi_creati}</span></li>
              <li>Costi creati: <span className="font-semibold">{result.costi_creati}</span></li>
              <li>Ricavi ignorati (già presenti): {result.ricavi_ignorati}</li>
              <li>Costi ignorati (già presenti): {result.costi_ignorati}</li>
              <li>Voci senza costo (solo ricavo): {result.senza_costo}</li>
            </ul>
            <DialogFooter>
              <Button onClick={onClose}>Chiudi</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function ChangeModeDialog({ open, onClose, commessaId, currentMode, vociAttiveCount, summaryUpdatedAt, onDone }: any) {
  const fn = useServerFn(setCommessaBudgetMode);
  const target: "manuale" | "analitico" = currentMode === "manuale" ? "analitico" : "manuale";
  const [mot, setMot] = useState("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsMot = target === "manuale";
  const needsConfirm = target === "analitico" && vociAttiveCount === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (needsMot && !mot.trim()) { setErr("Motivazione obbligatoria"); return; }
    if (needsConfirm && !confirmEmpty) { setErr("Conferma obbligatoria per passare ad analitico senza voci"); return; }
    setBusy(true);
    try {
      await fn({ data: {
        commessa_id: commessaId, mode: target, expected_updated_at: summaryUpdatedAt,
        motivazione: mot || null, confirm_empty: confirmEmpty,
      } });
      toast.success(`Modalità impostata: ${target}`); onDone(); onClose();
    } catch (e: any) {
      setErr(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore"));
      if (isConflict(e)) onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cambio modalità budget → {target}</DialogTitle>
          <DialogDescription>
            {target === "analitico"
              ? "Gli aggregati saranno derivati dalle voci. I valori attuali potrebbero cambiare dopo il ricalcolo."
              : "Gli aggregati correnti verranno preservati; le voci non verranno eliminate."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div className="text-xs text-muted-foreground">Voci attive attuali: <span className="font-semibold">{vociAttiveCount}</span></div>
          {needsConfirm && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 space-y-2">
              <div className="flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5" />Nessuna voce presente: passando ad analitico gli aggregati verranno azzerati fino a inserimento voci.</div>
              <label className="flex items-center gap-2">
                <Checkbox checked={confirmEmpty} onCheckedChange={(v) => setConfirmEmpty(!!v)} />
                Confermo il passaggio con budget vuoto
              </label>
            </div>
          )}
          {needsMot && (
            <div>
              <Label>Motivazione *</Label>
              <Textarea rows={3} value={mot} onChange={(e) => setMot(e.target.value)} required />
            </div>
          )}
          {err && <div className="text-sm text-destructive">{err}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button type="submit" disabled={busy}>Conferma</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function ManualBudgetDialog({ open, onClose, commessaId, summary, onDone }: any) {
  const fn = useServerFn(updateManualCommessaBudget);
  const [f, setF] = useState<any>({
    ricavi_previsti: summary?.ricavi_previsti ?? 0,
    ricavi_acquisiti: summary?.ricavi_acquisiti ?? "",
    extra_approvati: summary?.extra_approvati ?? 0,
    extra_non_approvati: summary?.extra_non_approvati ?? 0,
    costi_previsti: summary?.costi_previsti ?? 0,
    costi_impegnati: summary?.costi_impegnati ?? 0,
    costi_sostenuti: summary?.costi_sostenuti ?? 0,
    costi_residui_stimati: summary?.costi_residui_stimati ?? 0,
    motivazione: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nOr0 = (v: any) => (v === "" || v === null || v === undefined ? 0 : Number(v));
  const nOrNull = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));

  const needsMot =
    nOr0(f.costi_previsti) > Number(summary?.costi_previsti ?? 0) ||
    nOr0(f.costi_impegnati) > Number(summary?.costi_impegnati ?? 0) ||
    nOr0(f.costi_sostenuti) > Number(summary?.costi_sostenuti ?? 0) ||
    (summary?.ricavi_acquisiti != null && nOrNull(f.ricavi_acquisiti) != null && Number(f.ricavi_acquisiti) < Number(summary.ricavi_acquisiti));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (needsMot && !f.motivazione.trim()) { setErr("Motivazione obbligatoria per queste modifiche"); return; }
    setBusy(true);
    try {
      await fn({ data: {
        commessa_id: commessaId,
        expected_updated_at: summary?.updated_at,
        ricavi_previsti: nOr0(f.ricavi_previsti),
        ricavi_acquisiti: nOrNull(f.ricavi_acquisiti),
        extra_approvati: nOr0(f.extra_approvati),
        extra_non_approvati: nOr0(f.extra_non_approvati),
        costi_previsti: nOr0(f.costi_previsti),
        costi_impegnati: nOr0(f.costi_impegnati),
        costi_sostenuti: nOr0(f.costi_sostenuti),
        costi_residui_stimati: nOr0(f.costi_residui_stimati),
        motivazione: f.motivazione || null,
      } });
      toast.success("Budget aggiornato"); onDone(); onClose();
    } catch (e: any) {
      setErr(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore"));
      if (isConflict(e)) onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Aggiorna budget manuale</DialogTitle>
          <DialogDescription>Gli aggregati derivati (margini, scostamenti) vengono calcolati dal server.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            {[
              ["ricavi_previsti", "Ricavi previsti"],
              ["ricavi_acquisiti", "Ricavi acquisiti (nullable)"],
              ["extra_approvati", "Extra approvati"],
              ["extra_non_approvati", "Extra non approvati"],
              ["costi_previsti", "Costi previsti"],
              ["costi_impegnati", "Costi impegnati"],
              ["costi_sostenuti", "Costi sostenuti"],
              ["costi_residui_stimati", "Costi residui stimati"],
            ].map(([k, l]) => (
              <div key={k}>
                <Label>{l}</Label>
                <Input type="number" step="0.01" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div>
            <Label>Motivazione{needsMot && " *"}</Label>
            <Textarea rows={2} value={f.motivazione} onChange={(e) => setF({ ...f, motivazione: e.target.value })} required={needsMot} />
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button type="submit" disabled={busy}>Salva</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function BaselineCard({ s, canBaseline, onOpen }: any) {
  const hasBaseline = !!s?.baseline_created_at;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 font-semibold text-sm"><BookmarkPlus className="h-4 w-4" />Baseline economica</div>
          {canBaseline && (
            <Button size="sm" variant="outline" onClick={onOpen}>
              {hasBaseline ? "Sostituisci baseline" : "Imposta baseline"}
            </Button>
          )}
        </div>
        {hasBaseline ? (
          <dl className="grid grid-cols-4 gap-x-4 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Ricavi</dt><dd>{displayEur(s.baseline_ricavi)}</dd>
            <dt className="text-muted-foreground">Costi</dt><dd>{displayEur(s.baseline_costi)}</dd>
            <dt className="text-muted-foreground">Margine</dt><dd>{displayEur(s.baseline_margine)}</dd>
            <dt className="text-muted-foreground">Data</dt><dd>{dateIt(s.baseline_created_at)}</dd>
          </dl>
        ) : (
          <div className="text-xs text-muted-foreground flex items-center gap-2"><Info className="h-3 w-3" />Nessuna baseline impostata.</div>
        )}
      </CardContent>
    </Card>
  );
}

function BaselineDialog({ open, onClose, commessaId, summary, onDone }: any) {
  const fn = useServerFn(setCommessaBaseline);
  const hasBaseline = !!summary?.baseline_created_at;
  const [mot, setMot] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!mot.trim()) { setErr("Motivazione obbligatoria"); return; }
    if (hasBaseline && !confirm) { setErr("Conferma la sostituzione della baseline esistente"); return; }
    setBusy(true);
    try {
      await fn({ data: {
        commessa_id: commessaId, expected_updated_at: summary?.updated_at,
        motivazione: mot, replace: hasBaseline,
      } });
      toast.success(hasBaseline ? "Baseline sostituita" : "Baseline impostata");
      onDone(); onClose();
    } catch (e: any) {
      setErr(isConflict(e) ? CONFLICT_MSG : (e.message ?? "Errore"));
      if (isConflict(e)) onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{hasBaseline ? "Sostituisci baseline" : "Imposta baseline"}</DialogTitle>
          <DialogDescription>La baseline non verrà aggiornata automaticamente in seguito.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-sm">
          {hasBaseline && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(!!v)} />
              Confermo di voler sostituire la baseline esistente
            </label>
          )}
          <div>
            <Label>Motivazione *</Label>
            <Textarea rows={3} value={mot} onChange={(e) => setMot(e.target.value)} required />
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button type="submit" disabled={busy}>{hasBaseline ? "Sostituisci" : "Imposta"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
