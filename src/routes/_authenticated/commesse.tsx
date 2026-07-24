import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MapPin, Calendar, Archive, ArchiveRestore, MoreHorizontal, UserRound, Lock, Unlock, AlertTriangle } from "lucide-react";
import { eur, dateIt } from "@/lib/format";
import { toast } from "sonner";
import { useCurrentRole } from "@/hooks/use-current-role";
import {
  createCommessa, archiveCommessa, restoreCommessa,
  changeCommessaStato, closeCommessa, reopenCommessa,
  listResponsabiliCandidati,
} from "@/lib/commesse.functions";

export const Route = createFileRoute("/_authenticated/commesse")({
  head: () => ({
    meta: [
      { title: "Commesse e cantieri — CantiereOS" },
      { name: "description", content: "Commesse attive, budget, avanzamento e stato dei cantieri." },
    ],
  }),
  component: CommessePage,
});

const statoLabel: Record<string, string> = {
  bozza: "Bozza", pianificata: "Pianificata", in_corso: "In corso", sospesa: "Sospesa",
  completata: "Completata", annullata: "Annullata",
};

// Transizioni consentite (mirror lato client per UI). Sicurezza reale è server-side.
const TRANSIZIONI: Record<string, { value: string; label: string; needsMotivo?: boolean }[]> = {
  bozza: [
    { value: "pianificata", label: "→ Pianificata" },
    { value: "annullata", label: "→ Annullata" },
  ],
  pianificata: [
    { value: "in_corso", label: "→ In corso" },
    { value: "sospesa", label: "→ Sospesa" },
    { value: "annullata", label: "→ Annullata" },
  ],
  in_corso: [
    { value: "sospesa", label: "→ Sospesa" },
    { value: "completata", label: "→ Completata" },
    { value: "annullata", label: "→ Annullata", needsMotivo: true },
  ],
  sospesa: [
    { value: "in_corso", label: "→ In corso" },
    { value: "completata", label: "→ Completata" },
    { value: "annullata", label: "→ Annullata" },
  ],
  completata: [],
  annullata: [],
};

const TIPOLOGIE = [
  ["ristrutturazione", "Ristrutturazione"], ["nuova_costruzione", "Nuova costruzione"],
  ["manutenzione", "Manutenzione"], ["impiantistica", "Impiantistica"],
  ["riqualificazione", "Riqualificazione"], ["demolizione", "Demolizione"],
  ["fornitura_posa", "Fornitura e posa"], ["altro", "Altro"],
] as const;
const PRIORITA = [["bassa", "Bassa"], ["normale", "Normale"], ["alta", "Alta"], ["urgente", "Urgente"]] as const;

const NONE = "__none__";
function fullName(r: { nome: string | null; cognome: string | null; email: string | null }) {
  const s = [r.nome, r.cognome].filter(Boolean).join(" ").trim();
  return s || r.email || "Utente";
}

