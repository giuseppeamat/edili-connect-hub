import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { dateIt } from "@/lib/format";
import { rapportiniKeys, type RapportinoFilters } from "@/lib/rapportini.keys";
import { listRapportini, listRapportinoAssignableCommesse, archiveRapportino } from "@/lib/rapportini.functions";
import { NewRapportinoDialog } from "@/components/commesse/rapportini-tab";
import { RapportinoActionsMenu, StatoBadge } from "@/components/rapportini/actions-menu";
import { STATO_LABEL } from "@/lib/rapportini.permissions";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";

const searchSchema = z.object({
  stato: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/rapportini/")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Rapportini — CantiereOS" },
      { name: "description", content: "Rapportini giornalieri dei dipendenti in cantiere." },
    ],
  }),
  component: RapportiniPage,
});

function fullName(r: any) {
  if (!r) return "—";
  const s = [r?.nome, r?.cognome].filter(Boolean).join(" ").trim();
  return s || r?.email || "Utente";
}

function RapportiniPage() {
  const qc = useQueryClient();
  const { stato: statoParam } = Route.useSearch();
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<RapportinoFilters>({
    includeArchived: false,
    stato: statoParam || null,
  });
  const [archTarget, setArchTarget] = useState<any | null>(null);
  const [archMotivo, setArchMotivo] = useState("");

  const listFn = useServerFn(listRapportini);
  const commesseFn = useServerFn(listRapportinoAssignableCommesse);
  const archFn = useServerFn(archiveRapportino);

  const { data: items = [], isLoading } = useQuery({
    queryKey: rapportiniKeys.list(filters),
    queryFn: async () => await listFn({ data: filters as any }),
  });
  const { data: commesse = [] } = useQuery({
    queryKey: rapportiniKeys.assignable.commesse(),
    queryFn: async () => await commesseFn(),
  });

  const totalOre = useMemo(() => (items as any[]).reduce((s, r) => s + Number(r.ore ?? 0), 0), [items]);

  const arch = useMutation({
    mutationFn: async () => await archFn({ data: {
      id: archTarget.id, expected_updated_at: archTarget.updated_at, motivazione: archMotivo.trim(),
    } }),
    onSuccess: () => {
      toast.success("Rapportino archiviato");
      qc.invalidateQueries({ queryKey: rapportiniKeys.all });
      setArchTarget(null); setArchMotivo("");
    },
    onError: (e: any) => toast.error(e.message),
  });

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
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(items as any[]).map((r) => (
              <TableRow
                key={r.id}
                className={`${r.archived_at ? "opacity-60" : ""} hover:bg-muted/40`}
              >
                <TableCell>
                  <Link
                    to="/rapportini/$rapportinoId"
                    params={{ rapportinoId: r.id }}
                    className="block font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {dateIt(r.data)}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link
                    to="/rapportini/$rapportinoId"
                    params={{ rapportinoId: r.id }}
                    className="block text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {fullName(r.user)}
                  </Link>
                </TableCell>
                <TableCell className="text-sm"><span className="font-mono">{r.commessa?.codice}</span><br /><span className="text-muted-foreground text-xs">{r.commessa?.denominazione}</span></TableCell>
                <TableCell className="text-xs">{r.cantiere ? `${r.cantiere.codice} — ${r.cantiere.nome}` : "—"}</TableCell>
                <TableCell className="text-xs">{r.fase?.titolo ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">
                  {Number(r.ore ?? 0).toFixed(2)}
                  {Number(r.ore ?? 0) > 16 && <Badge variant="outline" className="ml-2 text-amber-600 border-amber-400">Anomala</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-md">
                  <Link
                    to="/rapportini/$rapportinoId"
                    params={{ rapportinoId: r.id }}
                    className="block truncate text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {r.descrizione_lavori ?? r.lavorazione ?? "—"}
                  </Link>
                  {r.stato === "respinto" && r.rejection_reason && (
                    <div className="text-xs text-rose-700 mt-1">Rifiuto: {r.rejection_reason}</div>
                  )}
                  {r.stato === "annullato" && r.cancellation_reason && (
                    <div className="text-xs text-zinc-600 mt-1">Annullato: {r.cancellation_reason}</div>
                  )}
                  {r.stato === "approvato" && r.approved_at && (
                    <div className="text-xs text-emerald-700 mt-1">Approvato il {dateIt(r.approved_at)}</div>
                  )}
                </TableCell>
                <TableCell><StatoBadge stato={r.stato} archived={!!r.archived_at} /></TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <RapportinoActionsMenu row={r} onArchive={(row) => setArchTarget(row)} />
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (items as any[]).length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nessun rapportino.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!archTarget} onOpenChange={(v) => { if (!v) { setArchTarget(null); setArchMotivo(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archivia rapportino</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Motivazione *</Label>
            <Textarea value={archMotivo} onChange={(e) => setArchMotivo(e.target.value)} placeholder="Motivo dell'archiviazione…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchTarget(null)}>Chiudi</Button>
            <Button disabled={!archMotivo.trim() || arch.isPending} onClick={() => arch.mutate()}>Archivia</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

