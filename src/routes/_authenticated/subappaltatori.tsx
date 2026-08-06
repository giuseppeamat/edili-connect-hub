import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileSignature } from "lucide-react";
import {
  listSubappaltatoriOverview,
  saveContrattoSubappalto,
} from "@/lib/subappaltatori.functions";
import { SchedaSoggettoDialog } from "@/components/fornitori/scheda-soggetto-dialog";

export const Route = createFileRoute("/_authenticated/subappaltatori")({
  head: () => ({
    meta: [
      { title: "Subappaltatori — CantiereOS" },
      {
        name: "description",
        content:
          "Ditte in subappalto: contratti, importi maturati e scadenze dei documenti obbligatori.",
      },
      { property: "og:title", content: "Subappaltatori — CantiereOS" },
      {
        property: "og:description",
        content: "Contratti di subappalto, importi maturati e documenti in scadenza.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubappaltatoriPage,
});

const eur = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `€ ${Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATI = ["bozza", "attivo", "sospeso", "completato", "chiuso", "annullato"] as const;

function SubappaltatoriPage() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(listSubappaltatoriOverview);
  const saveFn = useServerFn(saveContrattoSubappalto);
  const [scheda, setScheda] = useState<string | null>(null);
  const [contrattoPer, setContrattoPer] = useState<any | null>(null);
  const [form, setForm] = useState({
    commessa_id: "",
    oggetto: "",
    data_inizio: new Date().toISOString().slice(0, 10),
    data_fine: "",
    importo: "0",
    stato: "attivo",
    note: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["subappaltatori", "overview"],
    queryFn: async () => await overviewFn(),
  });

  const { data: commesse = [] } = useQuery({
    queryKey: ["commesse", "scelta-subappalto"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("commesse")
        .select("id, codice, denominazione")
        .is("archived_at", null)
        .order("codice");
      if (error) throw error;
      return rows ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!contrattoPer) return;
      return await saveFn({
        data: {
          subappaltatore_id: contrattoPer.id,
          commessa_id: form.commessa_id,
          oggetto: form.oggetto,
          data_inizio: form.data_inizio,
          data_fine: form.data_fine || null,
          importo_contratto: Number(form.importo || 0),
          stato: form.stato as any,
          note: form.note || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Contratto di subappalto salvato");
      setContrattoPer(null);
      qc.invalidateQueries({ queryKey: ["subappaltatori", "overview"] });
      qc.invalidateQueries({ queryKey: ["subappalti", "contratti"] });
      qc.invalidateQueries({ queryKey: ["fornitori", "scheda"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const righe = ((data as any)?.righe ?? []) as any[];
  const econ = (data as any)?.canSeeEconomics === true;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Subappaltatori"
        description="Ditte in subappalto: contratti, importi maturati e documenti obbligatori."
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ditta</TableHead>
              <TableHead>Specializzazioni</TableHead>
              <TableHead className="text-right">Contratti</TableHead>
              {econ && <TableHead className="text-right">Importo</TableHead>}
              {econ && <TableHead className="text-right">Maturato</TableHead>}
              <TableHead>Documenti</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {righe.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <button
                    className="font-medium text-primary hover:underline text-left"
                    onClick={() => setScheda(r.id)}
                  >
                    {r.ragione_sociale}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {r.partita_iva ? `P.IVA ${r.partita_iva}` : "—"}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {(r.specializzazioni ?? []).length ? (r.specializzazioni as string[]).join(", ") : "—"}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {r.contrattiAttivi} attivi / {r.contrattiTotali}
                </TableCell>
                {econ && <TableCell className="text-right text-sm">{eur(r.importoContratti)}</TableCell>}
                {econ && <TableCell className="text-right text-sm">{eur(r.importoMaturato)}</TableCell>}
                <TableCell className="text-xs">
                  {r.documentiScaduti > 0 && (
                    <Badge variant="outline" className="text-rose-700 border-rose-400 mr-1">
                      {r.documentiScaduti} scaduti
                    </Badge>
                  )}
                  {r.documentiInScadenza > 0 && (
                    <Badge variant="outline" className="text-amber-700 border-amber-400 mr-1">
                      {r.documentiInScadenza} in scadenza
                    </Badge>
                  )}
                  {r.documentiScaduti === 0 && r.documentiInScadenza === 0 && (
                    <span className="text-muted-foreground">
                      {r.documentiTotali > 0 ? "In regola" : "Nessun documento"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setScheda(r.id)}>
                      Scheda
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setContrattoPer(r);
                        setForm({
                          commessa_id: "",
                          oggetto: "",
                          data_inizio: new Date().toISOString().slice(0, 10),
                          data_fine: "",
                          importo: "0",
                          stato: "attivo",
                          note: "",
                        });
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Contratto
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && righe.length === 0 && (
              <TableRow>
                <TableCell colSpan={econ ? 7 : 5} className="text-center text-muted-foreground py-8">
                  Nessuna ditta in subappalto. Imposta la tipologia "subappaltatore" nell'anagrafica
                  Fornitori.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <SchedaSoggettoDialog fornitoreId={scheda} onOpenChange={(v) => { if (!v) setScheda(null); }} />

      <Dialog open={!!contrattoPer} onOpenChange={(v) => { if (!v) setContrattoPer(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="h-4 w-4" /> Nuovo contratto — {contrattoPer?.ragione_sociale}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Commessa *</Label>
              <Select value={form.commessa_id || undefined} onValueChange={(v) => setForm((f) => ({ ...f, commessa_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleziona commessa" /></SelectTrigger>
                <SelectContent>
                  {(commesse as any[]).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.codice} — {c.denominazione}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Oggetto *</Label>
              <Input value={form.oggetto} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, oggetto: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Data inizio *</Label>
                <Input type="date" value={form.data_inizio} onChange={(e) => setForm((f) => ({ ...f, data_inizio: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Data fine</Label>
                <Input type="date" value={form.data_fine} onChange={(e) => setForm((f) => ({ ...f, data_fine: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Importo contratto (€)</Label>
                <Input type="number" min="0" step="0.01" value={form.importo} onChange={(e) => setForm((f) => ({ ...f, importo: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Stato</Label>
                <Select value={form.stato} onValueChange={(v) => setForm((f) => ({ ...f, stato: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATI.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Note</Label>
              <Textarea value={form.note} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContrattoPer(null)}>Annulla</Button>
            <Button
              disabled={!form.commessa_id || !form.oggetto.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Salvataggio…" : "Salva contratto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
