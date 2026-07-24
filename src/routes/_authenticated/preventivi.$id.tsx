import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  updatePreventivoHeader,
  upsertCategoria,
  deleteCategoria,
  moveCategoria,
  upsertVoce,
  deleteVoce,
  moveVoce,
  duplicateVoce,
  changeStato,
  createNuovaVersione,
  duplicatePreventivo,
  convertToCommessa,
  generatePreventivoPdfFn,
} from "@/lib/preventivi.functions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Save, Trash2, ArrowUp, ArrowDown, Copy, FileText, HardHat, GitBranch } from "lucide-react";
import { eur } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/preventivi/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Preventivo ${params.id.slice(0, 8)} — CantiereOS` },
      { name: "description", content: "Editor preventivo: categorie, voci, condizioni e stato." },
    ],
  }),
  component: PreventivoEditor,
});

const STATI = ["bozza", "in_revisione", "pronto", "inviato", "accettato", "rifiutato", "scaduto", "annullato"] as const;
const statoLabel: Record<string, string> = {
  bozza: "Bozza", in_revisione: "In revisione", pronto: "Pronto",
  inviato: "Inviato", accettato: "Accettato", rifiutato: "Rifiutato",
  scaduto: "Scaduto", convertito: "Convertito", annullato: "Annullato",
};

function PreventivoEditor() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const updateHeaderFn = useServerFn(updatePreventivoHeader);
  const upsertCatFn = useServerFn(upsertCategoria);
  const deleteCatFn = useServerFn(deleteCategoria);
  const moveCatFn = useServerFn(moveCategoria);
  const upsertVoceFn = useServerFn(upsertVoce);
  const deleteVoceFn = useServerFn(deleteVoce);
  const moveVoceFn = useServerFn(moveVoce);
  const duplicateVoceFn = useServerFn(duplicateVoce);
  const changeStatoFn = useServerFn(changeStato);
  const newVersioneFn = useServerFn(createNuovaVersione);
  const duplicatePrevFn = useServerFn(duplicatePreventivo);
  const convertFn = useServerFn(convertToCommessa);
  const generatePdfFn = useServerFn(generatePreventivoPdfFn);

  const { data: preventivo, isLoading } = useQuery({
    queryKey: ["preventivo", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("preventivi")
        .select("*, clienti(id, denominazione, ragione_sociale)")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: categorie = [] } = useQuery({
    queryKey: ["preventivo-cat", id],
    queryFn: async () =>
      (await supabase.from("preventivo_categorie").select("*").eq("preventivo_id", id).order("posizione")).data ?? [],
  });

  const { data: voci = [] } = useQuery({
    queryKey: ["preventivo-voci", id],
    queryFn: async () =>
      (await supabase.from("preventivo_voci").select("*").eq("preventivo_id", id).order("ordine")).data ?? [],
  });

  const { data: clientiList = [] } = useQuery({
    queryKey: ["clienti-lite"],
    queryFn: async () => (await supabase.from("clienti").select("id, denominazione, ragione_sociale").order("denominazione")).data ?? [],
  });

  // Local header state (only sends changed on save)
  const [header, setHeader] = useState<any>({});
  useEffect(() => { if (preventivo) setHeader(preventivo); }, [preventivo]);

  const readOnly = !preventivo?.is_current_version || preventivo?.stato === "convertito" || preventivo?.stato === "annullato";

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["preventivo", id] });
    qc.invalidateQueries({ queryKey: ["preventivo-cat", id] });
    qc.invalidateQueries({ queryKey: ["preventivo-voci", id] });
    qc.invalidateQueries({ queryKey: ["preventivi"] });
  };

  const saveHeader = useMutation({
    mutationFn: async () => {
      const patch: any = {
        titolo: header.titolo ?? null,
        oggetto: header.oggetto,
        cliente_id: header.cliente_id ?? null,
        data_preventivo: header.data_preventivo,
        data_validita: header.data_validita ?? null,
        sconto_globale_pct: Number(header.sconto_globale_pct ?? 0),
        maggiorazione_globale_pct: Number(header.maggiorazione_globale_pct ?? 0),
        spese_accessorie: Number(header.spese_accessorie ?? 0),
        iva_default_pct: Number(header.iva_default_pct ?? 22),
        condizioni_pagamento: header.condizioni_pagamento ?? null,
        tempi_esecuzione: header.tempi_esecuzione ?? null,
        esclusioni: header.esclusioni ?? null,
        garanzie: header.garanzie ?? null,
        condizioni_generali: header.condizioni_generali ?? null,
        note: header.note ?? null,
      };
      return updateHeaderFn({ data: { id, expected_updated_at: preventivo!.updated_at, patch } });
    },
    onSuccess: () => { toast.success("Salvato"); invalidateAll(); },
    onError: (e: any) => toast.error(e?.message ?? "Errore salvataggio"),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Caricamento…</div>;
  if (!preventivo) return (
    <div className="p-6">
      <p className="text-muted-foreground mb-4">Preventivo non trovato.</p>
      <Button asChild variant="outline"><Link to="/preventivi">Torna alla lista</Link></Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <div className="flex items-center gap-2 flex-wrap">
            <Button asChild variant="ghost" size="sm"><Link to="/preventivi"><ArrowLeft className="h-4 w-4 mr-1" />Preventivi</Link></Button>
            <span className="font-mono">{preventivo.numero}</span>
            <span className="text-muted-foreground text-sm">v{preventivo.versione}</span>
            <Badge variant="outline">{statoLabel[preventivo.stato] ?? preventivo.stato}</Badge>
            {!preventivo.is_current_version && <Badge variant="destructive">Versione superata</Badge>}
          </div>
        }
        description={preventivo.titolo || preventivo.oggetto}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select
              value={preventivo.stato}
              onValueChange={(v) => changeStatoFn({ data: { id, nuovo_stato: v as any } }).then(() => { toast.success("Stato aggiornato"); invalidateAll(); }).catch((e: any) => toast.error(e?.message ?? "Transizione non consentita"))}
            >
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATI.map(s => <SelectItem key={s} value={s}>{statoLabel[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => generatePdfFn({ data: { id } }).then(() => toast.success("PDF generato in Documenti")).catch((e: any) => toast.error(e?.message ?? "Errore PDF"))}>
              <FileText className="h-4 w-4 mr-1" />PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => newVersioneFn({ data: { id } }).then((r: any) => { toast.success("Nuova versione creata"); navigate({ to: "/preventivi/$id", params: { id: r.id } }); }).catch((e: any) => toast.error(e?.message))}>
              <GitBranch className="h-4 w-4 mr-1" />Nuova versione
            </Button>
            <Button variant="outline" size="sm" onClick={() => duplicatePrevFn({ data: { id } }).then((r: any) => { toast.success("Duplicato"); navigate({ to: "/preventivi/$id", params: { id: r.id } }); }).catch((e: any) => toast.error(e?.message))}>
              <Copy className="h-4 w-4 mr-1" />Duplica
            </Button>
            {preventivo.stato === "accettato" && (
              <ConvertDialog onConvert={(data) => convertFn({ data: { id, ...data } }).then((r: any) => { toast.success("Commessa creata"); navigate({ to: "/commesse" }); void r; }).catch((e: any) => toast.error(e?.message))} />
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Imponibile</div><div className="text-xl font-bold">{eur(preventivo.totale_ricavo)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">IVA</div><div className="text-xl font-bold">{eur(preventivo.totale_iva)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Totale</div><div className="text-xl font-bold">{eur(preventivo.totale)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Margine</div><div className={`text-xl font-bold ${(preventivo.margine ?? 0) < 0 ? "text-destructive" : ""}`}>{eur(preventivo.margine)}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="voci">
        <TabsList>
          <TabsTrigger value="voci">Categorie & Voci</TabsTrigger>
          <TabsTrigger value="header">Intestazione</TabsTrigger>
          <TabsTrigger value="condizioni">Condizioni</TabsTrigger>
        </TabsList>

        {/* ------ VOCI ------ */}
        <TabsContent value="voci" className="space-y-4">
          {readOnly && <p className="text-sm text-muted-foreground">Questa versione non è modificabile.</p>}
          <AddCategoriaButton preventivoId={id} disabled={readOnly} onDone={invalidateAll} upsertFn={upsertCatFn} />

          {categorie.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">Nessuna categoria. Aggiungine una per iniziare.</CardContent></Card>}

          {categorie.map((cat: any) => (
            <CategoriaCard
              key={cat.id}
              cat={cat}
              voci={voci.filter((v: any) => v.categoria_id === cat.id)}
              preventivoId={id}
              readOnly={readOnly}
              defaultIva={Number(preventivo.iva_default_pct ?? 22)}
              onChanged={invalidateAll}
              onDeleteCat={() => confirm("Eliminare la categoria e tutte le sue voci?") && deleteCatFn({ data: { id: cat.id } }).then(() => { toast.success("Categoria eliminata"); invalidateAll(); }).catch((e: any) => toast.error(e?.message))}
              onMoveCat={(dir: "up" | "down") => moveCatFn({ data: { id: cat.id, direction: dir } }).then(invalidateAll)}
              upsertCatFn={upsertCatFn}
              upsertVoceFn={upsertVoceFn}
              deleteVoceFn={deleteVoceFn}
              moveVoceFn={moveVoceFn}
              duplicateVoceFn={duplicateVoceFn}
            />
          ))}
        </TabsContent>

        {/* ------ HEADER ------ */}
        <TabsContent value="header">
          <Card><CardContent className="pt-6 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><Label>Oggetto *</Label><Input value={header.oggetto ?? ""} onChange={e => setHeader({ ...header, oggetto: e.target.value })} disabled={readOnly} /></div>
            <div className="md:col-span-2"><Label>Titolo</Label><Input value={header.titolo ?? ""} onChange={e => setHeader({ ...header, titolo: e.target.value })} disabled={readOnly} /></div>
            <div>
              <Label>Cliente</Label>
              <Select value={header.cliente_id ?? ""} onValueChange={v => setHeader({ ...header, cliente_id: v || null })} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                <SelectContent>
                  {clientiList.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.denominazione || c.ragione_sociale}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Data preventivo</Label><Input type="date" value={header.data_preventivo ?? ""} onChange={e => setHeader({ ...header, data_preventivo: e.target.value })} disabled={readOnly} /></div>
            <div><Label>Validità (data)</Label><Input type="date" value={header.data_validita ?? ""} onChange={e => setHeader({ ...header, data_validita: e.target.value || null })} disabled={readOnly} /></div>
            <div><Label>IVA default %</Label><Input type="number" step="0.01" value={header.iva_default_pct ?? 22} onChange={e => setHeader({ ...header, iva_default_pct: e.target.value })} disabled={readOnly} /></div>
            <div><Label>Sconto globale %</Label><Input type="number" step="0.01" value={header.sconto_globale_pct ?? 0} onChange={e => setHeader({ ...header, sconto_globale_pct: e.target.value })} disabled={readOnly} /></div>
            <div><Label>Maggiorazione globale %</Label><Input type="number" step="0.01" value={header.maggiorazione_globale_pct ?? 0} onChange={e => setHeader({ ...header, maggiorazione_globale_pct: e.target.value })} disabled={readOnly} /></div>
            <div><Label>Spese accessorie €</Label><Input type="number" step="0.01" value={header.spese_accessorie ?? 0} onChange={e => setHeader({ ...header, spese_accessorie: e.target.value })} disabled={readOnly} /></div>
            <div className="md:col-span-2"><Label>Note interne</Label><Textarea rows={3} value={header.note ?? ""} onChange={e => setHeader({ ...header, note: e.target.value })} disabled={readOnly} /></div>
            <div className="md:col-span-2 flex justify-end">
              <Button onClick={() => saveHeader.mutate()} disabled={readOnly || saveHeader.isPending}>
                <Save className="h-4 w-4 mr-1" />Salva intestazione
              </Button>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* ------ CONDIZIONI ------ */}
        <TabsContent value="condizioni">
          <Card><CardContent className="pt-6 space-y-4">
            {[
              ["condizioni_pagamento", "Condizioni di pagamento"],
              ["tempi_esecuzione", "Tempi di esecuzione"],
              ["esclusioni", "Esclusioni"],
              ["garanzie", "Garanzie"],
              ["condizioni_generali", "Condizioni generali"],
            ].map(([k, lbl]) => (
              <div key={k}><Label>{lbl}</Label><Textarea rows={3} value={header[k] ?? ""} onChange={e => setHeader({ ...header, [k]: e.target.value })} disabled={readOnly} /></div>
            ))}
            <div className="flex justify-end">
              <Button onClick={() => saveHeader.mutate()} disabled={readOnly || saveHeader.isPending}>
                <Save className="h-4 w-4 mr-1" />Salva condizioni
              </Button>
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============ Sub-components ============ */

function AddCategoriaButton({ preventivoId, disabled, onDone, upsertFn }: any) {
  const [open, setOpen] = useState(false);
  const [titolo, setTitolo] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const submit = async () => {
    if (!titolo.trim()) { toast.error("Titolo obbligatorio"); return; }
    try {
      await upsertFn({ data: { preventivo_id: preventivoId, titolo: titolo.trim(), descrizione: descrizione || null } });
      toast.success("Categoria aggiunta");
      setTitolo(""); setDescrizione(""); setOpen(false); onDone();
    } catch (e: any) { toast.error(e?.message ?? "Errore"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button disabled={disabled}><Plus className="h-4 w-4 mr-1" />Aggiungi categoria</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuova categoria</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Titolo *</Label><Input value={titolo} onChange={e => setTitolo(e.target.value)} placeholder="Es. Opere murarie" /></div>
          <div><Label>Descrizione</Label><Textarea rows={2} value={descrizione} onChange={e => setDescrizione(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Crea</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriaCard({ cat, voci, preventivoId, readOnly, defaultIva, onChanged, onDeleteCat, onMoveCat, upsertVoceFn, deleteVoceFn, moveVoceFn, duplicateVoceFn }: any) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{cat.titolo}</CardTitle>
          {cat.descrizione && <p className="text-sm text-muted-foreground mt-1">{cat.descrizione}</p>}
        </div>
        <div className="flex gap-1">
          {!readOnly && <>
            <Button size="icon" variant="ghost" onClick={() => onMoveCat("up")}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => onMoveCat("down")}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={onDeleteCat}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </>}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[35%]">Descrizione</TableHead>
              <TableHead>UM</TableHead>
              <TableHead className="text-right">Q.tà</TableHead>
              <TableHead className="text-right">Costo</TableHead>
              <TableHead className="text-right">Prezzo</TableHead>
              <TableHead className="text-right">Sc.%</TableHead>
              <TableHead className="text-right">Netto</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {voci.map((v: any) => (
              <VoceRow
                key={v.id} v={v} readOnly={readOnly}
                onSave={(patch: any) => upsertVoceFn({ data: { id: v.id, preventivo_id: preventivoId, categoria_id: cat.id, ...patch } }).then(() => { toast.success("Voce aggiornata"); onChanged(); }).catch((e: any) => toast.error(e?.message))}
                onDelete={() => confirm("Eliminare la voce?") && deleteVoceFn({ data: { id: v.id } }).then(() => { toast.success("Eliminata"); onChanged(); })}
                onMove={(dir: "up" | "down") => moveVoceFn({ data: { id: v.id, direction: dir } }).then(onChanged)}
                onDuplicate={() => duplicateVoceFn({ data: { id: v.id } }).then(() => { toast.success("Duplicata"); onChanged(); })}
              />
            ))}
            {!readOnly && <NewVoceRow defaultIva={defaultIva} onAdd={(patch: any) => upsertVoceFn({ data: { preventivo_id: preventivoId, categoria_id: cat.id, ...patch } }).then(() => { toast.success("Voce aggiunta"); onChanged(); }).catch((e: any) => toast.error(e?.message))} />}
            {voci.length === 0 && readOnly && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-4">Nessuna voce</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="mt-2 text-right text-sm text-muted-foreground">
          Subtotale categoria: <span className="font-semibold text-foreground">{eur(cat.subtotale_ricavo)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function VoceRow({ v, readOnly, onSave, onDelete, onMove, onDuplicate }: any) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<any>(v);
  useEffect(() => setF(v), [v]);
  if (!edit) {
    return (
      <TableRow>
        <TableCell className="align-top">{v.descrizione}</TableCell>
        <TableCell>{v.unita_misura ?? "—"}</TableCell>
        <TableCell className="text-right">{Number(v.quantita).toFixed(2)}</TableCell>
        <TableCell className="text-right">{eur(v.costo_unitario)}</TableCell>
        <TableCell className="text-right">{eur(v.prezzo_unitario)}</TableCell>
        <TableCell className="text-right">{Number(v.sconto_pct).toFixed(0)}</TableCell>
        <TableCell className="text-right font-medium">{eur(v.importo_netto)}</TableCell>
        <TableCell className="text-right">
          {!readOnly && <div className="flex gap-1 justify-end">
            <Button size="icon" variant="ghost" onClick={() => onMove("up")}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" onClick={() => onMove("down")}><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Modifica</Button>
            <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
          </div>}
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow>
      <TableCell><Textarea rows={2} value={f.descrizione ?? ""} onChange={e => setF({ ...f, descrizione: e.target.value })} /></TableCell>
      <TableCell><Input value={f.unita_misura ?? ""} onChange={e => setF({ ...f, unita_misura: e.target.value })} className="w-16" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.quantita ?? 0} onChange={e => setF({ ...f, quantita: e.target.value })} className="w-20 text-right" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.costo_unitario ?? 0} onChange={e => setF({ ...f, costo_unitario: e.target.value })} className="w-24 text-right" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.prezzo_unitario ?? 0} onChange={e => setF({ ...f, prezzo_unitario: e.target.value })} className="w-24 text-right" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.sconto_pct ?? 0} onChange={e => setF({ ...f, sconto_pct: e.target.value })} className="w-16 text-right" /></TableCell>
      <TableCell className="text-right text-muted-foreground text-xs">auto</TableCell>
      <TableCell className="text-right">
        <div className="flex gap-1 justify-end">
          <Button size="sm" onClick={() => { onSave({
            descrizione: f.descrizione, unita_misura: f.unita_misura || null,
            quantita: Number(f.quantita), costo_unitario: Number(f.costo_unitario),
            prezzo_unitario: Number(f.prezzo_unitario), sconto_pct: Number(f.sconto_pct),
            iva_pct: Number(f.iva_pct ?? 22),
          }); setEdit(false); }}>Salva</Button>
          <Button size="sm" variant="ghost" onClick={() => { setF(v); setEdit(false); }}>Annulla</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function NewVoceRow({ defaultIva, onAdd }: any) {
  const [f, setF] = useState<any>({ descrizione: "", unita_misura: "", quantita: 1, costo_unitario: 0, prezzo_unitario: 0, sconto_pct: 0, iva_pct: defaultIva });
  const submit = async () => {
    if (!f.descrizione.trim()) { toast.error("Descrizione obbligatoria"); return; }
    await onAdd({
      descrizione: f.descrizione.trim(), unita_misura: f.unita_misura || null,
      quantita: Number(f.quantita) || 0, costo_unitario: Number(f.costo_unitario) || 0,
      prezzo_unitario: Number(f.prezzo_unitario) || 0, sconto_pct: Number(f.sconto_pct) || 0,
      iva_pct: Number(f.iva_pct) || defaultIva,
    });
    setF({ descrizione: "", unita_misura: "", quantita: 1, costo_unitario: 0, prezzo_unitario: 0, sconto_pct: 0, iva_pct: defaultIva });
  };
  return (
    <TableRow className="bg-muted/30">
      <TableCell><Input value={f.descrizione} placeholder="Nuova voce…" onChange={e => setF({ ...f, descrizione: e.target.value })} /></TableCell>
      <TableCell><Input value={f.unita_misura} placeholder="mq" onChange={e => setF({ ...f, unita_misura: e.target.value })} className="w-16" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.quantita} onChange={e => setF({ ...f, quantita: e.target.value })} className="w-20 text-right" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.costo_unitario} onChange={e => setF({ ...f, costo_unitario: e.target.value })} className="w-24 text-right" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.prezzo_unitario} onChange={e => setF({ ...f, prezzo_unitario: e.target.value })} className="w-24 text-right" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={f.sconto_pct} onChange={e => setF({ ...f, sconto_pct: e.target.value })} className="w-16 text-right" /></TableCell>
      <TableCell></TableCell>
      <TableCell className="text-right"><Button size="sm" onClick={submit}><Plus className="h-4 w-4 mr-1" />Aggiungi</Button></TableCell>
    </TableRow>
  );
}

function ConvertDialog({ onConvert }: { onConvert: (data: any) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ data_inizio: new Date().toISOString().slice(0, 10) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><HardHat className="h-4 w-4 mr-1" />Converti in commessa</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Converti in commessa</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Data inizio</Label><Input type="date" value={f.data_inizio} onChange={e => setF({ ...f, data_inizio: e.target.value })} /></div>
          <div><Label>Data fine prevista</Label><Input type="date" value={f.data_fine_prevista ?? ""} onChange={e => setF({ ...f, data_fine_prevista: e.target.value || null })} /></div>
          <div><Label>Indirizzo cantiere</Label><Input value={f.indirizzo_cantiere ?? ""} onChange={e => setF({ ...f, indirizzo_cantiere: e.target.value })} /></div>
          <div><Label>Note</Label><Textarea rows={2} value={f.note ?? ""} onChange={e => setF({ ...f, note: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={() => { onConvert(f); setOpen(false); }}>Conferma</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
