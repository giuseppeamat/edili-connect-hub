import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { eur, dateIt } from "@/lib/format";
import {
  PERIODICITA_LABELS,
  PERIODICITA_OPTIONS,
  TIPO_PERSONALE_LABELS,
  GRUPPI_LABELS,
  quotaAnnua,
  costoAttivoNellAnno,
  type Periodicita,
  type TipoPersonale,
} from "@/lib/costi-struttura";
import { saveCostoStruttura, setCostoStrutturaArchived } from "@/lib/costi-struttura.functions";

type Categoria = { id: string; gruppo: string; nome: string; is_active: boolean };
type Costo = any;

const TIPI_PERSONALE = Object.keys(TIPO_PERSONALE_LABELS) as TipoPersonale[];

const emptyForm = (anno: number) => ({
  id: null as string | null,
  categoria_id: "",
  descrizione: "",
  importo: "0",
  periodicita: "mensile" as Periodicita,
  data_inizio: `${anno}-01-01`,
  data_fine: "",
  anno_riferimento: String(anno),
  mese_riferimento: "",
  fornitore_id: "",
  tipo_personale: "non_applicabile" as TipoPersonale,
  anni_ammortamento: "",
  data_inizio_ammortamento: "",
  valore_residuo: "",
  note: "",
});

