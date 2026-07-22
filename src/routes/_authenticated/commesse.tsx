import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MapPin, Calendar } from "lucide-react";
import { eur, dateIt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/commesse")({
  head: () => ({
    meta: [
      { title: "Commesse e cantieri — CantiereOS" },
      { name: "description", content: "Commesse attive, budget, avanzamento e stato dei cantieri." },
    ],
  }),
  component: CommessePage,
});

const stati = ["pianificata", "in_corso", "sospesa", "completata", "annullata"];
const statoLabel: Record<string, string> = {
  pianificata: "Pianificata",
  in_corso: "In corso",
  sospesa: "Sospesa",
  completata: "Completata",
  annullata: "Annullata",
};

function CommessePage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["commesse"],
    queryFn: async () => {
      const { data, error } = await supabase.from("commesse").select("*, clienti(ragione_sociale)").order("data_inizio", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: clienti = [] } = useQuery({
    queryKey: ["clienti-lite"],
    queryFn: async () => (await supabase.from("clienti").select("id, ragione_sociale").order("ragione_sociale")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async (payload: any) => {
      const { data: u } = await supabase.auth.getUser();
      const { data: p } = await supabase.from("profiles").select("organization_id").eq("id", u.user!.id).single();
      const { error } = await supabase.from("commesse").insert({ ...payload, organization_id: p!.organization_id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commesse"] }); setOpen(false); toast.success("Commessa creata"); },
    onError: (e: any) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {};
    fd.forEach((v, k) => (payload[k] = v || null));
    if (payload.importo) payload.importo = Number(payload.importo);
    if (payload.budget_costi) payload.budget_costi = Number(payload.budget_costi);
    create.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        title="Commesse e cantieri"
        description={`${items.length} commesse`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Nuova commessa</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Nuova commessa</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Codice *</Label><Input name="codice" required /></div>
                <div>
                  <Label>Cliente</Label>
                  <Select name="cliente_id"><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{clienti.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2"><Label>Denominazione *</Label><Input name="denominazione" required /></div>
                <div className="md:col-span-2"><Label>Indirizzo cantiere</Label><Input name="indirizzo_cantiere" /></div>
                <div><Label>Data inizio</Label><Input name="data_inizio" type="date" /></div>
                <div><Label>Data fine prevista</Label><Input name="data_fine_prevista" type="date" /></div>
                <div><Label>Importo (€)</Label><Input name="importo" type="number" step="0.01" /></div>
                <div><Label>Budget costi (€)</Label><Input name="budget_costi" type="number" step="0.01" /></div>
                <div>
                  <Label>Stato</Label>
                  <Select name="stato" defaultValue="pianificata"><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{stati.map((s) => <SelectItem key={s} value={s}>{statoLabel[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <DialogFooter className="md:col-span-2"><Button type="submit" disabled={create.isPending}>Crea</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((c) => (
          <Card key={c.id}>
            <CardContent className="p-5 space-y-3">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground font-mono">{c.codice}</div>
                  <div className="font-semibold truncate">{c.denominazione}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.clienti?.ragione_sociale}</div>
                </div>
                <Badge variant={c.stato === "in_corso" ? "default" : "secondary"}>{statoLabel[c.stato]}</Badge>
              </div>
              {c.indirizzo_cantiere && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />{c.indirizzo_cantiere}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />{dateIt(c.data_inizio)} → {dateIt(c.data_fine_prevista)}
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Avanzamento</span><span className="font-medium">{Number(c.avanzamento_pct)}%</span>
                </div>
                <Progress value={Number(c.avanzamento_pct)} />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center">
                <div><div className="text-xs text-muted-foreground">Importo</div><div className="font-semibold text-sm">{eur(c.importo)}</div></div>
                <div><div className="text-xs text-muted-foreground">Costi</div><div className="font-semibold text-sm">{eur(c.costi_sostenuti)}</div></div>
                <div><div className="text-xs text-muted-foreground">Budget</div><div className="font-semibold text-sm">{eur(c.budget_costi)}</div></div>
              </div>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <div className="text-center text-muted-foreground py-8 col-span-full">Nessuna commessa.</div>}
      </div>
    </div>
  );
}
