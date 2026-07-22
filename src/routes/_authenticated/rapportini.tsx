import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { dateIt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rapportini")({
  head: () => ({
    meta: [
      { title: "Rapportini — CantiereOS" },
      { name: "description", content: "Rapportini giornalieri dei dipendenti in cantiere." },
    ],
  }),
  component: RapportiniPage,
});

function RapportiniPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["rapportini"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rapportini").select("*, commesse(codice, denominazione)").order("data", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: commesse = [] } = useQuery({
    queryKey: ["commesse-lite"],
    queryFn: async () => (await supabase.from("commesse").select("id, codice, denominazione").order("codice", { ascending: false })).data ?? [],
  });

  const create = useMutation({
    mutationFn: async (payload: any) => {
      const { data: u } = await supabase.auth.getUser();
      const { data: p } = await supabase.from("profiles").select("organization_id").eq("id", u.user!.id).single();
      const { error } = await supabase.from("rapportini").insert({ ...payload, organization_id: p!.organization_id, user_id: u.user!.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rapportini"] }); setOpen(false); toast.success("Rapportino salvato"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("rapportini").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rapportini"] }); toast.success("Eliminato"); },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {};
    fd.forEach((v, k) => (payload[k] = v || null));
    if (payload.ore) payload.ore = Number(payload.ore);
    create.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        title="Rapportini"
        description={`${items.length} rapportini`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Nuovo rapportino</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuovo rapportino</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <div>
                  <Label>Cantiere</Label>
                  <Select name="commessa_id"><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{commesse.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.codice} — {c.denominazione}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Data *</Label><Input name="data" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
                  <div><Label>Ora inizio</Label><Input name="ora_inizio" type="time" /></div>
                  <div><Label>Ora fine</Label><Input name="ora_fine" type="time" /></div>
                </div>
                <div><Label>Ore totali *</Label><Input name="ore" type="number" step="0.5" required /></div>
                <div><Label>Lavorazione</Label><Input name="lavorazione" /></div>
                <div><Label>Note</Label><Textarea name="note" /></div>
                <DialogFooter><Button type="submit" disabled={create.isPending}>Salva</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Cantiere</TableHead>
              <TableHead>Lavorazione</TableHead>
              <TableHead className="hidden md:table-cell">Orario</TableHead>
              <TableHead className="text-right">Ore</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{dateIt(r.data)}</TableCell>
                <TableCell className="text-sm"><span className="font-mono">{r.commesse?.codice}</span><br /><span className="text-muted-foreground text-xs">{r.commesse?.denominazione}</span></TableCell>
                <TableCell>{r.lavorazione}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{r.ora_inizio?.slice(0,5)} - {r.ora_fine?.slice(0,5)}</TableCell>
                <TableCell className="text-right font-medium">{r.ore}h</TableCell>
                <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => confirm("Eliminare?") && del.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nessun rapportino.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
