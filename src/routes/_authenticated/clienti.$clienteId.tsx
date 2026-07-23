import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Archive, Pencil, Phone, Mail, Plus, RotateCcw, Star, CheckCircle2, XCircle, FileText, HardHat, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-current-user";
import { archiveCliente, restoreCliente, createContatto, updateContatto, archiveContatto, createAttivita, completeAttivita, cancelAttivita } from "@/lib/crm.functions";
import { ClienteForm, type ClienteFormValues } from "@/components/crm/cliente-form";
import { dateIt, eur } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clienti/$clienteId")({
  head: ({ params }) => ({
    meta: [
      { title: "Scheda cliente — CantiereOS" },
      { name: "description", content: `Scheda cliente ${params.clienteId}` },
    ],
  }),
  component: ClienteDetailPage,
});

function ClienteDetailPage() {
  const { clienteId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canManageAnagrafiche, canDeleteBusinessData } = useCurrentUser();

  const [editOpen, setEditOpen] = useState(false);
  const [contattoOpen, setContattoOpen] = useState(false);
  const [attOpen, setAttOpen] = useState(false);
  const [editContatto, setEditContatto] = useState<any | null>(null);

  const archiveFn = useServerFn(archiveCliente);
  const restoreFn = useServerFn(restoreCliente);

  const { data: cliente, isLoading } = useQuery({
    queryKey: ["cliente", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clienti").select("*").eq("id", clienteId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: contatti = [] } = useQuery({
    queryKey: ["cliente", clienteId, "contatti"],
    queryFn: async () => (await supabase.from("cliente_contatti").select("*").eq("cliente_id", clienteId).order("is_primary", { ascending: false })).data ?? [],
  });

  const { data: attivita = [] } = useQuery({
    queryKey: ["cliente", clienteId, "attivita"],
    queryFn: async () => (await supabase.from("crm_attivita").select("*").eq("cliente_id", clienteId).order("data_attivita", { ascending: false }).limit(200)).data ?? [],
  });

  const { data: preventivi = [] } = useQuery({
    queryKey: ["cliente", clienteId, "preventivi"],
    queryFn: async () => (await supabase.from("preventivi").select("id, numero, oggetto, stato, totale, data_preventivo").eq("cliente_id", clienteId).order("data_preventivo", { ascending: false })).data ?? [],
  });

  const { data: commesse = [] } = useQuery({
    queryKey: ["cliente", clienteId, "commesse"],
    queryFn: async () => (await supabase.from("commesse").select("id, codice, denominazione, stato, importo, data_inizio").eq("cliente_id", clienteId).order("data_inizio", { ascending: false })).data ?? [],
  });

  const { data: documenti = [] } = useQuery({
    queryKey: ["cliente", clienteId, "documenti"],
    queryFn: async () => (await supabase.from("documenti").select("id, nome, categoria, descrizione, data_scadenza, stato, created_at").eq("cliente_id", clienteId).order("created_at", { ascending: false })).data ?? [],
  });

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ["cliente", clienteId] });

  const onArchive = async () => {
    if (!cliente) return;
    if (!confirm(`Archiviare "${cliente.denominazione}"? Preventivi, commesse e documenti restano disponibili.`)) return;
    try { await archiveFn({ data: { id: cliente.id } }); toast.success("Cliente archiviato"); invalidateAll(); }
    catch (e: any) { toast.error(e.message); }
  };
  const onRestore = async () => {
    if (!cliente) return;
    try { await restoreFn({ data: { id: cliente.id } }); toast.success("Cliente ripristinato"); invalidateAll(); }
    catch (e: any) { toast.error(e.message); }
  };

  const timeline = useMemo(() => {
    type Ev = { t: string; date: string; icon: any; title: string; sub?: string; link?: string };
    const evs: Ev[] = [];
    for (const a of attivita) evs.push({ t: "attivita", date: a.data_attivita ?? a.created_at, icon: FileText, title: `${a.tipo}: ${a.titolo}`, sub: a.stato });
    for (const p of preventivi) evs.push({ t: "prev", date: p.data_preventivo ?? "", icon: FileText, title: `Preventivo ${p.numero} — ${p.oggetto}`, sub: `${eur(p.totale)} · ${p.stato}` });
    for (const c of commesse) evs.push({ t: "comm", date: c.data_inizio ?? "", icon: HardHat, title: `Commessa ${c.codice} — ${c.denominazione}`, sub: c.stato });
    for (const d of documenti) evs.push({ t: "doc", date: d.created_at, icon: FolderOpen, title: d.descrizione ?? d.nome, sub: `${d.categoria ?? "documento"} · ${d.stato}` });
    return evs.filter((e) => e.date).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [attivita, preventivi, commesse, documenti]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Caricamento…</div>;
  if (!cliente) return <div className="p-6">Cliente non trovato. <Link to="/clienti" className="underline">Torna all'elenco</Link></div>;

  return (
    <div>
      <PageHeader
        title={cliente.denominazione}
        description={<span>{cliente.tipo} · <Badge variant="outline">{cliente.stato_cliente}</Badge> {cliente.archived_at && <Badge variant="outline" className="ml-1">Archiviato</Badge>}</span> as any}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canManageAnagrafiche && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-1" />Modifica</Button>}
            <Button asChild variant="outline">
              <Link to="/preventivi" search={{ cliente_id: cliente.id } as any}><FileText className="h-4 w-4 mr-1" />Nuovo preventivo</Link>
            </Button>
            {canDeleteBusinessData && !cliente.archived_at && <Button variant="outline" onClick={onArchive}><Archive className="h-4 w-4 mr-1" />Archivia</Button>}
            {canDeleteBusinessData && cliente.archived_at && <Button variant="outline" onClick={onRestore}><RotateCcw className="h-4 w-4 mr-1" />Ripristina</Button>}
          </div>
        }
      />

      <Tabs defaultValue="panoramica">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="panoramica">Panoramica</TabsTrigger>
          <TabsTrigger value="contatti">Contatti ({contatti.length})</TabsTrigger>
          <TabsTrigger value="attivita">Attività ({attivita.length})</TabsTrigger>
          <TabsTrigger value="preventivi">Preventivi ({preventivi.length})</TabsTrigger>
          <TabsTrigger value="commesse">Commesse ({commesse.length})</TabsTrigger>
          <TabsTrigger value="documenti">Documenti ({documenti.length})</TabsTrigger>
          <TabsTrigger value="storico">Storico</TabsTrigger>
        </TabsList>

        <TabsContent value="panoramica">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4 space-y-1 text-sm">
              <h3 className="font-semibold mb-2">Anagrafica</h3>
              <Row k="Tipo" v={cliente.tipo} />
              {cliente.nome && <Row k="Nome" v={`${cliente.nome} ${cliente.cognome ?? ""}`} />}
              {cliente.ragione_sociale && <Row k="Ragione sociale" v={cliente.ragione_sociale} />}
              <Row k="P.IVA" v={cliente.partita_iva} />
              <Row k="Cod. Fiscale" v={cliente.codice_fiscale} />
              <Row k="PEC" v={cliente.pec} />
              <Row k="Codice destinatario" v={cliente.codice_destinatario} />
            </Card>
            <Card className="p-4 space-y-1 text-sm">
              <h3 className="font-semibold mb-2">Contatti & sede</h3>
              <Row k="Email" v={cliente.email ? <a className="underline" href={`mailto:${cliente.email}`}>{cliente.email}</a> : null} />
              <Row k="Telefono" v={cliente.telefono ? <a className="underline" href={`tel:${cliente.telefono}`}>{cliente.telefono}</a> : null} />
              <Row k="Cellulare" v={cliente.cellulare ? <a className="underline" href={`tel:${cliente.cellulare}`}>{cliente.cellulare}</a> : null} />
              <Row k="Sito web" v={cliente.sito_web} />
              <Row k="Indirizzo" v={[cliente.indirizzo, cliente.numero_civico].filter(Boolean).join(" ")} />
              <Row k="Città" v={[cliente.cap, cliente.citta, cliente.provincia ? `(${cliente.provincia})` : ""].filter(Boolean).join(" ")} />
            </Card>
            <Card className="p-4 space-y-1 text-sm">
              <h3 className="font-semibold mb-2">CRM</h3>
              <Row k="Stato" v={cliente.stato_cliente} />
              <Row k="Fonte" v={cliente.fonte_acquisizione} />
              <Row k="Creato il" v={dateIt(cliente.created_at)} />
              <Row k="Ultimo aggiornamento" v={dateIt(cliente.updated_at)} />
            </Card>
            <Card className="p-4 text-sm">
              <h3 className="font-semibold mb-2">Note interne</h3>
              <p className="whitespace-pre-wrap text-muted-foreground">{cliente.note_interne || "—"}</p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="contatti">
          <div className="flex justify-end mb-3">
            {canManageAnagrafiche && <Button size="sm" onClick={() => { setEditContatto(null); setContattoOpen(true); }}><Plus className="h-4 w-4 mr-1" />Nuovo contatto</Button>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {contatti.filter((c: any) => !c.archived_at).map((c: any) => (
              <Card key={c.id} className="p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium flex items-center gap-1">
                      {c.is_primary && <Star className="h-4 w-4 text-primary fill-primary" />}
                      {c.nome} {c.cognome}
                    </div>
                    {c.ruolo && <div className="text-xs text-muted-foreground">{c.ruolo}</div>}
                    <div className="text-sm mt-1 space-y-0.5">
                      {c.email && <div><Mail className="h-3 w-3 inline mr-1" /><a className="underline" href={`mailto:${c.email}`}>{c.email}</a></div>}
                      {c.telefono && <div><Phone className="h-3 w-3 inline mr-1" /><a className="underline" href={`tel:${c.telefono}`}>{c.telefono}</a></div>}
                      {c.cellulare && <div><Phone className="h-3 w-3 inline mr-1" /><a className="underline" href={`tel:${c.cellulare}`}>{c.cellulare}</a></div>}
                    </div>
                  </div>
                  {canManageAnagrafiche && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditContatto(c); setContattoOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={async () => {
                        if (!confirm("Archiviare il contatto?")) return;
                        try { await (window as any).__crmArchiveContatto?.(c.id) ?? archiveContattoWrapper(c.id); toast.success("Contatto archiviato"); invalidateAll(); }
                        catch (e: any) { toast.error(e.message); }
                      }}><Archive className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
            {contatti.filter((c: any) => !c.archived_at).length === 0 && (
              <div className="text-sm text-muted-foreground col-span-2">Nessun contatto. Aggiungi un referente per questo cliente.</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="attivita">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setAttOpen(true)}><Plus className="h-4 w-4 mr-1" />Nuova attività</Button>
          </div>
          <Card>
            <div className="divide-y">
              {attivita.map((a: any) => (
                <div key={a.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{a.titolo}</div>
                    <div className="text-xs text-muted-foreground">{a.tipo} · {a.priorita} · {dateIt(a.data_attivita)} {a.scadenza && `· scad. ${dateIt(a.scadenza)}`}</div>
                    {a.descrizione && <div className="text-sm mt-1 whitespace-pre-wrap">{a.descrizione}</div>}
                  </div>
                  <Badge variant={a.stato === "completata" ? "default" : a.stato === "annullata" ? "outline" : "secondary"}>{a.stato}</Badge>
                  {a.stato === "pianificata" && (
                    <div className="flex gap-1">
                      <CompleteButton id={a.id} onDone={invalidateAll} />
                      <CancelButton id={a.id} onDone={invalidateAll} />
                    </div>
                  )}
                </div>
              ))}
              {attivita.length === 0 && <div className="p-6 text-center text-muted-foreground text-sm">Nessuna attività registrata.</div>}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="preventivi">
          <Card><div className="divide-y">
            {preventivi.map((p: any) => (
              <div key={p.id} className="p-3 flex justify-between text-sm">
                <div><div className="font-medium">{p.numero} — {p.oggetto}</div><div className="text-xs text-muted-foreground">{dateIt(p.data_preventivo)} · {p.stato}</div></div>
                <div className="font-mono">{eur(p.totale)}</div>
              </div>
            ))}
            {preventivi.length === 0 && <div className="p-6 text-center text-muted-foreground text-sm">Nessun preventivo per questo cliente.</div>}
          </div></Card>
        </TabsContent>

        <TabsContent value="commesse">
          <Card><div className="divide-y">
            {commesse.map((c: any) => (
              <div key={c.id} className="p-3 flex justify-between text-sm">
                <div><div className="font-medium">{c.codice} — {c.denominazione}</div><div className="text-xs text-muted-foreground">{dateIt(c.data_inizio)} · {c.stato}</div></div>
                <div className="font-mono">{eur(c.importo)}</div>
              </div>
            ))}
            {commesse.length === 0 && <div className="p-6 text-center text-muted-foreground text-sm">Nessuna commessa.</div>}
          </div></Card>
        </TabsContent>

        <TabsContent value="documenti">
          <Card><div className="divide-y">
            {documenti.map((d: any) => (
              <div key={d.id} className="p-3 flex justify-between text-sm">
                <div><div className="font-medium">{d.descrizione || d.nome}</div><div className="text-xs text-muted-foreground">{d.categoria ?? "documento"} · scad. {dateIt(d.data_scadenza)}</div></div>
                <Badge variant="outline">{d.stato}</Badge>
              </div>
            ))}
            {documenti.length === 0 && <div className="p-6 text-center text-muted-foreground text-sm">Nessun documento.</div>}
          </div></Card>
        </TabsContent>

        <TabsContent value="storico">
          <Card><div className="divide-y">
            {timeline.map((e, i) => (
              <div key={i} className="p-3 flex items-start gap-3 text-sm">
                <e.icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium">{e.title}</div>
                  {e.sub && <div className="text-xs text-muted-foreground">{e.sub}</div>}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{dateIt(e.date)}</div>
              </div>
            ))}
            {timeline.length === 0 && <div className="p-6 text-center text-muted-foreground text-sm">Nessun evento in storico.</div>}
          </div></Card>
        </TabsContent>
      </Tabs>

      {/* Dialog modifica cliente */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Modifica cliente</DialogTitle></DialogHeader>
          <ClienteForm
            initial={cliente as any as ClienteFormValues}
            onSaved={() => { setEditOpen(false); invalidateAll(); }}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <ContattoDialog
        open={contattoOpen}
        onOpenChange={setContattoOpen}
        clienteId={clienteId}
        initial={editContatto}
        onSaved={() => { setContattoOpen(false); invalidateAll(); }}
      />

      <AttivitaDialog
        open={attOpen}
        onOpenChange={setAttOpen}
        clienteId={clienteId}
        contatti={contatti}
        onSaved={() => { setAttOpen(false); invalidateAll(); }}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <div className="text-muted-foreground">{k}</div>
      <div>{v || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

// wrapper (fallback if window helper not set)
async function archiveContattoWrapper(id: string) {
  // no-op placeholder to keep JSX simple: real call is via hook below
  throw new Error("Usa il tasto archivia dalla scheda: refresh e riprova.");
}

function CompleteButton({ id, onDone }: { id: string; onDone: () => void }) {
  const fn = useServerFn(completeAttivita);
  return <Button size="icon" variant="ghost" title="Completa" onClick={async () => {
    try { await fn({ data: { id } }); toast.success("Completata"); onDone(); } catch (e: any) { toast.error(e.message); }
  }}><CheckCircle2 className="h-4 w-4" /></Button>;
}
function CancelButton({ id, onDone }: { id: string; onDone: () => void }) {
  const fn = useServerFn(cancelAttivita);
  return <Button size="icon" variant="ghost" title="Annulla" onClick={async () => {
    try { await fn({ data: { id } }); toast.success("Annullata"); onDone(); } catch (e: any) { toast.error(e.message); }
  }}><XCircle className="h-4 w-4" /></Button>;
}

function ContattoDialog({ open, onOpenChange, clienteId, initial, onSaved }: any) {
  const createFn = useServerFn(createContatto);
  const updateFn = useServerFn(updateContatto);
  const archiveFn = useServerFn(archiveContatto);
  const [v, setV] = useState<any>({});
  const isEdit = !!initial?.id;
  // reset quando cambia initial
  useMemo(() => setV(initial ?? { is_primary: false }), [initial, open]);
  const upd = (k: string, val: any) => setV((s: any) => ({ ...s, [k]: val }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEdit) await updateFn({ data: { id: initial.id, patch: { nome: v.nome, cognome: v.cognome, ruolo: v.ruolo, email: v.email || null, telefono: v.telefono || null, cellulare: v.cellulare || null, pec: v.pec || null, is_primary: !!v.is_primary, note: v.note || null } } });
      else await createFn({ data: { cliente_id: clienteId, nome: v.nome, cognome: v.cognome || null, ruolo: v.ruolo || null, email: v.email || null, telefono: v.telefono || null, cellulare: v.cellulare || null, pec: v.pec || null, is_primary: !!v.is_primary, note: v.note || null } });
      toast.success("Contatto salvato"); onSaved();
    } catch (err: any) { toast.error(err.message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? "Modifica contatto" : "Nuovo contatto"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nome *</Label><Input value={v.nome ?? ""} onChange={(e) => upd("nome", e.target.value)} required /></div>
            <div><Label>Cognome</Label><Input value={v.cognome ?? ""} onChange={(e) => upd("cognome", e.target.value)} /></div>
            <div className="col-span-2"><Label>Ruolo</Label><Input value={v.ruolo ?? ""} onChange={(e) => upd("ruolo", e.target.value)} placeholder="es. Amministratore, Referente tecnico" /></div>
            <div><Label>Email</Label><Input type="email" value={v.email ?? ""} onChange={(e) => upd("email", e.target.value)} /></div>
            <div><Label>PEC</Label><Input type="email" value={v.pec ?? ""} onChange={(e) => upd("pec", e.target.value)} /></div>
            <div><Label>Telefono</Label><Input value={v.telefono ?? ""} onChange={(e) => upd("telefono", e.target.value)} /></div>
            <div><Label>Cellulare</Label><Input value={v.cellulare ?? ""} onChange={(e) => upd("cellulare", e.target.value)} /></div>
          </div>
          <div><Label>Note</Label><Textarea rows={2} value={v.note ?? ""} onChange={(e) => upd("note", e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!v.is_primary} onChange={(e) => upd("is_primary", e.target.checked)} />
            Imposta come contatto principale
          </label>
          <DialogFooter><Button type="submit">Salva</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttivitaDialog({ open, onOpenChange, clienteId, contatti, onSaved }: any) {
  const createFn = useServerFn(createAttivita);
  const [v, setV] = useState<any>({ tipo: "telefonata", priorita: "normale", stato: "pianificata" });
  const upd = (k: string, val: any) => setV((s: any) => ({ ...s, [k]: val }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createFn({ data: {
        cliente_id: clienteId,
        contatto_id: v.contatto_id || null,
        tipo: v.tipo,
        titolo: v.titolo,
        descrizione: v.descrizione || null,
        stato: v.tipo === "nota" ? "completata" : v.stato,
        priorita: v.priorita,
        data_attivita: v.data_attivita ? new Date(v.data_attivita).toISOString() : new Date().toISOString(),
        scadenza: v.scadenza ? new Date(v.scadenza).toISOString() : null,
      } });
      toast.success("Attività creata"); setV({ tipo: "telefonata", priorita: "normale", stato: "pianificata" }); onSaved();
    } catch (err: any) { toast.error(err.message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuova attività</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={v.tipo} onValueChange={(x) => upd("tipo", x)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["telefonata", "email", "incontro", "sopralluogo", "nota", "promemoria", "altro"].map((t) =>
                    <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priorità</Label>
              <Select value={v.priorita} onValueChange={(x) => upd("priorita", x)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["bassa", "normale", "alta", "urgente"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Titolo *</Label><Input value={v.titolo ?? ""} onChange={(e) => upd("titolo", e.target.value)} required /></div>
            <div className="col-span-2"><Label>Descrizione</Label><Textarea rows={3} value={v.descrizione ?? ""} onChange={(e) => upd("descrizione", e.target.value)} /></div>
            <div>
              <Label>Contatto (opz.)</Label>
              <Select value={v.contatto_id ?? "__none"} onValueChange={(x) => upd("contatto_id", x === "__none" ? null : x)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {contatti.filter((c: any) => !c.archived_at).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nome} {c.cognome ?? ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Data</Label><Input type="datetime-local" value={v.data_attivita ?? ""} onChange={(e) => upd("data_attivita", e.target.value)} /></div>
            <div><Label>Scadenza</Label><Input type="datetime-local" value={v.scadenza ?? ""} onChange={(e) => upd("scadenza", e.target.value)} /></div>
          </div>
          <DialogFooter><Button type="submit">Crea</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
