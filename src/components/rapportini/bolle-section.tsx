import { useMemo, useState } from "react";
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
import { Plus, Trash2, Pencil, Ban } from "lucide-react";
import { dateIt } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { listSoggetti } from "@/lib/subappaltatori.functions";
import { listMateriali } from "@/lib/materiali.functions";
import {
  getRapportinoBolle,
  saveRapportinoBolla,
  annullaRapportinoBolla,
} from "@/lib/bolle.functions";
import {
  STATO_BOLLA_LABEL,
  totaliBolla,
  totaleRiga,
  validaRigheBolla,
  validaTestataBolla,
} from "@/lib/rapportini-extra";
import { extraKeys, invalidaCostiExtra } from "@/lib/rapportini-extra.keys";

const NONE = "__none__";

type RigaDraft = {
  materiale_id: string;
  descrizione: string;
  codice_articolo: string;
  quantita: string;
  unita_misura: string;
  prezzo_unitario: string;
  sconto_pct: string;
  iva_pct: string;
};

const rigaVuota = (): RigaDraft => ({
  materiale_id: NONE,
  descrizione: "",
  codice_articolo: "",
  quantita: "1",
  unita_misura: "",
  prezzo_unitario: "",
  sconto_pct: "0",
  iva_pct: "22",
});

