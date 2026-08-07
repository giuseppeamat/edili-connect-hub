import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Pencil, Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GRUPPI_LABELS, GRUPPI_OPTIONS } from "@/lib/costi-struttura";
import { saveCategoriaStruttura, archiveCategoriaStruttura } from "@/lib/costi-struttura.functions";

type Categoria = {
  id: string;
  gruppo: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
  is_sistema: boolean;
  is_active: boolean;
};

export function CategorieTab({ categorie, canWrite }: { categorie: Categoria[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveCategoriaStruttura);
  const archFn = useServerFn(archiveCategoriaStruttura);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ id: null as string | null, gruppo: "ALTRO", nome: "", descrizione: "", ordine: "500" });

  const grouped = useMemo(() => {
    const m = new Map<string, Categoria[]>();
    for (const c of categorie) {
      const arr = m.get(c.gruppo) ?? [];
      arr.push(c);
      m.set(c.gruppo, arr);
    }
    return [...m.entries()];
  }, [categorie]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["costi-struttura"] });

  const save = useMutation({
    mutationFn: async () =>
      saveFn({
        data: {
          id: form.id ?? undefined,
          gruppo: form.gruppo,
          nome: form.nome.trim(),
          descrizione: form.descrizione || null,
          ordine: Number(form.ordine || 500),
        },
      }),
    onSuccess: () => { setOpen(false); invalidate(); toast.success("Categoria salvata"); },
    onError: (e: any) => toast.error(e.message),
  });

  const archivia = useMutation({
    mutationFn: async (id: string) => archFn({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Categoria archiviata"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Categorie di costo</CardTitle>
        {canWrite && (
          <Button
            onClick={() => {
              setForm({ id: null, gruppo: "ALTRO", nome: "", descrizione: "", ordine: "500" });
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Nuova categoria
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {grouped.map(([gruppo, items]) => (
          <div key={gruppo}>
            <h3 className="text-sm font-semibold mb-2">{GRUPPI_LABELS[gruppo] ?? gruppo}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead className="w-24">Origine</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.descrizione ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={c.is_sistema ? "secondary" : "outline"}>
                        {c.is_sistema ? "Standard" : "Personalizzata"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {canWrite && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setForm({
                                id: c.id,
                                gruppo: c.gruppo,
                                nome: c.nome,
                                descrizione: c.descrizione ?? "",
                                ordine: String(c.ordine),
                              });
                              setOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => archivia.mutate(c.id)}>
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Modifica categoria" : "Nuova categoria"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Gruppo</Label>
              <Select value={form.gruppo} onValueChange={(v) => setForm({ ...form, gruppo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GRUPPI_OPTIONS.map((g) => (
                    <SelectItem key={g} value={g}>{GRUPPI_LABELS[g]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Descrizione</Label>
              <Input value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} />
            </div>
            <div>
              <Label>Ordine</Label>
              <Input type="number" value={form.ordine} onChange={(e) => setForm({ ...form, ordine: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || form.nome.trim().length < 2}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
