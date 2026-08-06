import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Ban } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  listSoggetti,
  getRapportinoSubappalti,
  saveRapportinoSubappalto,
  annullaRapportinoSubappalto,
  listContrattiSubappalto,
} from "@/lib/subappaltatori.functions";
import {
  MODALITA_COMPENSO_LABEL,
  STATO_SUBAPPALTO_LABEL,
  importoSubappalto,
  validaSubappalto,
  type ModalitaCompenso,
} from "@/lib/rapportini-extra";
import { extraKeys, invalidaCostiExtra } from "@/lib/rapportini-extra.keys";

const NONE = "__none__";

type Draft = {
  id: string | null;
  subappaltatore_id: string;
  contratto_id: string;
  lavorazione: string;
  descrizione: string;
  quantita: string;
  unita_misura: string;
  modalita_compenso: ModalitaCompenso;
  importo_unitario: string;
  importo_totale: string;
  note: string;
};

const vuoto = (): Draft => ({
  id: null,
  subappaltatore_id: "",
  contratto_id: NONE,
  lavorazione: "",
  descrizione: "",
  quantita: "",
  unita_misura: "",
  modalita_compenso: "a_corpo",
  importo_unitario: "",
  importo_totale: "",
  note: "",
});

export function SubappaltatoriSection({
  rapportinoId,
  commessaId,
  readOnly,
}: {
  rapportinoId: string;
  commessaId?: string | null;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const canSeeEcon = user.has("proprietario", "amministratore", "amministrazione");

  const listFn = useServerFn(getRapportinoSubappalti);
  const dittaFn = useServerFn(listSoggetti);
  const saveFn = useServerFn(saveRapportinoSubappalto);
  const annullaFn = useServerFn(annullaRapportinoSubappalto);
  const contrattiFn = useServerFn(listContrattiSubappalto);

  const { data: righe = [], isLoading } = useQuery({
    queryKey: extraKeys.subappalti(rapportinoId),
    queryFn: async () => (await listFn({ data: { rapportino_id: rapportinoId } })) as any[],
  });
  const { data: ditte = [] } = useQuery({
    queryKey: extraKeys.fornitori("subappaltatore"),
    queryFn: async () => (await dittaFn({ data: { tipo: "subappaltatore" as const } })) as any[],
  });
  const { data: contratti = [] } = useQuery({
    queryKey: extraKeys.contratti({ commessa_id: commessaId ?? null }),
    enabled: canSeeEcon && !!commessaId,
    queryFn: async () => (await contrattiFn({ data: { commessa_id: commessaId! } })) as any[],
  });

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(vuoto());
  const [annullaTarget, setAnnullaTarget] = useState<any | null>(null);
  const [motivo, setMotivo] = useState("");

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const apriNuovo = () => { setDraft(vuoto()); setOpen(true); };
  const apriModifica = (r: any) => {
    setDraft({
      id: r.id,
      subappaltatore_id: r.subappaltatore_id ?? "",
      contratto_id: r.contratto_id ?? NONE,
      lavorazione: r.lavorazione ?? "",
      descrizione: r.descrizione ?? "",
      quantita: r.quantita != null ? String(r.quantita) : "",
      unita_misura: r.unita_misura ?? "",
      modalita_compenso: (r.modalita_compenso ?? "a_corpo") as ModalitaCompenso,
      importo_unitario: r.importo_unitario != null ? String(r.importo_unitario) : "",
      importo_totale: r.importo_totale != null ? String(r.importo_totale) : "",
      note: r.note ?? "",
    });
    setOpen(true);
  };

  const errore = validaSubappalto({
    subappaltatore_id: draft.subappaltatore_id,
    lavorazione: draft.lavorazione,
    quantita: draft.quantita || null,
    importo_unitario: draft.importo_unitario || null,
    importo_totale: draft.importo_totale || null,
  });
  const anteprima = importoSubappalto({
    quantita: draft.quantita || null,
    importo_unitario: draft.importo_unitario || null,
    importo_totale: draft.importo_totale || null,
  });

  const save = useMutation({
    mutationFn: async () =>
      await saveFn({
        data: {
          rapportino_id: rapportinoId,
          riga: {
            id: draft.id,
            subappaltatore_id: draft.subappaltatore_id,
            contratto_id: draft.contratto_id === NONE ? null : draft.contratto_id,
            lavorazione: draft.lavorazione.trim(),
            descrizione: draft.descrizione.trim() || null,
            quantita: draft.quantita !== "" ? Number(draft.quantita) : null,
            unita_misura: draft.unita_misura.trim() || null,
            modalita_compenso: draft.modalita_compenso,
            importo_unitario: canSeeEcon && draft.importo_unitario !== "" ? Number(draft.importo_unitario) : null,
            importo_totale: canSeeEcon && draft.importo_totale !== "" ? Number(draft.importo_totale) : null,
            note: draft.note.trim() || null,
          },
        },
      }),
    onSuccess: () => {
      toast.success(draft.id ? "Presenza ditta aggiornata" : "Ditta aggiunta al rapportino");
      setOpen(false);
      invalidaCostiExtra(qc, rapportinoId);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const annulla = useMutation({
    mutationFn: async () => await annullaFn({ data: { id: annullaTarget.id, motivo: motivo.trim() } }),
    onSuccess: () => {
      toast.success("Riga annullata");
      setAnnullaTarget(null);
      setMotivo("");
      invalidaCostiExtra(qc, rapportinoId);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const attive = (righe as any[]).filter((r) => !r.annullato_at);
  const totale = attive.reduce((s, r) => s + Number(r.importo_congelato ?? 0), 0);

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Subappaltatori</div>
            <div className="text-xs text-muted-foreground">
              {attive.length} ditte in cantiere{canSeeEcon && ` · € ${totale.toFixed(2)}`}
            </div>
          </div>
          {!readOnly && (
            <Button size="sm" onClick={apriNuovo}>
              <Plus className="h-4 w-4 mr-1" /> Aggiungi ditta
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento…</div>
        ) : (righe as any[]).length === 0 ? (
          <div className="text-sm text-muted-foreground">Nessuna ditta esterna in questa giornata.</div>
        ) : (
          <div className="space-y-2">
            {(righe as any[]).map((r) => (
              <div key={r.id} className={`flex flex-wrap items-start justify-between gap-2 border-b pb-2 ${r.annullato_at ? "opacity-60" : ""}`}>
                <div>
                  <div className="text-sm font-medium">{r.subappaltatore_nome ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.lavorazione}
                    {` · ${MODALITA_COMPENSO_LABEL[r.modalita_compenso as ModalitaCompenso] ?? r.modalita_compenso}`}
                    {r.quantita != null && ` · ${Number(r.quantita).toFixed(2)} ${r.unita_misura ?? ""}`}
                    {canSeeEcon && r.importo_congelato != null && ` · € ${Number(r.importo_congelato).toFixed(2)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {STATO_SUBAPPALTO_LABEL[r.stato_contabilizzazione] ?? r.stato_contabilizzazione}
                  </Badge>
                  {!readOnly && !r.annullato_at && (
                    <>
                      <Button size="icon" variant="ghost" aria-label="Modifica riga" onClick={() => apriModifica(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Annulla riga" onClick={() => setAnnullaTarget(r)}>
                        <Ban className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Modifica presenza ditta" : "Aggiungi ditta"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label className="text-xs">Ditta subappaltatrice *</Label>
              <Select value={draft.subappaltatore_id || undefined} onValueChange={(v) => set({ subappaltatore_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona ditta" /></SelectTrigger>
                <SelectContent>
                  {(ditte as any[]).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.ragione_sociale}</SelectItem>
                  ))}
                  {(ditte as any[]).length === 0 && (
                    <SelectItem value={NONE} disabled>Nessuna ditta classificata come subappaltatore</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {canSeeEcon && (contratti as any[]).length > 0 && (
              <div className="md:col-span-2">
                <Label className="text-xs">Contratto</Label>
                <Select value={draft.contratto_id} onValueChange={(v) => set({ contratto_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nessun contratto</SelectItem>
                    {(contratti as any[])
                      .filter((c) => !draft.subappaltatore_id || c.subappaltatore_id === draft.subappaltatore_id)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.oggetto}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="md:col-span-2">
              <Label className="text-xs">Lavorazione *</Label>
              <Input value={draft.lavorazione} maxLength={300} onChange={(e) => set({ lavorazione: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Modalità compenso</Label>
              <Select value={draft.modalita_compenso} onValueChange={(v) => set({ modalita_compenso: v as ModalitaCompenso })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MODALITA_COMPENSO_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Quantità</Label>
                <Input type="number" min="0" step="0.001" value={draft.quantita} onChange={(e) => set({ quantita: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">U.M.</Label>
                <Input value={draft.unita_misura} maxLength={20} onChange={(e) => set({ unita_misura: e.target.value })} />
              </div>
            </div>
            {canSeeEcon && (
              <>
                <div>
                  <Label className="text-xs">Importo unitario</Label>
                  <Input type="number" min="0" step="0.01" value={draft.importo_unitario} onChange={(e) => set({ importo_unitario: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Importo totale</Label>
                  <Input type="number" min="0" step="0.01" value={draft.importo_totale} onChange={(e) => set({ importo_totale: e.target.value })} />
                </div>
                <div className="md:col-span-2 text-sm">
                  Importo che verrà congelato:{" "}
                  <strong>{anteprima != null ? `€ ${anteprima.toFixed(2)}` : "non definito"}</strong>
                </div>
              </>
            )}
            <div className="md:col-span-2">
              <Label className="text-xs">Note</Label>
              <Textarea value={draft.note} maxLength={2000} rows={2} onChange={(e) => set({ note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            {errore && <span className="text-xs text-destructive mr-auto">{errore}</span>}
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button disabled={!!errore || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!annullaTarget} onOpenChange={(v) => { if (!v) setAnnullaTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Annulla riga subappalto</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              L'importo congelato non concorrerà più ai costi della commessa. La riga resta nello storico.
            </p>
            <Label>Motivazione *</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnullaTarget(null)}>Chiudi</Button>
            <Button disabled={motivo.trim().length < 3 || annulla.isPending} onClick={() => annulla.mutate()}>
              Conferma annullamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