function CommessePage() {
  const qc = useQueryClient();
  const role = useCurrentRole();
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const createFn = useServerFn(createCommessa);
  const archiveFn = useServerFn(archiveCommessa);
  const restoreFn = useServerFn(restoreCommessa);
  const changeStatoFn = useServerFn(changeCommessaStato);
  const closeFn = useServerFn(closeCommessa);
  const reopenFn = useServerFn(reopenCommessa);
  const listRespFn = useServerFn(listResponsabiliCandidati);

  const { data: items = [] } = useQuery({
    queryKey: ["commesse", showArchived],
    queryFn: async () => {
      let q = supabase.from("commesse")
        .select("*, clienti!commesse_cliente_id_fkey(ragione_sociale)")
        .order("data_inizio_prevista", { ascending: false, nullsFirst: false });
      if (!showArchived) q = q.is("archived_at", null);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const respIds = Array.from(new Set(rows.map((r) => r.responsabile_id).filter(Boolean)));
      let respMap = new Map<string, any>();
      if (respIds.length) {
        const { data: profs } = await supabase.from("profiles")
          .select("id, nome, cognome, email").in("id", respIds);
        for (const p of profs ?? []) respMap.set(p.id, p);
      }
      return rows.map((r) => ({ ...r, responsabile: r.responsabile_id ? respMap.get(r.responsabile_id) ?? null : null }));
    },
  });

  const { data: clienti = [] } = useQuery({
    queryKey: ["clienti-lite"],
    queryFn: async () => (await supabase.from("clienti").select("id, ragione_sociale").order("ragione_sociale")).data ?? [],
  });

  const { data: responsabili = [] } = useQuery({
    queryKey: ["responsabili-candidati"],
    enabled: role.canAssignResponsabile,
    queryFn: async () => await listRespFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["commesse"] });

  const create = useMutation({
    mutationFn: async (payload: any) => await createFn({ data: payload }),
    onSuccess: () => { invalidate(); setOpen(false); toast.success("Commessa creata (bozza)"); },
    onError: (e: any) => toast.error(e.message ?? "Errore creazione"),
  });

  const archive = useMutation({
    mutationFn: async (c: any) => {
      const motivazione = window.prompt("Motivazione archiviazione:") ?? "";
      if (!motivazione.trim()) throw new Error("Motivazione obbligatoria");
      const isClosed = !!c.closed_at || c.stato === "completata" || c.stato === "annullata";
      let override = false;
      if (!isClosed) {
        override = window.confirm("Prima di archiviare, la commessa dovrebbe essere completata o chiusa. Vuoi comunque forzare l'archiviazione?");
        if (!override) throw new Error("Archiviazione annullata");
      }
      return await archiveFn({ data: { id: c.id, motivazione, override } });
    },
    onSuccess: () => { invalidate(); toast.success("Commessa archiviata"); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  const restore = useMutation({
    mutationFn: async (id: string) => await restoreFn({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Commessa ripristinata"); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  const changeStato = useMutation({
    mutationFn: async (args: { c: any; nuovo: string; needsMotivo?: boolean }) => {
      let motivazione: string | undefined;
      if (args.needsMotivo) {
        const m = window.prompt(`Motivazione per il passaggio a "${statoLabel[args.nuovo]}":`) ?? "";
        if (!m.trim()) throw new Error("Motivazione obbligatoria");
        motivazione = m.trim();
      }
      return await changeStatoFn({ data: {
        id: args.c.id,
        nuovo_stato: args.nuovo as any,
        expected_updated_at: args.c.updated_at,
        motivazione,
      } });
    },
    onSuccess: () => { invalidate(); toast.success("Stato aggiornato"); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  const close = useMutation({
    mutationFn: async (c: any) => {
      const dataFine = window.prompt("Data fine effettiva (AAAA-MM-GG):", new Date().toISOString().slice(0, 10)) ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFine)) throw new Error("Data non valida");
      const motivazione = window.prompt("Motivazione chiusura:") ?? "";
      if (!motivazione.trim()) throw new Error("Motivazione obbligatoria");
      const override = c.stato !== "completata"
        ? window.confirm("La commessa non è completata. Vuoi comunque chiuderla (override)?")
        : false;
      if (c.stato !== "completata" && !override) throw new Error("Chiusura annullata");
      return await closeFn({ data: {
        id: c.id, expected_updated_at: c.updated_at,
        data_fine_effettiva: dataFine, motivazione, override,
      } });
    },
    onSuccess: () => { invalidate(); toast.success("Commessa chiusa"); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  const reopen = useMutation({
    mutationFn: async (c: any) => {
      const motivazione = window.prompt("Motivazione riapertura:") ?? "";
      if (!motivazione.trim()) throw new Error("Motivazione obbligatoria");
      const scelta = window.confirm("Riportare la commessa a 'In corso'? (Annulla = 'Completata')");
      return await reopenFn({ data: {
        id: c.id, motivazione,
        nuovo_stato: scelta ? "in_corso" : "completata",
      } });
    },
    onSuccess: () => { invalidate(); toast.success("Commessa riaperta"); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => (fd.get(k) as string) || "";
    const resp = g("responsabile_id");
    const payload: any = {
      cliente_id: g("cliente_id"),
      titolo: g("titolo").trim(),
      descrizione: g("descrizione") || null,
      tipologia: g("tipologia") || null,
      priorita: g("priorita") || "normale",
      responsabile_id: resp && resp !== NONE ? resp : null,
      indirizzo_cantiere: g("indirizzo_cantiere") || null,
      data_apertura: g("data_apertura") || null,
      data_inizio_prevista: g("data_inizio_prevista") || null,
      data_fine_prevista: g("data_fine_prevista") || null,
      importo_contratto: g("importo_contratto") ? Number(g("importo_contratto")) : null,
      ricavi_previsti: g("ricavi_previsti") ? Number(g("ricavi_previsti")) : null,
      costi_previsti: g("costi_previsti") ? Number(g("costi_previsti")) : null,
      note_interne: g("note_interne") || null,
    };
    if (!payload.cliente_id) return toast.error("Cliente obbligatorio");
    if (!payload.titolo) return toast.error("Titolo obbligatorio");
    if (payload.data_inizio_prevista && payload.data_fine_prevista &&
        payload.data_fine_prevista < payload.data_inizio_prevista) {
      return toast.error("La data di fine prevista non può essere antecedente alla data di inizio prevista");
    }
    create.mutate(payload);
  };

  return (
    <div>
      <PageHeader
        title="Commesse e cantieri"
        description={`${items.length} commesse${showArchived ? " (incluse archiviate)" : ""}`}
        actions={
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="show-arch" checked={showArchived} onCheckedChange={setShowArchived} />
              <Label htmlFor="show-arch" className="text-sm">Mostra archiviate</Label>
            </div>
            {role.canCreateCommesse && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Nuova commessa</Button></DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>Nuova commessa</DialogTitle></DialogHeader>
                  <form onSubmit={onSubmit} className="space-y-4">
                    <section className="space-y-3">
                      <h4 className="text-sm font-semibold text-muted-foreground">Anagrafica</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2"><Label>Titolo *</Label><Input name="titolo" required /></div>
                        <div className="md:col-span-2">
                          <Label>Cliente *</Label>
                          <Select name="cliente_id" required>
                            <SelectTrigger><SelectValue placeholder="Seleziona cliente" /></SelectTrigger>
                            <SelectContent>{clienti.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Tipologia</Label>
                          <Select name="tipologia">
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>{TIPOLOGIE.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Priorità</Label>
                          <Select name="priorita" defaultValue="normale">
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{PRIORITA.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="md:col-span-2"><Label>Descrizione</Label><Textarea name="descrizione" rows={2} /></div>
                      </div>
                    </section>

                    {role.canAssignResponsabile && (
                      <section className="space-y-3">
                        <h4 className="text-sm font-semibold text-muted-foreground">Responsabilità</h4>
                        <div>
                          <Label>Responsabile</Label>
                          <Select name="responsabile_id" defaultValue={NONE}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Non assegnato</SelectItem>
                              {(responsabili as any[]).map((r) => (
                                <SelectItem key={r.id} value={r.id}>{fullName(r)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                            <AlertTriangle className="h-3 w-3" /> Se non assegnato ora, la commessa sarà segnalata come "Responsabile non assegnato".
                          </div>
                        </div>
                      </section>
                    )}

                    <section className="space-y-3">
                      <h4 className="text-sm font-semibold text-muted-foreground">Pianificazione</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div><Label>Data apertura</Label><Input name="data_apertura" type="date" /></div>
                        <div><Label>Data inizio prevista</Label><Input name="data_inizio_prevista" type="date" /></div>
                        <div><Label>Data fine prevista</Label><Input name="data_fine_prevista" type="date" /></div>
                        <div className="md:col-span-2"><Label>Indirizzo cantiere</Label><Input name="indirizzo_cantiere" /></div>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <h4 className="text-sm font-semibold text-muted-foreground">Economica</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div><Label>Importo contratto (€)</Label><Input name="importo_contratto" type="number" step="0.01" min="0" /></div>
                        <div><Label>Ricavi previsti (€)</Label><Input name="ricavi_previsti" type="number" step="0.01" min="0" /></div>
                        <div><Label>Costi previsti (€)</Label><Input name="costi_previsti" type="number" step="0.01" min="0" /></div>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold text-muted-foreground">Note</h4>
                      <Textarea name="note_interne" rows={2} />
                    </section>

                    <DialogFooter><Button type="submit" disabled={create.isPending}>Crea come bozza</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((c) => {
          const titolo = c.titolo ?? c.denominazione;
          const importo = c.importo_contratto ?? c.importo;
          const costi = c.costi_previsti ?? c.budget_costi;
          const dataInizio = c.data_inizio_prevista ?? c.data_inizio;
          const isArchived = !!c.archived_at;
          const isClosed = !!c.closed_at;
          const transizioni = TRANSIZIONI[c.stato] ?? [];
          const canStateMenu = role.canManageCommessaState && !isClosed && !isArchived;
          const hasAnyAction = role.canCloseCommesse || role.canReopenCommesse || role.canArchiveCommesse || canStateMenu;
          return (
            <Card key={c.id} className={isArchived ? "opacity-60" : ""}>
              <CardContent className="p-5 space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground font-mono">{c.codice}</div>
                    <div className="font-semibold truncate">{titolo}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.clienti?.ragione_sociale}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={c.stato === "in_corso" ? "default" : "secondary"}>{statoLabel[c.stato] ?? c.stato}</Badge>
                    {isClosed && <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />Chiusa</Badge>}
                    {isArchived && <Badge variant="outline">Archiviata</Badge>}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  <UserRound className="h-3 w-3" />
                  {c.responsabile ? (
                    <span className="text-muted-foreground truncate">{fullName(c.responsabile)}</span>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
                      <AlertTriangle className="h-3 w-3" />Responsabile non assegnato
                    </Badge>
                  )}
                </div>

                {c.indirizzo_cantiere && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />{c.indirizzo_cantiere}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {dataInizio ? dateIt(dataInizio) : "—"} → {c.data_fine_prevista ? dateIt(c.data_fine_prevista) : "—"}
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Avanzamento</span><span className="font-medium">{Number(c.avanzamento_pct)}%</span>
                  </div>
                  <Progress value={Number(c.avanzamento_pct)} />
                </div>
                {role.canViewCommessaEconomics && (
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center">
                    <div><div className="text-xs text-muted-foreground">Importo</div><div className="font-semibold text-sm">{importo != null ? eur(importo) : "—"}</div></div>
                    <div><div className="text-xs text-muted-foreground">Costi sost.</div><div className="font-semibold text-sm">{c.costi_sostenuti != null ? eur(c.costi_sostenuti) : "—"}</div></div>
                    <div><div className="text-xs text-muted-foreground">Budget</div><div className="font-semibold text-sm">{costi != null ? eur(costi) : "—"}</div></div>
                  </div>
                )}

                {hasAnyAction && (
                  <div className="pt-2 border-t flex justify-end gap-1">
                    {canStateMenu && transizioni.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">Stato</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Cambia stato</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {transizioni.map((t) => (
                            <DropdownMenuItem
                              key={t.value}
                              disabled={changeStato.isPending}
                              onClick={() => changeStato.mutate({ c, nuovo: t.value, needsMotivo: t.needsMotivo })}
                            >{t.label}</DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {role.canCloseCommesse && !isClosed && !isArchived && (
                      <Button size="sm" variant="ghost" onClick={() => close.mutate(c)} disabled={close.isPending}>
                        <Lock className="h-4 w-4 mr-1" />Chiudi
                      </Button>
                    )}
                    {role.canReopenCommesse && isClosed && !isArchived && (
                      <Button size="sm" variant="ghost" onClick={() => reopen.mutate(c)} disabled={reopen.isPending}>
                        <Unlock className="h-4 w-4 mr-1" />Riapri
                      </Button>
                    )}
                    {role.canArchiveCommesse && (
                      isArchived ? (
                        <Button size="sm" variant="ghost" onClick={() => restore.mutate(c.id)} disabled={restore.isPending}>
                          <ArchiveRestore className="h-4 w-4 mr-1" />Ripristina
                        </Button>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => archive.mutate(c)}>
                              <Archive className="h-4 w-4 mr-2" />Archivia
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {items.length === 0 && <div className="text-center text-muted-foreground py-8 col-span-full">Nessuna commessa.</div>}
      </div>
    </div>
  );
}
