import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MapPin, Calendar, Archive, ArchiveRestore } from "lucide-react";
import { eur, dateIt } from "@/lib/format";
import { toast } from "sonner";
import { useCurrentRole } from "@/hooks/use-current-role";
import { createCommessa, archiveCommessa, restoreCommessa } from "@/lib/commesse.functions";

export const Route = createFileRoute("/_authenticated/commesse")({
  head: () => ({
    meta: [
      { title: "Commesse e cantieri — CantiereOS" },
      { name: "description", content: "Commesse attive, budget, avanzamento e stato dei cantieri." },
    ],
  }),
  component: CommessePage,
});

const statoLabel: Record<string, string> = {
  pianificata: "Pianificata", in_corso: "In corso", sospesa: "Sospesa",
  completata: "Completata", annullata: "Annullata",
};
const TIPOLOGIE = [
  ["ristrutturazione", "Ristrutturazione"], ["nuova_costruzione", "Nuova costruzione"],
  ["manutenzione", "Manutenzione"], ["impiantistica", "Impiantistica"],
  ["riqualificazione", "Riqualificazione"], ["demolizione", "Demolizione"],
  ["fornitura_posa", "Fornitura e posa"], ["altro", "Altro"],
] as const;
const PRIORITA = [["bassa", "Bassa"], ["normale", "Normale"], ["alta", "Alta"], ["urgente", "Urgente"]] as const;

