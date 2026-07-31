import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, Trash2, Download } from "lucide-react";
import { dateIt } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/documenti")({
  head: () => ({
    meta: [
      { title: "Documenti — CantiereOS" },
      { name: "description", content: "Archivio documentale: certificazioni, contratti, POS, DURC." },
    ],
  }),
  component: DocumentiPage,
});

const statoVariant: Record<string, any> = { valido: "default", in_scadenza: "secondary", scaduto: "destructive", archiviato: "outline" };
const statoLabel: Record<string, string> = { valido: "Valido", in_scadenza: "In scadenza", scaduto: "Scaduto", archiviato: "Archiviato" };

function DocumentiPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["documenti"],
    queryFn: async () => (await supabase.from("documenti").select("*").order("data_scadenza", { ascending: true, nullsFirst: false })).data ?? [],
  });

  const del = useMutation({
    mutationFn: async (row: any) => {
      if (row.storage_path) await supabase.storage.from("documenti").remove([row.storage_path]);
      const { error } = await supabase.from("documenti").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["documenti"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Eliminato"); },
  });

  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File | null;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { data: p } = await supabase.from("profiles").select("organization_id").eq("id", u.user!.id).single();
      const org = p!.organization_id;
      let storage_path: string | null = null;
      let mime: string | null = null;
      let size: number | null = null;
      if (file && file.size > 0) {
        storage_path = `${org}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("documenti").upload(storage_path, file);
        if (upErr) throw upErr;
        mime = file.type;
        size = file.size;
      }
      const payload: any = {
        organization_id: org,
        uploaded_by: u.user!.id,
        nome: fd.get("nome"),
        categoria: fd.get("categoria") || null,
        data_documento: fd.get("data_documento") || null,
        data_scadenza: fd.get("data_scadenza") || null,
        storage_path,
        mime_type: mime,
        size_bytes: size,
      };
      const { error } = await supabase.from("documenti").insert(payload);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["documenti"] }); qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      toast.success("Documento caricato");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const download = async (row: any) => {
    if (!row.storage_path) return;
    const { data, error } = await supabase.storage.from("documenti").createSignedUrl(row.storage_path, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div>
      <PageHeader
        title="Documenti"
        description={`${items.length} documenti archiviati`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Upload className="h-4 w-4 mr-1" />Nuovo documento</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Carica documento</DialogTitle></DialogHeader>
              <form onSubmit={upload} className="space-y-3">
                <div><Label>Nome *</Label><Input name="nome" required /></div>
                <div><Label>Categoria</Label><Input name="categoria" placeholder="Certificazione, Contratto, Sicurezza..." /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Data documento</Label><Input name="data_documento" type="date" /></div>
                  <div><Label>Scadenza</Label><Input name="data_scadenza" type="date" /></div>
                </div>
                <div><Label>File</Label><Input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" /></div>
                <DialogFooter><Button type="submit" disabled={uploading}>{uploading ? "Caricamento..." : "Carica"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="hidden md:table-cell">Categoria</TableHead>
              <TableHead className="hidden md:table-cell">Documento</TableHead>
              <TableHead>Scadenza</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((d: any) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.nome}</TableCell>
                <TableCell className="hidden md:table-cell">{d.categoria}</TableCell>
                <TableCell className="hidden md:table-cell">{dateIt(d.data_documento)}</TableCell>
                <TableCell>{dateIt(d.data_scadenza)}</TableCell>
                <TableCell><Badge variant={statoVariant[d.stato]}>{statoLabel[d.stato]}</Badge></TableCell>
                <TableCell className="text-right">
                  {d.storage_path && <Button size="icon" variant="ghost" onClick={() => download(d)}><Download className="h-4 w-4" /></Button>}
                  <Button size="icon" variant="ghost" onClick={() => confirm("Eliminare?") && del.mutate(d)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nessun documento.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
