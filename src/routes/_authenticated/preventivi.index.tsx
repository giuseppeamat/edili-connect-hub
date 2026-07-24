import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createPreventivo } from "@/lib/preventivi.functions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Search, X } from "lucide-react";
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

const STATI_OPTS = [
  "bozza", "in_revisione", "pronto", "inviato",
  "accettato", "rifiutato", "scaduto", "convertito", "annullato",
] as const;

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

  const [q, setQ] = useState("");
  const [stato, setStato] = useState<string>("tutti");
  const [clienteId, setClienteId] = useState<string>("tutti");
  const [soloCorrenti, setSoloCorrenti] = useState(true);

  const { data: items = [] } = useQuery({
    queryKey: ["preventivi"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("preventivi")
        .select("id, numero, versione, oggetto, titolo, data_preventivo, totale, totale_ricavo, margine, stato, is_current_version, cliente_id, clienti!preventivi_cliente_id_fkey(ragione_sociale, denominazione)")
        .order("data_preventivo", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: clienti = [] } = useQuery({
    queryKey: ["clienti-lite"],
    queryFn: async () => (await supabase.from("clienti").select("id, denominazione, ragione_sociale").order("denominazione")).data ?? [],
  });

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return items.filter((p) => {
      if (soloCorrenti && !p.is_current_version) return false;
      if (stato !== "tutti" && p.stato !== stato) return false;
      if (clienteId !== "tutti" && p.cliente_id !== clienteId) return false;
      if (qn) {
        const hay = [
          p.numero, p.oggetto, p.titolo,
          p.clienti?.denominazione, p.clienti?.ragione_sociale,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(qn)) return false;
      }
      return true;
    });
  }, [items, q, stato, clienteId, soloCorrenti]);

  const kpi = useMemo(() => {
    const acc = { count: filtered.length, valore: 0, accettati: 0, inviati: 0, bozze: 0 };
    for (const p of filtered) {
      acc.valore += Number(p.totale ?? 0);
      if (p.stato === "accettato" || p.stato === "convertito") acc.accettati += 1;
      if (p.stato === "inviato") acc.inviati += 1;
      if (p.stato === "bozza" || p.stato === "in_revisione" || p.stato === "pronto") acc.bozze += 1;
    }
    return acc;
  }, [filtered]);

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

  const resetFilters = () => { setQ(""); setStato("tutti"); setClienteId("tutti"); setSoloCorrenti(true); };
  const hasActiveFilters = q !== "" || stato !== "tutti" || clienteId !== "tutti" || !soloCorrenti;

  return (
    <div>
      <PageHeader
        title="Preventivi"
        description={`${filtered.length} di ${items.length} preventivi`}
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

      {/* KPI */}
      <div className="grid gap-3 md:grid-cols-4 mb-4">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Valore totale</div><div className="text-xl font-bold">{eur(kpi.valore)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">In lavorazione</div><div className="text-xl font-bold">{kpi.bozze}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Inviati</div><div className="text-xl font-bold">{kpi.inviati}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Accettati / convertiti</div><div className="text-xl font-bold">{kpi.accettati}</div></CardContent></Card>
      </div>

      {/* Filtri */}
      <Card className="mb-4">
        <CardContent className="pt-6 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <Label className="text-xs">Ricerca</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numero, oggetto, cliente…" className="pl-8" />
            </div>
          </div>
          <div className="min-w-[160px]">
            <Label className="text-xs">Stato</Label>
            <Select value={stato} onValueChange={setStato}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti</SelectItem>
                {STATI_OPTS.map((s) => <SelectItem key={s} value={s}>{statoLabel[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[200px]">
            <Label className="text-xs">Cliente</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti</SelectItem>
                {clienti.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.denominazione || c.ragione_sociale}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={soloCorrenti} onChange={(e) => setSoloCorrenti(e.target.checked)} />
            Solo versioni correnti
          </label>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="h-4 w-4 mr-1" />Reset
            </Button>
          )}
        </CardContent>
      </Card>

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
            {filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-sm">
                  {p.numero} <span className="text-muted-foreground text-xs">v{p.versione}</span>
                  {!p.is_current_version && <Badge variant="outline" className="ml-2 text-xs">superata</Badge>}
                </TableCell>
                <TableCell className="max-w-xs truncate">{p.titolo || p.oggetto}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {p.clienti?.denominazione || p.clienti?.ragione_sociale || "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell">{dateIt(p.data_preventivo)}</TableCell>
                <TableCell className="text-right font-medium">{eur(p.totale)}</TableCell>
                <TableCell className={`text-right hidden lg:table-cell ${(p.margine ?? 0) < 0 ? "text-destructive" : ""}`}>{eur(p.margine)}</TableCell>
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
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {items.length === 0 ? "Nessun preventivo." : "Nessun preventivo corrisponde ai filtri."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