function CommessePage() {
  const qc = useQueryClient();
  const role = useCurrentRole();
  const canCreate = role.canEditPreventivi; // proprietario/amministratore/ufficio_tecnico
  const canArchive = role.isAdmin;
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const createFn = useServerFn(createCommessa);
  const archiveFn = useServerFn(archiveCommessa);
  const restoreFn = useServerFn(restoreCommessa);

  const { data: items = [] } = useQuery({
    queryKey: ["commesse", showArchived],
    queryFn: async () => {
      let q = supabase.from("commesse")
        .select("*, clienti!commesse_cliente_id_fkey(ragione_sociale)")
        .order("data_inizio_prevista", { ascending: false, nullsFirst: false });
      if (!showArchived) q = q.is("archived_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: clienti = [] } = useQuery({
    queryKey: ["clienti-lite"],
    queryFn: async () => (await supabase.from("clienti").select("id, ragione_sociale").order("ragione_sociale")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async (payload: any) => await createFn({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commesse"] });
      setOpen(false);
      toast.success("Commessa creata");
    },
    onError: (e: any) => toast.error(e.message ?? "Errore creazione"),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const motivazione = window.prompt("Motivazione archiviazione:") ?? "";
      if (!motivazione.trim()) throw new Error("Motivazione obbligatoria");
      return await archiveFn({ data: { id, motivazione } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commesse"] }); toast.success("Commessa archiviata"); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  const restore = useMutation({
    mutationFn: async (id: string) => await restoreFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commesse"] }); toast.success("Commessa ripristinata"); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => (fd.get(k) as string) || "";
    const payload: any = {
      cliente_id: g("cliente_id"),
      titolo: g("titolo"),
      descrizione: g("descrizione") || null,
      tipologia: g("tipologia") || null,
      priorita: g("priorita") || "normale",
      responsabile_id: g("responsabile_id") || null,
      indirizzo_cantiere: g("indirizzo_cantiere") || null,
      data_apertura: g("data_apertura") || null,
      data_inizio_prevista: g("data_inizio_prevista") || null,
      data_fine_prevista: g("data_fine_prevista") || null,
      importo_contratto: g("importo_contratto") ? Number(g("importo_contratto")) : null,
      costi_previsti: g("costi_previsti") ? Number(g("costi_previsti")) : null,
      note_interne: g("note_interne") || null,
    };
    if (!payload.cliente_id) return toast.error("Cliente obbligatorio");
    if (!payload.titolo) return toast.error("Titolo obbligatorio");
    create.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        title="Commesse e cantieri"
        description={`${items.length} commesse${showArchived ? " (incluse archiviate)" : ""}`}
        actions={
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="show-arch" checked={showArchived} onCheckedChange={setShowArchived} />
              <Label htmlFor="show-arch" className="text-sm">Mostra archiviate</Label>
            </div>
            {canCreate && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Nuova commessa</Button></DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>Nuova commessa</DialogTitle></DialogHeader>
                  <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2"><Label>Titolo *</Label><Input name="titolo" required /></div>
                    <div className="md:col-span-2">
                      <Label>Cliente *</Label>
                      <Select name="cliente_id" required>
                        <SelectTrigger><SelectValue placeholder="Seleziona cliente" /></SelectTrigger>
                        <SelectContent>{clienti.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Tipologia</Label>
                      <Select name="tipologia">
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>{TIPOLOGIE.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Priorità</Label>
                      <Select name="priorita" defaultValue="normale">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{PRIORITA.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2"><Label>Descrizione</Label><Textarea name="descrizione" rows={2} /></div>
                    <div className="md:col-span-2"><Label>Indirizzo cantiere</Label><Input name="indirizzo_cantiere" /></div>
                    <div><Label>Data apertura</Label><Input name="data_apertura" type="date" /></div>
                    <div><Label>Data inizio prevista</Label><Input name="data_inizio_prevista" type="date" /></div>
                    <div><Label>Data fine prevista</Label><Input name="data_fine_prevista" type="date" /></div>
                    <div />
                    <div><Label>Importo contratto (€)</Label><Input name="importo_contratto" type="number" step="0.01" min="0" /></div>
                    <div><Label>Costi previsti (€)</Label><Input name="costi_previsti" type="number" step="0.01" min="0" /></div>
                    <div className="md:col-span-2"><Label>Note interne</Label><Textarea name="note_interne" rows={2} /></div>
                    <DialogFooter className="md:col-span-2"><Button type="submit" disabled={create.isPending}>Crea</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((c) => {
          const titolo = c.titolo ?? c.denominazione;
          const importo = c.importo_contratto ?? c.importo;
          const costi = c.costi_previsti ?? c.budget_costi;
          const dataInizio = c.data_inizio_prevista ?? c.data_inizio;
          const isArchived = !!c.archived_at;
          return (
            <Card key={c.id} className={isArchived ? "opacity-60" : ""}>
              <CardContent className="p-5 space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground font-mono">{c.codice}</div>
                    <div className="font-semibold truncate">{titolo}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.clienti?.ragione_sociale}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={c.stato === "in_corso" ? "default" : "secondary"}>{statoLabel[c.stato]}</Badge>
                    {isArchived && <Badge variant="outline">Archiviata</Badge>}
                  </div>
                </div>
                {c.indirizzo_cantiere && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />{c.indirizzo_cantiere}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {dataInizio ? dateIt(dataInizio) : "—"} → {c.data_fine_prevista ? dateIt(c.data_fine_prevista) : "—"}
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Avanzamento</span><span className="font-medium">{Number(c.avanzamento_pct)}%</span>
                  </div>
                  <Progress value={Number(c.avanzamento_pct)} />
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center">
                  <div><div className="text-xs text-muted-foreground">Importo</div><div className="font-semibold text-sm">{importo != null ? eur(importo) : "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Costi</div><div className="font-semibold text-sm">{c.costi_sostenuti != null ? eur(c.costi_sostenuti) : "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Budget</div><div className="font-semibold text-sm">{costi != null ? eur(costi) : "—"}</div></div>
                </div>
                {canArchive && (
                  <div className="pt-2 border-t flex justify-end">
                    {isArchived ? (
                      <Button size="sm" variant="ghost" onClick={() => restore.mutate(c.id)} disabled={restore.isPending}>
                        <ArchiveRestore className="h-4 w-4 mr-1" />Ripristina
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => archive.mutate(c.id)} disabled={archive.isPending}>
                        <Archive className="h-4 w-4 mr-1" />Archivia
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {items.length === 0 && <div className="text-center text-muted-foreground py-8 col-span-full">Nessuna commessa.</div>}
      </div>
    </div>
  );
}
