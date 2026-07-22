import { createFileRoute } from "@tanstack/react-router";
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
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clienti")({
  head: () => ({
    meta: [
      { title: "Clienti — CantiereOS" },
      { name: "description", content: "Anagrafica clienti dell'impresa." },
    ],
  }),
  component: ClientiPage,
});

type Cliente = {
  id: string;
  ragione_sociale: string;
  partita_iva: string | null;
  citta: string | null;
  provincia: string | null;
  email: string | null;
  telefono: string | null;
  referente: string | null;
};

function ClientiPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Cliente | null>(null);

  const { data: clienti = [] } = useQuery({
    queryKey: ["clienti"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clienti").select("*").order("ragione_sociale");
      if (error) throw error;
      return data as Cliente[];
    },
  });

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const { data: u } = await supabase.auth.getUser();
      const { data: p } = await supabase.from("profiles").select("organization_id").eq("id", u.user!.id).single();
      const body = { ...payload, organization_id: p!.organization_id };
      if (edit) {
        const { error } = await supabase.from("clienti").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clienti").insert(body);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clienti"] });
      setOpen(false);
      setEdit(null);
      toast.success("Cliente salvato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clienti").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clienti"] });
      toast.success("Cliente eliminato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {};
    fd.forEach((v, k) => (payload[k] = v || null));
    save.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        title="Clienti"
        description={`${clienti.length} clienti in anagrafica`}
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" />Nuovo cliente</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{edit ? "Modifica cliente" : "Nuovo cliente"}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2"><Label>Ragione sociale *</Label><Input name="ragione_sociale" required defaultValue={edit?.ragione_sociale} /></div>
                <div><Label>P.IVA</Label><Input name="partita_iva" defaultValue={edit?.partita_iva ?? ""} /></div>
                <div><Label>Codice fiscale</Label><Input name="codice_fiscale" /></div>
                <div><Label>Indirizzo</Label><Input name="indirizzo" /></div>
                <div><Label>Città</Label><Input name="citta" defaultValue={edit?.citta ?? ""} /></div>
                <div><Label>CAP</Label><Input name="cap" /></div>
                <div><Label>Provincia</Label><Input name="provincia" maxLength={2} defaultValue={edit?.provincia ?? ""} /></div>
                <div><Label>Telefono</Label><Input name="telefono" defaultValue={edit?.telefono ?? ""} /></div>
                <div><Label>Email</Label><Input name="email" type="email" defaultValue={edit?.email ?? ""} /></div>
                <div><Label>PEC</Label><Input name="pec" type="email" /></div>
                <div><Label>Referente</Label><Input name="referente" defaultValue={edit?.referente ?? ""} /></div>
                <DialogFooter className="md:col-span-2">
                  <Button type="submit" disabled={save.isPending}>Salva</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ragione sociale</TableHead>
              <TableHead className="hidden md:table-cell">P.IVA</TableHead>
              <TableHead className="hidden md:table-cell">Città</TableHead>
              <TableHead className="hidden lg:table-cell">Referente</TableHead>
              <TableHead className="hidden lg:table-cell">Contatti</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clienti.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.ragione_sociale}</TableCell>
                <TableCell className="hidden md:table-cell">{c.partita_iva}</TableCell>
                <TableCell className="hidden md:table-cell">{c.citta} {c.provincia && `(${c.provincia})`}</TableCell>
                <TableCell className="hidden lg:table-cell">{c.referente}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs">{c.email}<br />{c.telefono}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEdit(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => confirm("Eliminare?") && del.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {clienti.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nessun cliente. Aggiungine uno o carica i dati demo dalla Dashboard.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
