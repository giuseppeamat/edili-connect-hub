import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Archive, RotateCcw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-current-user";
import { archiveCliente, restoreCliente } from "@/lib/crm.functions";
import { ClienteForm } from "@/components/crm/cliente-form";

export const Route = createFileRoute("/_authenticated/clienti/")({
  head: () => ({
    meta: [
      { title: "Clienti — CantiereOS" },
      { name: "description", content: "CRM clienti: anagrafica, contatti, attività e storico relazioni." },
    ],
  }),
  component: ClientiPage,
});

const STATO_LABEL: Record<string, string> = {
  potenziale: "Potenziale",
  attivo: "Attivo",
  inattivo: "Inattivo",
  archiviato: "Archiviato",
};
const STATO_VARIANT: Record<string, any> = {
  potenziale: "secondary",
  attivo: "default",
  inattivo: "outline",
  archiviato: "outline",
};
const TIPO_LABEL: Record<string, string> = {
  persona_fisica: "Persona",
  azienda: "Azienda",
  condominio: "Condominio",
  ente: "Ente / PA",
  altro: "Altro",
};

function ClientiPage() {
  const qc = useQueryClient();
  const { canManageAnagrafiche, canDeleteBusinessData } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("__all");
  const [filtroStato, setFiltroStato] = useState<string>("__attivi");
  const [filtroCitta, setFiltroCitta] = useState("");
  const archiveFn = useServerFn(archiveCliente);
  const restoreFn = useServerFn(restoreCliente);

  const { data: clienti = [] } = useQuery({
    queryKey: ["clienti", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clienti")
        .select("id, denominazione, tipo, stato_cliente, citta, provincia, email, telefono, cellulare, partita_iva, codice_fiscale, responsabile_id, archived_at, created_at, updated_at")
        .order("denominazione")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const { data: attivita = [] } = useQuery({
    queryKey: ["clienti", "attivita-open"],
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_attivita")
        .select("cliente_id, scadenza, stato, data_attivita, tipo, titolo")
        .in("stato", ["pianificata"])
        .order("scadenza", { ascending: true, nullsFirst: false })
        .limit(500);
      return data ?? [];
    },
  });

  const attByCliente = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of attivita) {
      const arr = m.get(a.cliente_id) ?? [];
      arr.push(a);
      m.set(a.cliente_id, arr);
    }
    return m;
  }, [attivita]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (clienti ?? []).filter((c: any) => {
      if (filtroStato === "__attivi" && c.archived_at) return false;
      if (filtroStato === "__archiviati" && !c.archived_at) return false;
      if (filtroStato !== "__attivi" && filtroStato !== "__archiviati" && filtroStato !== "__all" && c.stato_cliente !== filtroStato) return false;
      if (filtroTipo !== "__all" && c.tipo !== filtroTipo) return false;
      if (filtroCitta && !(c.citta ?? "").toLowerCase().includes(filtroCitta.toLowerCase())) return false;
      if (!ql) return true;
      const hay = [c.denominazione, c.email, c.telefono, c.cellulare, c.partita_iva, c.codice_fiscale, c.citta].join(" ").toLowerCase();
      return hay.includes(ql);
    });
  }, [clienti, q, filtroTipo, filtroStato, filtroCitta]);

  const kpi = useMemo(() => {
    const now = Date.now();
    const soon = now + 1000 * 60 * 60 * 24 * 7;
    return {
      attivi: clienti.filter((c: any) => !c.archived_at && c.stato_cliente === "attivo").length,
      potenziali: clienti.filter((c: any) => !c.archived_at && c.stato_cliente === "potenziale").length,
      archiviati: clienti.filter((c: any) => !!c.archived_at).length,
      inScadenza: attivita.filter((a: any) => a.scadenza && new Date(a.scadenza).getTime() <= soon).length,
    };
  }, [clienti, attivita]);

  const onArchive = async (id: string, denom: string) => {
    if (!confirm(`Archiviare "${denom}"?\n\nIl cliente verrà rimosso dagli elenchi attivi, ma preventivi, commesse, documenti e storico resteranno disponibili.`)) return;
    try {
      await archiveFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["clienti"] });
      toast.success("Cliente archiviato");
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };
  const onRestore = async (id: string) => {
    try {
      await restoreFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["clienti"] });
      toast.success("Cliente ripristinato");
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  return (
    <div>
      <PageHeader
        title="Clienti"
        description="CRM: anagrafica, contatti e storico relazioni"
        actions={
          canManageAnagrafiche ? (
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Nuovo cliente</Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Attivi" value={kpi.attivi} />
        <KpiCard label="Potenziali" value={kpi.potenziali} />
        <KpiCard label="Archiviati" value={kpi.archiviati} />
        <KpiCard label="Attività in scadenza (7 gg)" value={kpi.inScadenza} />
      </div>

      <Card className="p-3 mb-4">
        <div className="grid gap-2 md:grid-cols-[1fr_180px_180px_180px]">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input placeholder="Cerca per nome, P.IVA, CF, email, telefono, città…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Tutti i tipi</SelectItem>
              {Object.entries(TIPO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtroStato} onValueChange={setFiltroStato}>
            <SelectTrigger><SelectValue placeholder="Stato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__attivi">Non archiviati</SelectItem>
              <SelectItem value="__all">Tutti gli stati</SelectItem>
              <SelectItem value="__archiviati">Solo archiviati</SelectItem>
              <SelectItem value="potenziale">Potenziale</SelectItem>
              <SelectItem value="attivo">Attivo</SelectItem>
              <SelectItem value="inattivo">Inattivo</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Città" value={filtroCitta} onChange={(e) => setFiltroCitta(e.target.value)} />
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden md:table-cell">Tipo</TableHead>
              <TableHead className="hidden md:table-cell">Città</TableHead>
              <TableHead className="hidden lg:table-cell">Contatti</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead className="hidden lg:table-cell">Prossima attività</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c: any) => {
              const next = attByCliente.get(c.id)?.[0];
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link to="/clienti/$clienteId" params={{ clienteId: c.id }} className="hover:underline">
                      {c.denominazione}
                    </Link>
                    {c.archived_at && <Badge variant="outline" className="ml-2">Archiviato</Badge>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{TIPO_LABEL[c.tipo] ?? c.tipo}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{c.citta}{c.provincia && ` (${c.provincia})`}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs">{c.email}<br />{c.telefono ?? c.cellulare}</TableCell>
                  <TableCell><Badge variant={STATO_VARIANT[c.stato_cliente]}>{STATO_LABEL[c.stato_cliente] ?? c.stato_cliente}</Badge></TableCell>
                  <TableCell className="hidden lg:table-cell text-xs">
                    {next ? <span>{next.titolo}<br /><span className="text-muted-foreground">{next.scadenza ? new Date(next.scadenza).toLocaleDateString("it-IT") : "—"}</span></span> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" asChild title="Apri scheda">
                      <Link to="/clienti/$clienteId" params={{ clienteId: c.id }}><ExternalLink className="h-4 w-4" /></Link>
                    </Button>
                    {canDeleteBusinessData && !c.archived_at && (
                      <Button size="icon" variant="ghost" title="Archivia" onClick={() => onArchive(c.id, c.denominazione)}><Archive className="h-4 w-4" /></Button>
                    )}
                    {canDeleteBusinessData && c.archived_at && (
                      <Button size="icon" variant="ghost" title="Ripristina" onClick={() => onRestore(c.id)}><RotateCcw className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                {clienti.length === 0
                  ? "Non hai ancora inserito clienti. Crea il primo cliente per iniziare a gestire preventivi, commesse e attività."
                  : "Nessun cliente corrisponde ai filtri."}
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nuovo cliente</DialogTitle>
            <DialogDescription>I campi cambiano in base al tipo. I duplicati vengono verificati prima del salvataggio.</DialogDescription>
          </DialogHeader>
          <ClienteForm
            onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["clienti"] }); }}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  );
}
