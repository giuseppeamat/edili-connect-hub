import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dateIt } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { rapportiniKeys } from "@/lib/rapportini.keys";
import {
  listCommessaRapportini,
  createRapportino,
  archiveRapportino,
  listRapportinoAssignableCantieri,
  listRapportinoAssignableFasi,
} from "@/lib/rapportini.functions";
import { RapportinoActionsMenu, StatoBadge } from "@/components/rapportini/actions-menu";
import { listAssignableMembers } from "@/lib/organization-members.functions";
import { saveRapportinoPersonale } from "@/lib/rapportini-personale.functions";
import { validaRighe, oreAnomale, LIMITE_ORE_PERSONA } from "@/lib/rapportini-personale";
import { TimeSlotSelect, PausaSlotSelect } from "@/components/rapportini/time-slot-select";
import { Trash2 } from "lucide-react";

export type TipoManodopera = "operai" | "subappaltatori" | "misto";

export const TIPO_MANODOPERA_LABEL: Record<TipoManodopera, string> = {
  operai: "Operai interni",
  subappaltatori: "Solo subappaltatori",
  misto: "Operai interni e subappaltatori",
};

function fullName(r: any) {
  if (!r) return "—";
  const s = [r?.nome, r?.cognome].filter(Boolean).join(" ").trim();
  return s || r?.email || "Utente";
}

