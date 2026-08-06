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
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/fornitori")({
  head: () => ({
    meta: [
      { title: "Fornitori — CantiereOS" },
      { name: "description", content: "Anagrafica fornitori e subappaltatori." },
    ],
  }),
  component: FornitoriPage,
});

const TIPO_LABEL: Record<string, string> = {
  fornitore: "Fornitore",
  subappaltatore: "Subappaltatore",
  entrambi: "Fornitore e subappaltatore",
};

function FornitoriPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [tipo, setTipo] = useState<string>("fornitore");


  const { data: items = [] } = useQuery({
    queryKey: ["fornitori"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fornitori").select("*").order("ragione_sociale");
      if (error) throw error;
      return data as any[];
    },
  });

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const { data: u } = await supabase.auth.getUser();
      const { data: p } = await supabase.from("profiles").select("organization_id").eq("id", u.user!.id).single();
      if (edit) {
        const { error } = await supabase.from("fornitori").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fornitori").insert({ ...payload, organization_id: p!.organization_id });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fornitori"] }); setOpen(false); setEdit(null); toast.success("Fornitore salvato"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("fornitori").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fornitori"] }); toast.success("Eliminato"); },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {};
    fd.forEach((v, k) => (payload[k] = v || null));
    payload.tipo_soggetto = tipo;
    save.mutate(payload);
  };

  const apri = (f: any | null) => {
    setEdit(f);
    setTipo(f?.tipo_soggetto ?? "fornitore");
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Fornitori e subappaltatori"
        description={`${items.length} soggetti in anagrafica`}
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => apri(null)}><Plus className="h-4 w-4 mr-1" />Nuovo soggetto</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{edit ? "Modifica soggetto" : "Nuovo soggetto"}</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3" key={edit?.id ?? "new"}>
                <div className="md:col-span-2"><Label>Ragione sociale *</Label><Input name="ragione_sociale" required defaultValue={edit?.ragione_sociale} /></div>
                <div className="md:col-span-2">
                  <Label>Tipologia soggetto *</Label>
                  <Select value={tipo} onValueChange={setTipo}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TIPO_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    I subappaltatori possono essere inseriti nei rapportini come ditte in cantiere.
                  </p>
                </div>
                <div><Label>Categoria</Label><Input name="categoria" placeholder="Materiali, Noleggio..." defaultValue={edit?.categoria ?? ""} /></div>
                <div><Label>P.IVA</Label><Input name="partita_iva" defaultValue={edit?.partita_iva ?? ""} /></div>
                <div><Label>Città</Label><Input name="citta" defaultValue={edit?.citta ?? ""} /></div>
                <div><Label>Provincia</Label><Input name="provincia" maxLength={2} defaultValue={edit?.provincia ?? ""} /></div>
                <div><Label>Telefono</Label><Input name="telefono" defaultValue={edit?.telefono ?? ""} /></div>
                <div><Label>Email</Label><Input name="email" type="email" defaultValue={edit?.email ?? ""} /></div>
                <div className="md:col-span-2"><Label>Referente</Label><Input name="referente" defaultValue={edit?.referente ?? ""} /></div>
                <div className="md:col-span-2"><Label>Specializzazioni</Label><Input name="specializzazioni" placeholder="Es. cartongesso, impianti elettrici" defaultValue={edit?.specializzazioni ?? ""} /></div>

                <DialogFooter className="md:col-span-2"><Button type="submit" disabled={save.isPending}>Salva</Button></DialogFooter>
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
              <TableHead>Categoria</TableHead>
              <TableHead className="hidden md:table-cell">P.IVA</TableHead>
              <TableHead className="hidden md:table-cell">Città</TableHead>
              <TableHead className="hidden lg:table-cell">Contatti</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.ragione_sociale}</TableCell>
                <TableCell>{f.categoria && <Badge variant="secondary">{f.categoria}</Badge>}</TableCell>
                <TableCell className="hidden md:table-cell">{f.partita_iva}</TableCell>
                <TableCell className="hidden md:table-cell">{f.citta}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs">{f.email}<br />{f.telefono}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEdit(f); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => confirm("Eliminare?") && del.mutate(f.id)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nessun fornitore.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
