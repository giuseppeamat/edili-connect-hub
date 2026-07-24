import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createPreventivo } from "@/lib/preventivi.functions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil } from "lucide-react";
import { eur, dateIt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/preventivi/")({
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
  in_revisione: "In revisione",
  pronto: "Pronto",
  inviato: "Inviato",
  accettato: "Accettato",
  rifiutato: "Rifiutato",
  scaduto: "Scaduto",
  convertito: "Convertito",
  annullato: "Annullato",
};
const statoVariant: Record<string, any> = {
  bozza: "secondary",
  in_revisione: "outline",
  pronto: "outline",
  inviato: "default",
  accettato: "default",
  rifiutato: "destructive",
  scaduto: "outline",
  convertito: "default",
  annullato: "destructive",
};

function PreventiviPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const createFn = useServerFn(createPreventivo);

  const { data: items = [] } = useQuery({
    queryKey: ["preventivi"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("preventivi")
        .select("id, numero, versione, oggetto, titolo, data_preventivo, totale, margine, stato, is_current_version, cliente_id, clienti!preventivi_cliente_id_fkey(ragione_sociale, denominazione)")
        .order("data_preventivo", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: clienti = [] } = useQuery({
    queryKey: ["clienti-lite"],
    queryFn: async () => (await supabase.from("clienti").select("id, denominazione, ragione_sociale").order("denominazione")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async (payload: any) => createFn({ data: payload }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["preventivi"] });
      setOpen(false);
      toast.success(`Preventivo ${res.numero} creato`);
      navigate({ to: "/preventivi/$id", params: { id: res.id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Errore in creazione"),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {
      oggetto: String(fd.get("oggetto") || "").trim(),
      titolo: (fd.get("titolo") as string) || null,
      cliente_id: (fd.get("cliente_id") as string) || null,
      data_preventivo: (fd.get("data_preventivo") as string) || undefined,
    };
    if (!payload.oggetto) { toast.error("Oggetto obbligatorio"); return; }
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
                <div><Label>Oggetto *</Label><Input name="oggetto" required placeholder="Es. Ristrutturazione appartamento" /></div>
                <div><Label>Titolo</Label><Input name="titolo" placeholder="Titolo interno (opzionale)" /></div>
                <div>
                  <Label>Cliente</Label>
                  <Select name="cliente_id">
                    <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                    <SelectContent>
                      {clienti.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.denominazione || c.ragione_sociale}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Data</Label><Input name="data_preventivo" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
                <p className="text-xs text-muted-foreground">Il numero preventivo viene assegnato automaticamente.</p>
                <DialogFooter><Button type="submit" disabled={create.isPending}>Crea e apri</Button></DialogFooter>
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
                <TableCell className="font-mono text-sm">
                  {p.numero} <span className="text-muted-foreground text-xs">v{p.versione}</span>
                </TableCell>
                <TableCell className="max-w-xs truncate">{p.titolo || p.oggetto}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {p.clienti?.denominazione || p.clienti?.ragione_sociale || "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell">{dateIt(p.data_preventivo)}</TableCell>
                <TableCell className="text-right font-medium">{eur(p.totale)}</TableCell>
                <TableCell className="text-right hidden lg:table-cell">{eur(p.margine)}</TableCell>
                <TableCell><Badge variant={statoVariant[p.stato] ?? "secondary"}>{statoLabel[p.stato] ?? p.stato}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/preventivi/$id" params={{ id: p.id }}>
                      <Pencil className="h-4 w-4 mr-1" />Apri
                    </Link>
                  </Button>
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