export function CommessaRapportiniTab({ commessaId, commessaClosed, commessaArchived }: {
  commessaId: string;
  commessaClosed?: boolean;
  commessaArchived?: boolean;
}) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);

  const listFn = useServerFn(listCommessaRapportini);
  const key = rapportiniKeys.byCommessa(commessaId);
  const { data = [] } = useQuery({
    queryKey: key,
    queryFn: async () => await listFn({ data: { commessa_id: commessaId, includeArchived: true } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: rapportiniKeys.all });
  };

  const canCreate = !commessaClosed && !commessaArchived && !!user.userId;
  const rows = data as any[];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 flex justify-between items-center border-b">
          <div className="text-sm text-muted-foreground">Rapportini della commessa ({rows.length})</div>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" />Nuovo rapportino</Button>
              </DialogTrigger>
              <NewRapportinoDialog
                commessaId={commessaId}
                onClose={() => setOpen(false)}
                onCreated={() => { setOpen(false); invalidate(); }}
              />
            </Dialog>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Data</th>
              <th className="text-left p-3">Autore</th>
              <th className="text-left p-3">Cantiere</th>
              <th className="text-left p-3">Fase</th>
              <th className="text-right p-3">Ore</th>
              <th className="text-left p-3">Descrizione</th>
              <th className="text-left p-3">Stato</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowActions key={r.id} row={r} onDone={invalidate} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Nessun rapportino</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function RowActions({ row, onDone }: any) {
  const qc = useQueryClient();
  const [archOpen, setArchOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const archFn = useServerFn(archiveRapportino);
  const isAnomaly = Number(row.ore ?? 0) > 16;
  const arch = useMutation({
    mutationFn: async () => await archFn({ data: { id: row.id, expected_updated_at: row.updated_at, motivazione: motivo.trim() } }),
    onSuccess: () => { toast.success("Rapportino archiviato"); setArchOpen(false); setMotivo(""); qc.invalidateQueries({ queryKey: rapportiniKeys.all }); onDone?.(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <tr
      className={`border-t hover:bg-muted/40 ${row.archived_at ? "opacity-60" : ""}`}
    >
      <td className="p-3">
        <Link
          to="/rapportini/$rapportinoId"
          params={{ rapportinoId: row.id }}
          className="block font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {dateIt(row.data)}
        </Link>
      </td>
      <td className="p-3">
        <Link
          to="/rapportini/$rapportinoId"
          params={{ rapportinoId: row.id }}
          className="block text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {fullName(row.user)}
        </Link>
      </td>
      <td className="p-3 text-xs">{row.cantiere ? `${row.cantiere.codice} — ${row.cantiere.nome}` : "—"}</td>
      <td className="p-3 text-xs">{row.fase?.titolo ?? "—"}</td>
      <td className="p-3 text-right">
        {Number(row.ore ?? 0).toFixed(2)}
        {isAnomaly && <Badge variant="outline" className="ml-2 text-amber-600 border-amber-400">Anomala</Badge>}
      </td>
      <td className="p-3 text-muted-foreground truncate max-w-xs">
        <Link
          to="/rapportini/$rapportinoId"
          params={{ rapportinoId: row.id }}
          className="block truncate text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {row.descrizione_lavori ?? row.lavorazione ?? "—"}
        </Link>
        {row.stato === "respinto" && row.rejection_reason && (
          <div className="text-xs text-rose-700 mt-1">Rifiuto: {row.rejection_reason}</div>
        )}
        {row.stato === "annullato" && row.cancellation_reason && (
          <div className="text-xs text-zinc-600 mt-1">Annullato: {row.cancellation_reason}</div>
        )}
      </td>
      <td className="p-3"><StatoBadge stato={row.stato} archived={!!row.archived_at} /></td>
      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
        <RapportinoActionsMenu row={row} onArchive={() => setArchOpen(true)} />
        <Dialog open={archOpen} onOpenChange={setArchOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Archivia rapportino</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label>Motivazione *</Label>
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo dell'archiviazione…" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setArchOpen(false)}>Chiudi</Button>
              <Button onClick={() => arch.mutate()} disabled={!motivo.trim() || arch.isPending}>Archivia</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}


export function NewRapportinoDialog({ commessaId, onCreated, onClose, allowCommessaSelect, commesseOptions }: {
  commessaId?: string | null;
  commesseOptions?: { id: string; codice: string; denominazione: string }[];
  allowCommessaSelect?: boolean;
  onCreated: () => void;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const createFn = useServerFn(createRapportino);
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const [selCommessa, setSelCommessa] = useState<string | undefined>(commessaId ?? undefined);
  const [cantiereId, setCantiereId] = useState<string | undefined>();
  const [faseId, setFaseId] = useState<string | undefined>();
  const [oreValue, setOreValue] = useState<string>("");
  const [overrideOre, setOverrideOre] = useState(false);
  const [overrideMotivo, setOverrideMotivo] = useState("");
  const [dataValue, setDataValue] = useState<string>(todayIso);
  const [oraInizio, setOraInizio] = useState<string>("");
  const [oraFine, setOraFine] = useState<string>("");
  const [pausaMin, setPausaMin] = useState<string>("0");
  const [descrizione, setDescrizione] = useState<string>("");
  const [noteVal, setNoteVal] = useState<string>("");
  const [personale, setPersonale] = useState<{ membro_id: string; ore: string }[]>([]);
  const [tipoManodopera, setTipoManodopera] = useState<TipoManodopera>("operai");
  const [dataError, setDataError] = useState<string | null>(null);
  const [descError, setDescError] = useState<string | null>(null);
  const [commessaError, setCommessaError] = useState<string | null>(null);

  // Reset completo del form ad ogni apertura del dialog (fix S5B3.6 Fase 2)
  useEffect(() => {
    setSelCommessa(commessaId ?? undefined);
    setCantiereId(undefined);
    setFaseId(undefined);
    setOreValue("");
    setOverrideOre(false);
    setOverrideMotivo("");
    setDataValue(todayIso);
    setOraInizio("");
    setOraFine("");
    setPausaMin("0");
    setDescrizione("");
    setNoteVal("");
    setPersonale([]);
    setTipoManodopera("operai");
    setDataError(null);
    setDescError(null);
    setCommessaError(null);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commessaId]);

  const cantieriFn = useServerFn(listRapportinoAssignableCantieri);
  const fasiFn = useServerFn(listRapportinoAssignableFasi);

  const { data: cantieri = [] } = useQuery({
    queryKey: rapportiniKeys.assignable.cantieri(selCommessa ?? ""),
    queryFn: async () => selCommessa ? await cantieriFn({ data: { commessa_id: selCommessa } }) : [],
    enabled: !!selCommessa,
  });
  const { data: fasi = [] } = useQuery({
    queryKey: rapportiniKeys.assignable.fasi(selCommessa ?? "", cantiereId ?? null),
    queryFn: async () => selCommessa ? await fasiFn({ data: { commessa_id: selCommessa, cantiere_id: cantiereId ?? null } }) : [],
    enabled: !!selCommessa,
  });

  // ── Personale impiegato (autore ≠ lavoratori) ────────────────────────────
  const membriFn = useServerFn(listAssignableMembers);
  const savePersonaleFn = useServerFn(saveRapportinoPersonale);
  const { data: membri = [] } = useQuery({
    queryKey: ["organization-members", "assignable"],
    queryFn: async () => await membriFn(),
  });
  const orePersonale = personale.reduce((s, p) => s + (Number(p.ore) || 0), 0);
  const personaleError = personale.length
    ? validaRighe(personale.map((p) => ({ membro_id: p.membro_id, ore: Number(p.ore) })))
    : null;
  const membriUsati = new Set(personale.map((p) => p.membro_id));

  const oreEffettive = personale.length ? orePersonale : Number(oreValue.replace(",", "."));
  const oreNum = oreEffettive;
  // Anomalia valutata per singola persona: con più operai il totale è naturalmente alto
  const oreMaxPersona = personale.length
    ? Math.max(...personale.map((p) => Number(p.ore) || 0))
    : oreNum;
  const needsOverride = !isNaN(oreMaxPersona) && oreMaxPersona > LIMITE_ORE_PERSONA;

  const create = useMutation({
    mutationFn: async (payload: any) => {
      const res: any = await createFn({ data: payload });
      if (personale.length && res?.id) {
        await savePersonaleFn({
          data: {
            rapportino_id: res.id,
            righe: personale.map((p) => ({ membro_id: p.membro_id, ore: Number(p.ore), nota: null })),
          },
        });
      }
      return res;
    },
    onSuccess: () => {
      toast.success("Rapportino creato");
      qc.invalidateQueries({ queryKey: rapportiniKeys.all });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated();
    },
    onError: (e: any) => {
      const msg = (e?.message ?? "").toString();
      // Map Zod / RPC errors relativi alla data verso l'errore inline
      if (/data futura|non può essere successiva|maxIso|data\b.*(futura|domani|limite)/i.test(msg)) {
        setDataError("La data del rapportino non può essere successiva a domani.");
      }
      toast.error(msg || "Errore imprevisto");
    },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDataError(null); setDescError(null); setCommessaError(null);
    const data = dataValue;
    const descr = descrizione.trim();

    // validazione client (fix S5B3.6 Fase 1)
    let hasError = false;
    if (!selCommessa) { setCommessaError("Seleziona una commessa"); hasError = true; }
    if (!descr) { setDescError("Descrizione lavori obbligatoria"); hasError = true; }
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      setDataError("Inserisci una data valida."); hasError = true;
    } else if (data > tomorrowIso) {
      setDataError("La data del rapportino non può essere successiva a domani."); hasError = true;
    }
    if (personaleError) { toast.error(personaleError); hasError = true; }
    if (hasError) return;

    const payload: any = {
      commessa_id: selCommessa,
      user_id: user.userId,
      data,
      ore: personale.length ? orePersonale : Number(oreValue.replace(",", ".") || "0"),
      descrizione_lavori: descr,
      cantiere_id: cantiereId ?? null,
      fase_id: faseId ?? null,
      ora_inizio: oraInizio || null,
      ora_fine: oraFine || null,
      pausa_minuti: Number(pausaMin || 0),
      note: noteVal || null,
      persone: personale.length || 1,
      override_ore: needsOverride ? overrideOre : false,
      override_motivo: needsOverride && overrideOre ? overrideMotivo : null,
    };
    create.mutate(payload);
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Nuovo rapportino</DialogTitle></DialogHeader>
      <form onSubmit={onSubmit} className="space-y-3">
        {allowCommessaSelect ? (
          <div>
            <Label>Commessa *</Label>
            <Select value={selCommessa} onValueChange={(v) => { setSelCommessa(v); setCantiereId(undefined); setFaseId(undefined); setCommessaError(null); }}>
              <SelectTrigger><SelectValue placeholder="Seleziona commessa" /></SelectTrigger>
              <SelectContent>
                {(commesseOptions ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.codice} — {c.denominazione}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {commessaError && <p className="text-xs text-destructive mt-1">{commessaError}</p>}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Commessa precompilata</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Cantiere</Label>
            <Select value={cantiereId} onValueChange={(v) => { setCantiereId(v === "__none__" ? undefined : v); setFaseId(undefined); }}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nessuno —</SelectItem>
                {(cantieri as any[]).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.codice} — {c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fase</Label>
            <Select value={faseId} onValueChange={(v) => setFaseId(v === "__none__" ? undefined : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nessuna —</SelectItem>
                {(fasi as any[]).map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.titolo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label>Data *</Label>
            <Input type="date" required max={tomorrowIso} value={dataValue} onChange={(e) => { setDataValue(e.target.value); setDataError(null); }} aria-invalid={!!dataError} />
            {dataError && <p className="text-xs text-destructive mt-1">{dataError}</p>}
          </div>
          <div>
            <Label>Ora inizio</Label>
            <TimeSlotSelect value={oraInizio} onChange={setOraInizio} ariaLabel="Ora inizio" />
          </div>
          <div>
            <Label>Ora fine</Label>
            <TimeSlotSelect value={oraFine} onChange={setOraFine} ariaLabel="Ora fine" />
          </div>
          <div>
            <Label>Pausa</Label>
            <PausaSlotSelect value={Number(pausaMin || 0)} onChange={(v) => setPausaMin(String(v))} />
          </div>
        </div>
        <div className="rounded border p-3">
          <Label>Tipo di manodopera *</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Indica chi ha svolto il lavoro: personale interno, ditte in subappalto o entrambi.
          </p>
          <Select value={tipoManodopera} onValueChange={(v) => setTipoManodopera(v as TipoManodopera)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TIPO_MANODOPERA_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tipoManodopera !== "operai" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Le lavorazioni in subappalto si registrano nella scheda “Subappaltatori” del rapportino,
              subito dopo il salvataggio.
            </p>
          )}
        </div>
        {tipoManodopera !== "subappaltatori" && (
        <div className="rounded border p-3">

          <div className="flex items-center justify-between mb-2">
            <div>
              <Label>Personale impiegato</Label>
              <p className="text-xs text-muted-foreground">
                Le ore vengono attribuite alle persone selezionate, non a chi compila il rapportino.
              </p>
            </div>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => setPersonale((p) => [...p, { membro_id: "", ore: "8" }])}
            >
              <Plus className="h-4 w-4 mr-1" /> Aggiungi persona
            </Button>
          </div>
          {personale.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nessuna persona: le ore totali indicate sotto restano sul rapportino e potrai aggiungere il personale dal dettaglio.
            </p>
          ) : (
            <div className="space-y-2">
              {personale.map((p, i) => (
                <div key={`${p.membro_id || "new"}-${i}`} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-7">
                    <Select
                      value={p.membro_id || undefined}
                      onValueChange={(v) => setPersonale((arr) => arr.map((x, j) => (j === i ? { ...x, membro_id: v } : x)))}
                    >
                      <SelectTrigger><SelectValue placeholder="Seleziona persona" /></SelectTrigger>
                      <SelectContent>
                        {(membri as any[])
                          .filter((m) => m.id === p.membro_id || !membriUsati.has(m.id))
                          .map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {[m.nome, m.cognome].filter(Boolean).join(" ")}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Input
                      type="number" step="0.5" min={0.5} max={24} value={p.ore}
                      onChange={(e) => setPersonale((arr) => arr.map((x, j) => (j === i ? { ...x, ore: e.target.value } : x)))}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button" size="icon" variant="ghost" aria-label="Rimuovi persona"
                      onClick={() => setPersonale((arr) => arr.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="text-xs text-muted-foreground">
                Totale personale: {personale.length} persone · {orePersonale.toFixed(2)} ore
              </div>
              {personaleError && <p className="text-xs text-destructive">{personaleError}</p>}
            </div>
          )}
        </div>
        )}
        <div>
          <Label>Ore totali *</Label>
          <Input
            type="number" step="0.5" min={0.5} max={240} required
            value={personale.length ? String(orePersonale) : oreValue}
            readOnly={personale.length > 0}
            onChange={(e) => setOreValue(e.target.value)}
          />
          {personale.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Somma delle ore del personale impiegato ({personale.length} persone).
            </p>
          )}
          {needsOverride && (
            <div className="mt-2 space-y-2 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
              <div className="font-medium text-amber-800">Una persona supera le 16h/giorno</div>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={overrideOre} onChange={(e) => setOverrideOre(e.target.checked)} />
                <span>Richiedo override (solo proprietario/amministratore)</span>
              </label>
              {overrideOre && (
                <Textarea value={overrideMotivo} onChange={(e) => setOverrideMotivo(e.target.value)} placeholder="Motivazione override obbligatoria" />
              )}
            </div>
          )}
        </div>
        <div>
          <Label>Descrizione lavori *</Label>
          <Textarea required maxLength={2000} placeholder="Descrivi il lavoro svolto…" value={descrizione} onChange={(e) => { setDescrizione(e.target.value); setDescError(null); }} aria-invalid={!!descError} />
          {descError && <p className="text-xs text-destructive mt-1">{descError}</p>}
        </div>
        <div>
          <Label>Note</Label>
          <Textarea maxLength={4000} value={noteVal} onChange={(e) => setNoteVal(e.target.value)} />
        </div>

        <DialogFooter>
          {onClose && <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>}
          <Button type="submit" disabled={create.isPending}>Salva</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
