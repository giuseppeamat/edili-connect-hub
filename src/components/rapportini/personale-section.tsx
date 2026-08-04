import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { listAssignableMembers } from "@/lib/organization-members.functions";
import {
  getRapportinoPersonale,
  saveRapportinoPersonale,
  ricalcolaRighePersonaleMancanti,
} from "@/lib/rapportini-personale.functions";
import {
  STATO_PERSONALE_LABEL,
  totaliPersonale,
  validaRighe,
  righeRicalcolabili,
  type RigaPersonale,
  type StatoContabilizzazione,
} from "@/lib/rapportini-personale";
import { rapportiniKeys } from "@/lib/rapportini.keys";

const STATO_VARIANT: Record<StatoContabilizzazione, string> = {
  da_contabilizzare: "text-muted-foreground border-muted-foreground/40",
  contabilizzato: "text-emerald-700 border-emerald-400",
  tariffa_mancante: "text-amber-700 border-amber-400",
  conflitto_tariffa: "text-rose-700 border-rose-400",
  annullato: "text-zinc-500 border-zinc-300",
};

type Draft = { membro_id: string; ore: string; nota: string };

export function PersonaleSection({
  rapportinoId,
  readOnly,
}: {
  rapportinoId: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(getRapportinoPersonale);
  const membriFn = useServerFn(listAssignableMembers);
  const saveFn = useServerFn(saveRapportinoPersonale);
  const recalcFn = useServerFn(ricalcolaRighePersonaleMancanti);

  const personaleKey = [...rapportiniKeys.detail(rapportinoId), "personale"] as const;

  const { data: righe = [], isLoading } = useQuery({
    queryKey: personaleKey,
    queryFn: async () => (await listFn({ data: { rapportino_id: rapportinoId } })) as RigaPersonale[],
  });

  const { data: membri = [] } = useQuery({
    queryKey: ["organization-members", "assignable"],
    queryFn: async () => await membriFn(),
  });

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [anteprima, setAnteprima] = useState<any[] | null>(null);
  const [confermaRicalcolo, setConfermaRicalcolo] = useState<{ righe: Draft[] } | null>(null);

  const attive = useMemo(
    () => (righe as RigaPersonale[]).filter((r) => !r.annullato_at && r.stato_contabilizzazione !== "annullato"),
    [righe],
  );

  useEffect(() => {
    if (dirty) return;
    setDrafts(
      attive.map((r) => ({ membro_id: r.membro_id, ore: String(Number(r.ore ?? 0)), nota: r.nota ?? "" })),
    );
  }, [attive, dirty]);

  const canSeeCosts = (righe as any[])[0]?.can_see_costs === true;
  const totali = totaliPersonale(righe as RigaPersonale[]);

  /** I costi personale alimentano rapportino, commessa, budget e dashboard. */
  const invalidaAggregati = () => {
    qc.invalidateQueries({ queryKey: personaleKey });
    qc.invalidateQueries({ queryKey: rapportiniKeys.all });
    qc.invalidateQueries({ queryKey: ["rapportino", rapportinoId, "costi"] });
    qc.invalidateQueries({ queryKey: ["commesse-board"] });
    qc.invalidateQueries({ queryKey: ["commessa-detail"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["commessa-budget-summary"] });
    qc.invalidateQueries({ queryKey: ["commessa-budget-voci"] });
  };


  const save = useMutation({
    mutationFn: async (allowRecalc: boolean) =>
      await saveFn({
        data: {
          rapportino_id: rapportinoId,
          allow_recalc: allowRecalc,
          righe: drafts.map((d) => ({
            membro_id: d.membro_id,
            ore: Number(d.ore),
            nota: d.nota.trim() ? d.nota.trim() : null,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Personale del rapportino aggiornato");
      setDirty(false);
      setConfermaRicalcolo(null);
      invalidaAggregati();
    },
    onError: (e: any) => {
      if (String(e?.message ?? "").includes("ricalcolo controllato")) {
        setConfermaRicalcolo({ righe: drafts });
        return;
      }
      toast.error(e.message);
    },
  });

  const recalc = useMutation({
    mutationFn: async (dryRun: boolean) =>
      await recalcFn({ data: { dry_run: dryRun, rapportino_id: rapportinoId } }),
    onSuccess: (rows: any, dryRun) => {
      setAnteprima(rows ?? []);
      if (!dryRun) {
        toast.success("Ricalcolo eseguito");
        invalidaAggregati();
      }
    },
    onError: (e: any) => toast.error(e.message),
  });


  const membriUsati = new Set(drafts.map((d) => d.membro_id));
  const errore = drafts.length ? validaRighe(drafts.map((d) => ({ membro_id: d.membro_id, ore: Number(d.ore) }))) : null;
  const ricalcolabili = righeRicalcolabili(righe as RigaPersonale[]);

  const nomeMembro = (id: string) => {
    const m = (membri as any[]).find((x) => x.id === id);
    return m ? [m.nome, m.cognome].filter(Boolean).join(" ") : "—";
  };

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Personale impiegato</div>
            <div className="text-xs text-muted-foreground">
              {totali.persone} persone · {totali.ore_totali.toFixed(2)} ore
              {canSeeCosts && ` · € ${totali.costo_totale.toFixed(2)}`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSeeCosts && ricalcolabili.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRecalcOpen(true);
                  setAnteprima(null);
                  recalc.mutate(true);
                }}
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Ricalcola costi mancanti
              </Button>
            )}
            {!readOnly && (
              <Button
                size="sm"
                onClick={() => {
                  setDirty(true);
                  setDrafts((d) => [...d, { membro_id: "", ore: "8", nota: "" }]);
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Aggiungi persona
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento…</div>
        ) : drafts.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nessuna persona associata a questo rapportino.
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((d, i) => {
              const riga = attive.find((r) => r.membro_id === d.membro_id);
              return (
                <div key={`${d.membro_id || "new"}-${i}`} className="grid gap-2 md:grid-cols-12 items-end border-b pb-2">
                  <div className="md:col-span-4">
                    <Label className="text-xs">Persona</Label>
                    <Select
                      value={d.membro_id || undefined}
                      disabled={readOnly}
                      onValueChange={(v) => {
                        setDirty(true);
                        setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, membro_id: v } : x)));
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Seleziona persona" /></SelectTrigger>
                      <SelectContent>
                        {(membri as any[])
                          .filter((m) => m.id === d.membro_id || !membriUsati.has(m.id))
                          .map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {[m.nome, m.cognome].filter(Boolean).join(" ")}
                            </SelectItem>
                          ))}
                        {(membri as any[]).length === 0 && (
                          <SelectItem value="__none__" disabled>Nessun membro disponibile</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Ore</Label>
                    <Input
                      type="number" min="0.25" max="24" step="0.25" value={d.ore} disabled={readOnly}
                      onChange={(e) => {
                        setDirty(true);
                        setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, ore: e.target.value } : x)));
                      }}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Label className="text-xs">Nota</Label>
                    <Input
                      value={d.nota} disabled={readOnly} maxLength={500}
                      onChange={(e) => {
                        setDirty(true);
                        setDrafts((arr) => arr.map((x, j) => (j === i ? { ...x, nota: e.target.value } : x)));
                      }}
                    />
                  </div>
                  <div className="md:col-span-2 text-xs">
                    <div className="mb-1">
                      <Badge variant="outline" className={STATO_VARIANT[riga?.stato_contabilizzazione ?? "da_contabilizzare"]}>
                        {STATO_PERSONALE_LABEL[riga?.stato_contabilizzazione ?? "da_contabilizzare"]}
                      </Badge>
                    </div>
                    {canSeeCosts && riga?.costo_congelato != null && (
                      <div className="text-muted-foreground">
                        € {Number(riga.tariffa_oraria_congelata ?? 0).toFixed(2)}/h · <strong>€ {Number(riga.costo_congelato).toFixed(2)}</strong>
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-1 flex justify-end">
                    {!readOnly && (
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => { setDirty(true); setDrafts((arr) => arr.filter((_, j) => j !== i)); }}
                        aria-label="Rimuovi persona"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!readOnly && dirty && (
          <div className="mt-3 flex items-center gap-3">
            <Button disabled={!!errore || save.isPending} onClick={() => save.mutate(false)}>
              {save.isPending ? "Salvataggio…" : "Salva personale"}
            </Button>
            <Button variant="ghost" onClick={() => setDirty(false)}>Annulla modifiche</Button>
            {errore && <span className="text-xs text-destructive">{errore}</span>}
          </div>
        )}

        {canSeeCosts && (totali.tariffa_mancante > 0 || totali.conflitto_tariffa > 0) && (
          <div className="mt-3 text-xs text-amber-700">
            {totali.tariffa_mancante} righe senza tariffa · {totali.conflitto_tariffa} con conflitto tariffa
          </div>
        )}
      </CardContent>

      <Dialog open={recalcOpen} onOpenChange={setRecalcOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ricalcola costi mancanti</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            {anteprima === null ? (
              <div className="text-muted-foreground">Calcolo anteprima…</div>
            ) : anteprima.length === 0 ? (
              <div className="text-muted-foreground">Nessuna riga da ricalcolare.</div>
            ) : (
              anteprima.map((p) => (
                <div key={p.riga_id} className="flex justify-between border-b py-1">
                  <span>{p.membro_nome} · {Number(p.ore).toFixed(2)} h</span>
                  <span>
                    {p.costo != null ? `€ ${Number(p.costo).toFixed(2)}` : "—"}{" "}
                    <Badge variant="outline">{p.esito}</Badge>
                  </span>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecalcOpen(false)}>Chiudi</Button>
            <Button
              disabled={!anteprima?.some((p) => p.esito === "contabilizzabile") || recalc.isPending}
              onClick={() => recalc.mutate(false)}
            >
              Conferma ricalcolo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confermaRicalcolo} onOpenChange={(v) => { if (!v) setConfermaRicalcolo(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ricalcolo controllato delle ore</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Alcune righe sono già contabilizzate con un costo congelato. Confermando, il costo precedente viene
              stornato e ricalcolato con la tariffa valida alla data del rapportino. L'operazione è registrata nel
              registro attività.
            </p>
            {attive
              .filter((r) => r.stato_contabilizzazione === "contabilizzato")
              .map((r) => {
                const d = drafts.find((x) => x.membro_id === r.membro_id);
                return (
                  <div key={r.id} className="flex justify-between border-b py-1">
                    <span>{r.membro_nome || nomeMembro(r.membro_id)}</span>
                    <span>{Number(r.ore).toFixed(2)} h → {Number(d?.ore ?? r.ore).toFixed(2)} h</span>
                  </div>
                );
              })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfermaRicalcolo(null)}>Annulla</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(true)}>Conferma ricalcolo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
