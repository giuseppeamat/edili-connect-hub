import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { DOCUMENTI_BUCKET, validateFile } from "@/lib/documenti-model";
import { prepareDocumentoUpload, finalizeDocumentoUpload } from "@/lib/documenti.functions";
import { listSoggetti } from "@/lib/subappaltatori.functions";
import { listMateriali } from "@/lib/materiali.functions";
import {
  saveBolla,
  getBolla,
  checkBolleDuplicati,
  listBollaOpzioni,
} from "@/lib/bolle.functions";
import { extraKeys, invalidaArchivioBolle } from "@/lib/rapportini-extra.keys";
import { totaliBolla, validaRigheBolla } from "@/lib/rapportini-extra";
import { classificaDuplicati, MSG_DUPLICATO, validaTestataArchivio } from "@/lib/bolle-archivio";
import type { EsitoEstrazione } from "@/lib/bolle-estrazione.functions";
import { LABEL_CONFIDENZA, livelloConfidenza, rigaCoerente } from "@/lib/bolle-estrazione";
import { dateIt, eur } from "@/lib/format";

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

export function BollaFormDialog({
  open,
  onOpenChange,
  bollaId,
  canSeeEcon,
  estrazione,
  preset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bollaId?: string | null;
  canSeeEcon: boolean;
  /** Dati proposti dalla lettura automatica del PDF (schermata di verifica). */
  estrazione?: { esito: EsitoEstrazione; file: File } | null;
  /** Contesto già noto (es. apertura dal rapportino). */
  preset?: { rapportino_id?: string | null; commessa_id?: string | null; cantiere_id?: string | null };
}) {
  const qc = useQueryClient();
  const isEdit = !!bollaId;

  const fornFn = useServerFn(listSoggetti);
  const matFn = useServerFn(listMateriali);
  const optFn = useServerFn(listBollaOpzioni);
  const saveFn = useServerFn(saveBolla);
  const detailFn = useServerFn(getBolla);
  const dupFn = useServerFn(checkBolleDuplicati);
  const prepare = useServerFn(prepareDocumentoUpload);
  const finalize = useServerFn(finalizeDocumentoUpload);

  const [fornitoreId, setFornitoreId] = useState("");
  const [numero, setNumero] = useState("");
  const [dataBolla, setDataBolla] = useState(new Date().toISOString().slice(0, 10));
  const [dataConsegna, setDataConsegna] = useState("");
  const [commessaId, setCommessaId] = useState(NONE);
  const [cantiereId, setCantiereId] = useState(NONE);
  const [rapportinoId, setRapportinoId] = useState(NONE);
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<RigaDraft[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [documentoId, setDocumentoId] = useState<string | null>(null);
  const [forzaDuplicato, setForzaDuplicato] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: fornitori = [] } = useQuery({
    queryKey: extraKeys.fornitori("fornitore"),
    enabled: open,
    queryFn: async () => (await fornFn({ data: { tipo: "fornitore" as const } })) as any[],
  });
  const { data: materiali = [] } = useQuery({
    queryKey: extraKeys.materiali(),
    enabled: open,
    queryFn: async () => (await matFn()) as any[],
  });
  const { data: opzioni } = useQuery({
    queryKey: extraKeys.opzioni(commessaId === NONE ? null : commessaId, null),
    enabled: open,
    queryFn: async () =>
      (await optFn({
        data: { commessa_id: commessaId === NONE ? null : commessaId, cantiere_id: null },
      })) as any,
  });
  const { data: dettaglio } = useQuery({
    queryKey: extraKeys.bolla(bollaId ?? "new"),
    enabled: open && isEdit,
    queryFn: async () => (await detailFn({ data: { id: bollaId! } })) as any,
  });

  // Precompila in modifica
  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      setFornitoreId("");
      setNumero("");
      setDataBolla(new Date().toISOString().slice(0, 10));
      setDataConsegna("");
      setCommessaId(NONE);
      setCantiereId(NONE);
      setRapportinoId(NONE);
      setNote("");
      setRighe([]);
      setFile(null);
      setDocumentoId(null);
      setForzaDuplicato(false);
      return;
    }
    if (!dettaglio) return;
    setFornitoreId(dettaglio.fornitore_id ?? "");
    setNumero(dettaglio.numero_bolla ?? "");
    setDataBolla(dettaglio.data_bolla ?? "");
    setDataConsegna(dettaglio.data_consegna ?? "");
    setCommessaId(dettaglio.commessa_id ?? NONE);
    setCantiereId(dettaglio.cantiere_id ?? NONE);
    setRapportinoId(dettaglio.rapportino_id ?? NONE);
    setNote(dettaglio.note ?? "");
    setDocumentoId(dettaglio.documento_id ?? null);
    setRighe(
      (dettaglio.righe ?? []).map((r: any) => ({
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
  }, [open, isEdit, dettaglio]);

  // Se scelgo un rapportino, commessa e cantiere seguono il rapportino
  const rapportini: any[] = opzioni?.rapportini ?? [];
  useEffect(() => {
    if (rapportinoId === NONE) return;
    const r = rapportini.find((x) => x.id === rapportinoId);
    if (r?.cantiere_id) setCantiereId(r.cantiere_id);
  }, [rapportinoId, rapportini]);

  const { data: duplicati = [] } = useQuery({
    queryKey: ["bolle", "duplicati", fornitoreId, numero.trim(), dataBolla, bollaId ?? null],
    enabled: open && !!fornitoreId && numero.trim().length > 0,
    queryFn: async () =>
      (await dupFn({
        data: {
          fornitore_id: fornitoreId,
          numero_bolla: numero.trim(),
          data_bolla: dataBolla,
          exclude_id: bollaId ?? null,
        },
      })) as any[],
  });
  const dup = useMemo(() => classificaDuplicati(duplicati as any, dataBolla), [duplicati, dataBolla]);
  const haDuplicati = dup.certi.length > 0 || dup.possibili.length > 0;

  const totali = useMemo(() => totaliBolla(righe), [righe]);
  const cantiereSel = (opzioni?.cantieri ?? []).find((k: any) => k.id === cantiereId);
  const errore =
    validaTestataArchivio({
      fornitore_id: fornitoreId,
      numero_bolla: numero,
      data_bolla: dataBolla,
      commessa_id: commessaId === NONE ? null : commessaId,
      cantiere_id: cantiereId === NONE ? null : cantiereId,
      cantiereCommessaId: cantiereSel ? (commessaId === NONE ? null : commessaId) : null,
    }) ?? (righe.length ? validaRigheBolla(righe) : null);

  const salva = useMutation({
    mutationFn: async () => {
      let docId = documentoId;
      if (file) {
        const check = validateFile({
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
        });
        if (!check.ok) throw new Error(check.error);
        const fornitoreNome =
          (fornitori as any[]).find((f) => f.id === fornitoreId)?.ragione_sociale ?? "fornitore";
        const prep = await prepare({
          data: {
            nome: `Bolla ${numero.trim()} — ${fornitoreNome}`,
            descrizione: null,
            categoria: "Amministrativo",
            data_documento: dataBolla,
            data_scadenza: null,
            fornitore_id: fornitoreId,
            commessa_id: commessaId === NONE ? null : commessaId,
            cantiere_id: cantiereId === NONE ? null : cantiereId,
            rapportino_id: rapportinoId === NONE ? null : rapportinoId,
            visibilita: "organizzazione" as const,
            file_name_originale: file.name,
            mime_type: file.type,
            file_size: file.size,
            note_versione: null,
          },
        });
        const { error: upErr } = await supabase.storage
          .from(DOCUMENTI_BUCKET)
          .upload(prep.path, file, { contentType: file.type, upsert: false });
        if (upErr) throw new Error("Caricamento del file non riuscito.");
        await finalize({ data: { document_id: prep.document_id } });
        docId = prep.document_id;
      }

      return await saveFn({
        data: {
          bolla: {
            id: bollaId ?? null,
            rapportino_id: rapportinoId === NONE ? null : rapportinoId,
            commessa_id: commessaId === NONE ? null : commessaId,
            cantiere_id: cantiereId === NONE ? null : cantiereId,
            fornitore_id: fornitoreId,
            numero_bolla: numero.trim(),
            data_bolla: dataBolla,
            data_consegna: dataConsegna || null,
            note: note.trim() || null,
            documento_id: docId,
          },
          righe: righe.map((r) => ({
            materiale_id: r.materiale_id === NONE ? null : r.materiale_id,
            descrizione: r.descrizione.trim(),
            codice_articolo: r.codice_articolo.trim() || null,
            quantita: Number(r.quantita),
            unita_misura: r.unita_misura.trim() || null,
            prezzo_unitario:
              canSeeEcon && r.prezzo_unitario !== "" ? Number(r.prezzo_unitario) : null,
            sconto_pct: r.sconto_pct !== "" ? Number(r.sconto_pct) : 0,
            iva_pct: r.iva_pct !== "" ? Number(r.iva_pct) : null,
          })),
        },
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Bolla aggiornata" : "Bolla registrata");
      invalidaArchivioBolle(qc, {
        id: bollaId,
        rapportinoId: rapportinoId === NONE ? null : rapportinoId,
      });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Operazione non riuscita"),
  });

  const setRiga = (i: number, patch: Partial<RigaDraft>) =>
    setRighe((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onOpenChange={(v) => (busy ? null : onOpenChange(v))}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifica bolla" : "Nuova bolla"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Fornitore *</Label>
              <Select value={fornitoreId} onValueChange={setFornitoreId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona…" />
                </SelectTrigger>
                <SelectContent>
                  {(fornitori as any[]).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.ragione_sociale}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="b-num">Numero bolla *</Label>
              <Input id="b-num" value={numero} onChange={(e) => setNumero(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="b-data">Data bolla *</Label>
              <Input
                id="b-data"
                type="date"
                value={dataBolla}
                onChange={(e) => setDataBolla(e.target.value)}
              />
            </div>
          </div>

          {haDuplicati && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                {MSG_DUPLICATO}
              </div>
              <ul className="mt-2 space-y-1">
                {[...dup.certi, ...dup.possibili].map((d: any) => (
                  <li key={d.id} className="text-muted-foreground">
                    N. {d.numero_bolla} del {dateIt(d.data_bolla)} — {d.fornitore_nome ?? "—"}
                  </li>
                ))}
              </ul>
              {!isEdit && (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={forzaDuplicato}
                    onChange={(e) => setForzaDuplicato(e.target.checked)}
                  />
                  Procedi comunque con la registrazione
                </label>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Commessa (opzionale)</Label>
              <Select
                value={commessaId}
                onValueChange={(v) => {
                  setCommessaId(v);
                  setCantiereId(NONE);
                  setRapportinoId(NONE);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Non attribuita</SelectItem>
                  {(opzioni?.commesse ?? []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.codice} — {c.titolo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cantiere (opzionale)</Label>
              <Select
                value={cantiereId}
                onValueChange={setCantiereId}
                disabled={commessaId === NONE}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {(opzioni?.cantieri ?? []).map((k: any) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.codice} — {k.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rapportino (opzionale)</Label>
              <Select
                value={rapportinoId}
                onValueChange={setRapportinoId}
                disabled={commessaId === NONE}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nessun rapportino</SelectItem>
                  {rapportini.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>
                      {dateIt(r.data)} — {r.lavorazione ?? r.stato}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {commessaId === NONE && (
            <p className="text-xs text-muted-foreground">
              Senza commessa la bolla viene registrata come non ancora attribuita: potrai collegarla
              in seguito.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="b-cons">Data consegna</Label>
              <Input
                id="b-cons"
                type="date"
                value={dataConsegna}
                onChange={(e) => setDataConsegna(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="b-file">File (PDF o foto)</Label>
              <Input
                id="b-file"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {documentoId && !file && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Documento già allegato: caricando un file lo sostituisci.
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="b-note">Note</Label>
            <Textarea
              id="b-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Righe materiali (opzionali)</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRighe((rs) => [...rs, rigaVuota()])}
              >
                <Plus className="h-4 w-4 mr-1" />
                Aggiungi materiale
              </Button>
            </div>
            {righe.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nessuna riga: la bolla viene registrata solo come documento.
              </p>
            )}
            <div className="space-y-3">
              {righe.map((r, i) => (
                <div key={i} className="rounded-md border p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Materiale</Label>
                      <Select
                        value={r.materiale_id}
                        onValueChange={(v) => {
                          const m = (materiali as any[]).find((x) => x.id === v);
                          setRiga(i, {
                            materiale_id: v,
                            descrizione: m?.nome ?? r.descrizione,
                            unita_misura: m?.unita_misura_predefinita ?? r.unita_misura,
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Fuori anagrafica</SelectItem>
                          {(materiali as any[]).map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Descrizione *</Label>
                      <Input
                        value={r.descrizione}
                        onChange={(e) => setRiga(i, { descrizione: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Codice</Label>
                      <Input
                        value={r.codice_articolo}
                        onChange={(e) => setRiga(i, { codice_articolo: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Quantità *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={r.quantita}
                        onChange={(e) => setRiga(i, { quantita: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Unità</Label>
                      <Input
                        value={r.unita_misura}
                        onChange={(e) => setRiga(i, { unita_misura: e.target.value })}
                      />
                    </div>
                    {canSeeEcon && (
                      <>
                        <div>
                          <Label className="text-xs">Prezzo unitario</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={r.prezzo_unitario}
                            onChange={(e) => setRiga(i, { prezzo_unitario: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Sconto %</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={r.sconto_pct}
                            onChange={(e) => setRiga(i, { sconto_pct: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">IVA %</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={r.iva_pct}
                            onChange={(e) => setRiga(i, { iva_pct: e.target.value })}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    {canSeeEcon ? (
                      <span className="text-xs text-muted-foreground">
                        Totale riga:{" "}
                        {eur(
                          Number(r.quantita || 0) *
                            Number(r.prezzo_unitario || 0) *
                            (1 - Number(r.sconto_pct || 0) / 100),
                        )}
                      </span>
                    ) : (
                      <span />
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setRighe((rs) => rs.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {canSeeEcon && righe.length > 0 && (
              <div className="mt-2 flex gap-3 text-sm">
                <Badge variant="secondary">Imponibile {eur(totali.imponibile)}</Badge>
                <Badge variant="secondary">IVA {eur(totali.iva)}</Badge>
                <Badge>Totale {eur(totali.totale)}</Badge>
              </div>
            )}
          </div>

          {errore && <p className="text-sm text-destructive">{errore}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Annulla
          </Button>
          <Button
            disabled={!!errore || busy || (!isEdit && haDuplicati && !forzaDuplicato)}
            onClick={() => {
              setBusy(true);
              salva.mutate(undefined, { onSettled: () => setBusy(false) });
            }}
          >
            {busy ? "Salvataggio…" : isEdit ? "Salva modifiche" : "Registra bolla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
