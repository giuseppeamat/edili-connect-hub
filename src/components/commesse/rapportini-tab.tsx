import { useState } from "react";
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
  const [selCommessa, setSelCommessa] = useState<string | undefined>(commessaId ?? undefined);
  const [cantiereId, setCantiereId] = useState<string | undefined>();
  const [faseId, setFaseId] = useState<string | undefined>();
  const [oreValue, setOreValue] = useState<string>("");
  const [overrideOre, setOverrideOre] = useState(false);
  const [overrideMotivo, setOverrideMotivo] = useState("");

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

  const oreNum = Number(oreValue.replace(",", "."));
  const needsOverride = !isNaN(oreNum) && oreNum > 16;

  const create = useMutation({
    mutationFn: async (payload: any) => await createFn({ data: payload }),
    onSuccess: () => {
      toast.success("Rapportino creato");
      qc.invalidateQueries({ queryKey: rapportiniKeys.all });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {
      commessa_id: selCommessa,
      user_id: user.userId,
      data: String(fd.get("data") || ""),
      ore: Number(String(fd.get("ore") || "0").replace(",", ".")),
      descrizione_lavori: String(fd.get("descrizione_lavori") || "").trim(),
      cantiere_id: cantiereId ?? null,
      fase_id: faseId ?? null,
      ora_inizio: (fd.get("ora_inizio") as string) || null,
      ora_fine: (fd.get("ora_fine") as string) || null,
      pausa_minuti: Number(fd.get("pausa_minuti") || 0),
      note: (fd.get("note") as string) || null,
      override_ore: needsOverride ? overrideOre : false,
      override_motivo: needsOverride && overrideOre ? overrideMotivo : null,
    };
    if (!payload.commessa_id) { toast.error("Seleziona una commessa"); return; }
    if (!payload.descrizione_lavori) { toast.error("Descrizione lavori obbligatoria"); return; }
    create.mutate(payload);
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Nuovo rapportino</DialogTitle></DialogHeader>
      <form onSubmit={onSubmit} className="space-y-3">
        {allowCommessaSelect ? (
          <div>
            <Label>Commessa *</Label>
            <Select value={selCommessa} onValueChange={(v) => { setSelCommessa(v); setCantiereId(undefined); setFaseId(undefined); }}>
              <SelectTrigger><SelectValue placeholder="Seleziona commessa" /></SelectTrigger>
              <SelectContent>
                {(commesseOptions ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.codice} — {c.denominazione}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div><Label>Data *</Label><Input name="data" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div><Label>Ora inizio</Label><Input name="ora_inizio" type="time" /></div>
          <div><Label>Ora fine</Label><Input name="ora_fine" type="time" /></div>
          <div><Label>Pausa (min)</Label><Input name="pausa_minuti" type="number" min={0} defaultValue={0} /></div>
        </div>
        <div>
          <Label>Ore totali *</Label>
          <Input name="ore" type="number" step="0.25" min={0.25} max={24} required value={oreValue} onChange={(e) => setOreValue(e.target.value)} />
          {needsOverride && (
            <div className="mt-2 space-y-2 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
              <div className="font-medium text-amber-800">Ore oltre 16h/giorno</div>
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
          <Textarea name="descrizione_lavori" required maxLength={2000} placeholder="Descrivi il lavoro svolto…" />
        </div>
        <div>
          <Label>Note</Label>
          <Textarea name="note" maxLength={4000} />
        </div>
        <DialogFooter>
          {onClose && <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>}
          <Button type="submit" disabled={create.isPending}>Salva</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