export function CostiTab({
  anno,
  costi,
  categorie,
  fornitori,
  canWrite,
}: {
  anno: number;
  costi: Costo[];
  categorie: Categoria[];
  fornitori: { id: string; ragione_sociale: string }[];
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveCostoStruttura);
  const archFn = useServerFn(setCostoStrutturaArchived);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm(anno));
  const [soloAnno, setSoloAnno] = useState(true);

  const catById = useMemo(() => new Map(categorie.map((c) => [c.id, c])), [categorie]);
  const rows = useMemo(
    () => (soloAnno ? costi.filter((c) => costoAttivoNellAnno(c, anno)) : costi),
    [costi, anno, soloAnno],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["costi-struttura"] });

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        id: form.id ?? undefined,
        categoria_id: form.categoria_id,
        descrizione: form.descrizione.trim(),
        importo: Number(form.importo || 0),
        periodicita: form.periodicita,
        data_inizio: form.data_inizio,
        data_fine: form.data_fine || null,
        anno_riferimento: Number(form.anno_riferimento || anno),
        mese_riferimento: form.mese_riferimento ? Number(form.mese_riferimento) : null,
        fornitore_id: form.fornitore_id || null,
        tipo_personale: form.tipo_personale,
        anni_ammortamento: form.anni_ammortamento ? Number(form.anni_ammortamento) : null,
        data_inizio_ammortamento: form.data_inizio_ammortamento || null,
        valore_residuo: form.valore_residuo ? Number(form.valore_residuo) : null,
        note: form.note || null,
      };
      return saveFn({ data: payload });
    },
    onSuccess: () => {
      setOpen(false);
      invalidate();
      toast.success("Costo salvato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const archivia = useMutation({
    mutationFn: async (v: { id: string; archived: boolean }) => archFn({ data: v }),
    onSuccess: (_r, v) => {
      invalidate();
      toast.success(v.archived ? "Costo archiviato" : "Costo ripristinato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openNew = () => {
    setForm({ ...emptyForm(anno), categoria_id: categorie[0]?.id ?? "" });
    setOpen(true);
  };
  const openEdit = (c: Costo) => {
    setForm({
      id: c.id,
      categoria_id: c.categoria_id,
      descrizione: c.descrizione ?? "",
      importo: String(c.importo ?? 0),
      periodicita: c.periodicita,
      data_inizio: c.data_inizio ?? `${anno}-01-01`,
      data_fine: c.data_fine ?? "",
      anno_riferimento: String(c.anno_riferimento ?? anno),
      mese_riferimento: c.mese_riferimento ? String(c.mese_riferimento) : "",
      fornitore_id: c.fornitore_id ?? "",
      tipo_personale: c.tipo_personale ?? "non_applicabile",
      anni_ammortamento: c.anni_ammortamento ? String(c.anni_ammortamento) : "",
      data_inizio_ammortamento: c.data_inizio_ammortamento ?? "",
      valore_residuo: c.valore_residuo != null ? String(c.valore_residuo) : "",
      note: c.note ?? "",
    });
    setOpen(true);
  };

  const isAmm = form.periodicita === "ammortizzato";
  const isUnaTantum = form.periodicita === "una_tantum";

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Costi della struttura {soloAnno ? `· ${anno}` : "· tutti"}</CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="solo-anno" checked={soloAnno} onCheckedChange={setSoloAnno} />
            <Label htmlFor="solo-anno" className="text-sm font-normal">Solo competenza {anno}</Label>
          </div>
          {canWrite && (
            <Button onClick={openNew} disabled={categorie.length === 0}>
              <Plus className="h-4 w-4 mr-1" /> Nuovo costo
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrizione</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Periodicità</TableHead>
              <TableHead className="text-right">Importo</TableHead>
              <TableHead className="text-right">Quota annua</TableHead>
              <TableHead>Validità</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center py-8">
                  Nessun costo registrato per il periodo.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const cat = catById.get(c.categoria_id);
              return (
                <TableRow key={c.id} className={c.archived_at ? "opacity-50" : ""}>
                  <TableCell>
                    <div className="font-medium">{c.descrizione}</div>
                    {c.tipo_personale && c.tipo_personale !== "non_applicabile" && (
                      <Badge variant="outline" className="mt-1">
                        {TIPO_PERSONALE_LABELS[c.tipo_personale as TipoPersonale]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {cat ? (
                      <>
                        <div>{cat.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {GRUPPI_LABELS[cat.gruppo] ?? cat.gruppo}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{PERIODICITA_LABELS[c.periodicita as Periodicita]}</Badge>
                    {c.periodicita === "ammortizzato" && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {c.anni_ammortamento} anni
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{eur(c.importo)}</TableCell>
                  <TableCell className="text-right font-medium">{eur(quotaAnnua(c))}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {dateIt(c.data_inizio)} → {c.data_fine ? dateIt(c.data_fine) : "—"}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canWrite && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => archivia.mutate({ id: c.id, archived: !c.archived_at })}
                        >
                          {c.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifica costo" : "Nuovo costo di struttura"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>Descrizione *</Label>
              <Input value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} />
            </div>
            <div>
              <Label>Categoria *</Label>
              <Select value={form.categoria_id} onValueChange={(v) => setForm({ ...form, categoria_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent>
                  {categorie.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(GRUPPI_LABELS[c.gruppo] ?? c.gruppo) + " · " + c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Periodicità *</Label>
              <Select
                value={form.periodicita}
                onValueChange={(v) => setForm({ ...form, periodicita: v as Periodicita })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODICITA_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{PERIODICITA_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Importo € *</Label>
              <Input
                type="number"
                step="0.01"
                value={form.importo}
                onChange={(e) => setForm({ ...form, importo: e.target.value })}
              />
            </div>
            <div>
              <Label>Anno di riferimento *</Label>
              <Input
                type="number"
                value={form.anno_riferimento}
                onChange={(e) => setForm({ ...form, anno_riferimento: e.target.value })}
              />
            </div>
            {isUnaTantum && (
              <div>
                <Label>Mese di riferimento</Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={form.mese_riferimento}
                  onChange={(e) => setForm({ ...form, mese_riferimento: e.target.value })}
                />
              </div>
            )}
            <div>
              <Label>Data inizio *</Label>
              <Input type="date" value={form.data_inizio} onChange={(e) => setForm({ ...form, data_inizio: e.target.value })} />
            </div>
            <div>
              <Label>Data fine</Label>
              <Input type="date" value={form.data_fine} onChange={(e) => setForm({ ...form, data_fine: e.target.value })} />
            </div>
            {isAmm && (
              <>
                <div>
                  <Label>Anni di ammortamento *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.anni_ammortamento}
                    onChange={(e) => setForm({ ...form, anni_ammortamento: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Inizio ammortamento</Label>
                  <Input
                    type="date"
                    value={form.data_inizio_ammortamento}
                    onChange={(e) => setForm({ ...form, data_inizio_ammortamento: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Valore residuo €</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valore_residuo}
                    onChange={(e) => setForm({ ...form, valore_residuo: e.target.value })}
                  />
                </div>
                <div className="flex items-end text-sm text-muted-foreground">
                  Quota annua:&nbsp;
                  <span className="font-medium text-foreground">
                    {eur(
                      quotaAnnua({
                        importo: Number(form.importo || 0),
                        periodicita: "ammortizzato",
                        anno_riferimento: Number(form.anno_riferimento || anno),
                        anni_ammortamento: Number(form.anni_ammortamento || 0),
                        valore_residuo: Number(form.valore_residuo || 0),
                      }),
                    )}
                  </span>
                </div>
              </>
            )}
            <div>
              <Label>Natura personale</Label>
              <Select
                value={form.tipo_personale}
                onValueChange={(v) => setForm({ ...form, tipo_personale: v as TipoPersonale })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPI_PERSONALE.map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_PERSONALE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Il personale diretto è escluso dal totale struttura (già nei rapportini).
              </p>
            </div>
            <div>
              <Label>Fornitore</Label>
              <Select
                value={form.fornitore_id || "__none"}
                onValueChange={(v) => setForm({ ...form, fornitore_id: v === "__none" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nessuno</SelectItem>
                  {fornitori.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.ragione_sociale}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Note</Label>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.descrizione.trim() || !form.categoria_id}
            >
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
