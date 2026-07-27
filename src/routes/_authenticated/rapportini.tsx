import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { dateIt } from "@/lib/format";
import { rapportiniKeys, type RapportinoFilters } from "@/lib/rapportini.keys";
import { listRapportini, listRapportinoAssignableCommesse } from "@/lib/rapportini.functions";
import { NewRapportinoDialog } from "@/components/commesse/rapportini-tab";

export const Route = createFileRoute("/_authenticated/rapportini")({
  head: () => ({
    meta: [
      { title: "Rapportini — CantiereOS" },
      { name: "description", content: "Rapportini giornalieri dei dipendenti in cantiere." },
    ],
  }),
  component: RapportiniPage,
});

const STATO_LABEL: Record<string, string> = {
  bozza: "Bozza", inviato: "Inviato", approvato: "Approvato", respinto: "Respinto", annullato: "Annullato",
};

function fullName(r: any) {
  if (!r) return "—";
  const s = [r?.nome, r?.cognome].filter(Boolean).join(" ").trim();
  return s || r?.email || "Utente";
}

function RapportiniPage() {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<RapportinoFilters>({ includeArchived: false });

  const listFn = useServerFn(listRapportini);
  const commesseFn = useServerFn(listRapportinoAssignableCommesse);

  const { data: items = [], isLoading } = useQuery({
    queryKey: rapportiniKeys.list(filters),
    queryFn: async () => await listFn({ data: filters as any }),
  });
  const { data: commesse = [] } = useQuery({
    queryKey: rapportiniKeys.assignable.commesse(),
    queryFn: async () => await commesseFn(),
  });

  const totalOre = useMemo(() => (items as any[]).reduce((s, r) => s + Number(r.ore ?? 0), 0), [items]);

  return (
    <div>
      <PageHeader
        title="Rapportini"
        description={`${(items as any[]).length} rapportini · ${totalOre.toFixed(1)} ore totali`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Nuovo rapportino</Button>
            <NewRapportinoDialog
              allowCommessaSelect
              commesseOptions={commesse as any[]}
              onClose={() => setOpen(false)}
              onCreated={() => setOpen(false)}
            />
          </Dialog>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <Label className="text-xs">Da</Label>
            <Input type="date" value={filters.from ?? ""} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || null }))} />
          </div>
          <div>
            <Label className="text-xs">A</Label>
            <Input type="date" value={filters.to ?? ""} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || null }))} />
          </div>
          <div>
            <Label className="text-xs">Commessa</Label>
            <Select value={filters.commessa_id ?? "__all__"} onValueChange={(v) => setFilters((f) => ({ ...f, commessa_id: v === "__all__" ? null : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Tutte</SelectItem>
                {(commesse as any[]).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.codice}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Stato</Label>
            <Select value={filters.stato ?? "__all__"} onValueChange={(v) => setFilters((f) => ({ ...f, stato: v === "__all__" ? null : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Tutti</SelectItem>
                {Object.entries(STATO_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Archiviati</Label>
            <Select value={filters.includeArchived ? "1" : "0"} onValueChange={(v) => setFilters((f) => ({ ...f, includeArchived: v === "1" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Nascondi</SelectItem>
                <SelectItem value="1">Mostra</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={() => setFilters({ includeArchived: false })}>Reset filtri</Button>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Autore</TableHead>
              <TableHead>Commessa</TableHead>
              <TableHead>Cantiere</TableHead>
              <TableHead>Fase</TableHead>
              <TableHead className="text-right">Ore</TableHead>
              <TableHead>Descrizione</TableHead>
              <TableHead>Stato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(items as any[]).map((r) => (
              <TableRow key={r.id} className={r.archived_at ? "opacity-60" : ""}>
                <TableCell>{dateIt(r.data)}</TableCell>
                <TableCell>{fullName(r.user)}</TableCell>
                <TableCell className="text-sm"><span className="font-mono">{r.commessa?.codice}</span><br /><span className="text-muted-foreground text-xs">{r.commessa?.denominazione}</span></TableCell>
                <TableCell className="text-xs">{r.cantiere ? `${r.cantiere.codice} — ${r.cantiere.nome}` : "—"}</TableCell>
                <TableCell className="text-xs">{r.fase?.titolo ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">
                  {Number(r.ore ?? 0).toFixed(2)}
                  {Number(r.ore ?? 0) > 16 && <Badge variant="outline" className="ml-2 text-amber-600 border-amber-400">Anomala</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-md truncate">{r.descrizione_lavori ?? r.lavorazione ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{STATO_LABEL[r.stato] ?? r.stato}</Badge>
                  {r.archived_at && <Badge variant="outline" className="ml-1">Archiviato</Badge>}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (items as any[]).length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nessun rapportino.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
