import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, HardHat } from "lucide-react";
import { eur, dateIt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/preventivi")({
  head: () => ({
    meta: [
      { title: "Preventivi — CantiereOS" },
      { name: "description", content: "Preventivi in bozza, inviati e accettati." },
    ],
  }),
  component: PreventiviPage,
});

const statoLabel: Record<string, string> = {
  bozza: "Bozza",
  inviato: "Inviato",
  accettato: "Accettato",
  rifiutato: "Rifiutato",
  scaduto: "Scaduto",
};
const statoVariant: Record<string, any> = {
  bozza: "secondary",
  inviato: "default",
  accettato: "default",
  rifiutato: "destructive",
  scaduto: "outline",
};

function PreventiviPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["preventivi"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("preventivi")
        .select("*, clienti(ragione_sociale)")
        .order("data_preventivo", { ascending: false });
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
      const { error } = await supabase.from("preventivi").insert({ ...payload, organization_id: p!.organization_id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["preventivi"] }); setOpen(false); toast.success("Preventivo creato"); },
    onError: (e: any) => toast.error(e.message),
  });

  const toCommessa = useMutation({
    mutationFn: async (p: any) => {
      const { data: u } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("organization_id").eq("id", u.user!.id).single();
      const codice = `C${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
      const { error } = await supabase.from("commesse").insert({
        organization_id: prof!.organization_id,
        cliente_id: p.cliente_id,
        preventivo_id: p.id,
        codice,
        denominazione: p.oggetto,
        importo: p.totale_ricavo ?? p.totale,
        budget_costi: p.totale_costo,
        data_inizio: new Date().toISOString().slice(0, 10),
        stato: "pianificata" as const,
      });
      if (error) throw error;
      await supabase.from("preventivi").update({ stato: "accettato" }).eq("id", p.id);
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Commessa creata dal preventivo"); },
    onError: (e: any) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {};
    fd.forEach((v, k) => (payload[k] = v || null));
    create.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        title="Preventivi"
        description={`${items.length} preventivi`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Nuovo preventivo</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuovo preventivo</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <div><Label>Numero *</Label><Input name="numero" required placeholder={`${new Date().getFullYear()}/001`} /></div>
                <div><Label>Oggetto *</Label><Input name="oggetto" required /></div>
                <div>
                  <Label>Cliente</Label>
                  <Select name="cliente_id"><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                    <SelectContent>{clienti.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Data</Label><Input name="data_preventivo" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
                <DialogFooter><Button type="submit" disabled={create.isPending}>Crea</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numero</TableHead>
              <TableHead>Oggetto</TableHead>
              <TableHead className="hidden md:table-cell">Cliente</TableHead>
              <TableHead className="hidden md:table-cell">Data</TableHead>
              <TableHead className="text-right">Totale</TableHead>
              <TableHead className="text-right hidden lg:table-cell">Margine</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-sm">{p.numero} <span className="text-muted-foreground text-xs">v{p.versione}</span></TableCell>
                <TableCell className="max-w-xs truncate">{p.oggetto}</TableCell>
                <TableCell className="hidden md:table-cell">{p.clienti?.ragione_sociale}</TableCell>
                <TableCell className="hidden md:table-cell">{dateIt(p.data_preventivo)}</TableCell>
                <TableCell className="text-right font-medium">{eur(p.totale)}</TableCell>
                <TableCell className="text-right hidden lg:table-cell">{eur(p.margine)}</TableCell>
                <TableCell><Badge variant={statoVariant[p.stato]}>{statoLabel[p.stato]}</Badge></TableCell>
                <TableCell className="text-right">
                  {p.stato !== "accettato" && (
                    <Button size="sm" variant="ghost" onClick={() => confirm("Trasforma in commessa?") && toCommessa.mutate(p)}>
                      <HardHat className="h-4 w-4 mr-1" />Commessa
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nessun preventivo.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