export function BolleSection({
  rapportinoId,
  readOnlyBolle,
}: {
  rapportinoId: string;
  readOnlyBolle?: boolean;
}) {

  const qc = useQueryClient();
  const user = useCurrentUser();
  const canSeeEcon = user.has("proprietario", "amministratore", "amministrazione");

  const listFn = useServerFn(getRapportinoBolle);
  const fornFn = useServerFn(listSoggetti);
  const matFn = useServerFn(listMateriali);
  const saveFn = useServerFn(saveRapportinoBolla);
  const annullaFn = useServerFn(annullaRapportinoBolla);

  const { data: bolle = [], isLoading } = useQuery({
    queryKey: extraKeys.bolle(rapportinoId),
    queryFn: async () => (await listFn({ data: { rapportino_id: rapportinoId } })) as any[],
  });
  const { data: fornitori = [] } = useQuery({
    queryKey: extraKeys.fornitori("fornitore"),
    queryFn: async () => (await fornFn({ data: { tipo: "fornitore" as const } })) as any[],
  });
  const { data: materiali = [] } = useQuery({
    queryKey: extraKeys.materiali(),
    queryFn: async () => (await matFn()) as any[],
  });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fornitoreId, setFornitoreId] = useState("");
  const [numero, setNumero] = useState("");
  const [dataBolla, setDataBolla] = useState("");
  const [dataConsegna, setDataConsegna] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<RigaDraft[]>([rigaVuota()]);
  const [annullaTarget, setAnnullaTarget] = useState<any | null>(null);
  const [annullaMotivo, setAnnullaMotivo] = useState("");

  const apriNuova = () => {
    setEditId(null);
    setFornitoreId("");
    setNumero("");
    setDataBolla(new Date().toISOString().slice(0, 10));
    setDataConsegna("");
    setNote("");
    setRighe([rigaVuota()]);
    setOpen(true);
  };

  const apriModifica = (b: any) => {
    setEditId(b.id);
    setFornitoreId(b.fornitore_id ?? "");
    setNumero(b.numero_bolla ?? "");
    setDataBolla(b.data_bolla ?? "");
    setDataConsegna(b.data_consegna ?? "");
    setNote(b.note ?? "");
    setRighe(
      (b.righe ?? []).map((r: any) => ({
        materiale_id: r.materiale_id ?? NONE,
        descrizione: r.descrizione ?? "",
        codice_articolo: r.codice_articolo ?? "",
        quantita: String(r.quantita ?? ""),
        unita_misura: r.unita_misura ?? "",
        prezzo_unitario: r.prezzo_unitario != null ? String(r.prezzo_unitario) : "",
        sconto_pct: String(r.sconto_pct ?? 0),
        iva_pct: r.iva_pct != null ? String(r.iva_pct) : "",
      })),
    );
    if (!(b.righe ?? []).length) setRighe([rigaVuota()]);
    setOpen(true);
  };

  const totali = useMemo(() => totaliBolla(righe), [righe]);
  const errore =
    validaTestataBolla({ fornitore_id: fornitoreId, numero_bolla: numero, data_bolla: dataBolla }) ??
    validaRigheBolla(righe);

  const save = useMutation({
    mutationFn: async () =>
      await saveFn({
        data: {
          rapportino_id: rapportinoId,
          bolla: {
            id: editId,
            fornitore_id: fornitoreId,
            numero_bolla: numero.trim(),
            data_bolla: dataBolla,
            data_consegna: dataConsegna || null,
            note: note.trim() || null,
          },
          righe: righe.map((r) => ({
            materiale_id: r.materiale_id === NONE ? null : r.materiale_id,
            descrizione: r.descrizione.trim(),
            codice_articolo: r.codice_articolo.trim() || null,
            quantita: Number(r.quantita),
            unita_misura: r.unita_misura.trim() || null,
            prezzo_unitario: canSeeEcon && r.prezzo_unitario !== "" ? Number(r.prezzo_unitario) : null,
            sconto_pct: r.sconto_pct !== "" ? Number(r.sconto_pct) : 0,
            iva_pct: r.iva_pct !== "" ? Number(r.iva_pct) : null,
          })),
        },
      }),
    onSuccess: () => {
      toast.success(editId ? "Bolla aggiornata" : "Bolla registrata");
      setOpen(false);
      invalidaCostiExtra(qc, rapportinoId);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const annulla = useMutation({
    mutationFn: async () =>
      await annullaFn({ data: { id: annullaTarget.id, motivo: annullaMotivo.trim() } }),
    onSuccess: () => {
      toast.success("Bolla annullata");
      setAnnullaTarget(null);
      setAnnullaMotivo("");
      invalidaCostiExtra(qc, rapportinoId);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totaleMateriali = (bolle as any[])
    .filter((b) => b.stato !== "annullata")
    .reduce((s, b) => s + Number(b.imponibile ?? 0), 0);

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Bolle e materiali</div>
            <div className="text-xs text-muted-foreground">
              {(bolle as any[]).length} bolle
              {canSeeEcon && ` · € ${totaleMateriali.toFixed(2)} di materiali`}
            </div>
          </div>
          {!readOnly && (
            <Button size="sm" onClick={apriNuova}>
              <Plus className="h-4 w-4 mr-1" /> Nuova bolla
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Caricamento…</div>
        ) : (bolle as any[]).length === 0 ? (
          <div className="text-sm text-muted-foreground">Nessuna bolla registrata in questa giornata.</div>
        ) : (
          <div className="space-y-3">
            {(bolle as any[]).map((b) => (
              <div key={b.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">
                      {b.fornitore_nome ?? "—"} · n. {b.numero_bolla}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {dateIt(b.data_bolla)}
                      {b.data_consegna ? ` · consegna ${dateIt(b.data_consegna)}` : ""}
                      {` · ${(b.righe ?? []).length} righe`}
                      {canSeeEcon && b.imponibile != null && ` · € ${Number(b.imponibile).toFixed(2)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{STATO_BOLLA_LABEL[b.stato] ?? b.stato}</Badge>
                    {!readOnly && b.stato !== "annullata" && (
                      <>
                        <Button size="icon" variant="ghost" aria-label="Modifica bolla" onClick={() => apriModifica(b)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label="Annulla bolla" onClick={() => setAnnullaTarget(b)}>
                          <Ban className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  {(b.righe ?? []).map((r: any) => (
                    <div key={r.id} className="flex justify-between gap-2 border-b py-1 last:border-0">
                      <span className="truncate">
                        {r.descrizione}
                        {r.unita_misura ? ` · ${r.unita_misura}` : ""}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {Number(r.quantita).toFixed(2)}
                        {canSeeEcon && r.totale_riga != null && ` · € ${Number(r.totale_riga).toFixed(2)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Modifica bolla" : "Nuova bolla"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label className="text-xs">Fornitore *</Label>
              <Select value={fornitoreId || undefined} onValueChange={setFornitoreId}>
                <SelectTrigger><SelectValue placeholder="Seleziona fornitore" /></SelectTrigger>
                <SelectContent>
                  {(fornitori as any[]).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.ragione_sociale}</SelectItem>
                  ))}
                  {(fornitori as any[]).length === 0 && (
                    <SelectItem value={NONE} disabled>Nessun fornitore in anagrafica</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Numero bolla *</Label>
              <Input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={100} />
            </div>
            <div>
              <Label className="text-xs">Data bolla *</Label>
              <Input type="date" value={dataBolla} onChange={(e) => setDataBolla(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Data consegna</Label>
              <Input type="date" value={dataConsegna} onChange={(e) => setDataConsegna(e.target.value)} />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </div>
          </div>

          <div className="mt-2 space-y-2">
            {righe.map((r, i) => (
              <div key={i} className="grid gap-2 md:grid-cols-12 items-end border-b pb-2">
                <div className="md:col-span-3">
                  <Label className="text-xs">Materiale</Label>
                  <Select
                    value={r.materiale_id}
                    onValueChange={(v) =>
                      setRighe((arr) =>
                        arr.map((x, j) => {
                          if (j !== i) return x;
                          const m = (materiali as any[]).find((mm) => mm.id === v);
                          return {
                            ...x,
                            materiale_id: v,
                            descrizione: x.descrizione || (m?.nome ?? ""),
                            unita_misura: x.unita_misura || (m?.unita_misura_predefinita ?? ""),
                          };
                        }),
                      )
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="Libero" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Descrizione libera</SelectItem>
                      {(materiali as any[]).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-3">
                  <Label className="text-xs">Descrizione *</Label>
                  <Input
                    value={r.descrizione}
                    onChange={(e) => setRighe((arr) => arr.map((x, j) => (j === i ? { ...x, descrizione: e.target.value } : x)))}
                  />
                </div>
                <div className="md:col-span-1">
                  <Label className="text-xs">Q.tà *</Label>
                  <Input
                    type="number" min="0" step="0.001" value={r.quantita}
                    onChange={(e) => setRighe((arr) => arr.map((x, j) => (j === i ? { ...x, quantita: e.target.value } : x)))}
                  />
                </div>
                <div className="md:col-span-1">
                  <Label className="text-xs">U.M.</Label>
                  <Input
                    value={r.unita_misura} maxLength={20}
                    onChange={(e) => setRighe((arr) => arr.map((x, j) => (j === i ? { ...x, unita_misura: e.target.value } : x)))}
                  />
                </div>
                {canSeeEcon && (
                  <>
                    <div className="md:col-span-1">
                      <Label className="text-xs">Prezzo</Label>
                      <Input
                        type="number" min="0" step="0.0001" value={r.prezzo_unitario}
                        onChange={(e) => setRighe((arr) => arr.map((x, j) => (j === i ? { ...x, prezzo_unitario: e.target.value } : x)))}
                      />
                    </div>
                    <div className="md:col-span-1">
                      <Label className="text-xs">Sc. %</Label>
                      <Input
                        type="number" min="0" max="100" step="0.1" value={r.sconto_pct}
                        onChange={(e) => setRighe((arr) => arr.map((x, j) => (j === i ? { ...x, sconto_pct: e.target.value } : x)))}
                      />
                    </div>
                    <div className="md:col-span-1">
                      <Label className="text-xs">IVA %</Label>
                      <Input
                        type="number" min="0" max="100" step="0.1" value={r.iva_pct}
                        onChange={(e) => setRighe((arr) => arr.map((x, j) => (j === i ? { ...x, iva_pct: e.target.value } : x)))}
                      />
                    </div>
                    <div className="md:col-span-1 text-xs text-muted-foreground">
                      {totaleRiga(r) != null ? `€ ${totaleRiga(r)!.toFixed(2)}` : "—"}
                    </div>
                  </>
                )}
                <div className="md:col-span-1 flex justify-end">
                  <Button
                    size="icon" variant="ghost" aria-label="Rimuovi riga"
                    onClick={() => setRighe((arr) => (arr.length === 1 ? arr : arr.filter((_, j) => j !== i)))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setRighe((a) => [...a, rigaVuota()])}>
              <Plus className="h-4 w-4 mr-1" /> Aggiungi riga
            </Button>
          </div>

          {canSeeEcon && (
            <div className="mt-3 text-sm">
              Imponibile <strong>€ {totali.imponibile.toFixed(2)}</strong> · IVA € {totali.iva.toFixed(2)} ·
              Totale <strong>€ {totali.totale.toFixed(2)}</strong>
            </div>
          )}

          <DialogFooter>
            {errore && <span className="text-xs text-destructive mr-auto">{errore}</span>}
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button disabled={!!errore || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Salvataggio…" : "Salva bolla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!annullaTarget} onOpenChange={(v) => { if (!v) setAnnullaTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Annulla bolla</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              La bolla resta nello storico ma non concorre più ai costi della commessa.
            </p>
            <Label>Motivazione *</Label>
            <Textarea value={annullaMotivo} onChange={(e) => setAnnullaMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnullaTarget(null)}>Chiudi</Button>
            <Button
              disabled={annullaMotivo.trim().length < 3 || annulla.isPending}
              onClick={() => annulla.mutate()}
            >
              Conferma annullamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
