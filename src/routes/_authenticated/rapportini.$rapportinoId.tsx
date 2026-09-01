import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft } from "lucide-react";
import { dateIt } from "@/lib/format";
import { rapportiniKeys } from "@/lib/rapportini.keys";
import { getRapportino, archiveRapportino } from "@/lib/rapportini.functions";
import { getRapportinoCosto, ricalcolaCostoStoricoRapportino } from "@/lib/personale-costi.functions";
import { RapportinoActionsMenu, StatoBadge } from "@/components/rapportini/actions-menu";
import { PersonaleSection } from "@/components/rapportini/personale-section";
import { BolleSection } from "@/components/rapportini/bolle-section";
import { SubappaltatoriSection } from "@/components/rapportini/subappaltatori-section";
import { DocumentiEntityPanel } from "@/components/documenti/documenti-entity-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRapportinoRiepilogoCosti } from "@/lib/bolle.functions";
import { extraKeys } from "@/lib/rapportini-extra.keys";
import { rapportinoModificabile, bolleModificabili } from "@/lib/rapportini-extra";

import { useMutation } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";

export const Route = createFileRoute("/_authenticated/rapportini/$rapportinoId")({
  head: () => ({
    meta: [
      { title: "Dettaglio rapportino — CantiereOS" },
      { name: "description", content: "Dettaglio del rapportino operativo." },
    ],
  }),
  component: RapportinoDetailPage,
});

function fullName(r: any) {
  if (!r) return "—";
  const s = [r?.nome, r?.cognome].filter(Boolean).join(" ").trim();
  return s || r?.email || "Utente";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="text-sm mt-1">{children ?? "—"}</div>
    </div>
  );
}

function RapportinoDetailPage() {
  const { rapportinoId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useCurrentUser();

  const getFn = useServerFn(getRapportino);
  const costFn = useServerFn(getRapportinoCosto);
  const archFn = useServerFn(archiveRapportino);

  const { data: r, isLoading, error } = useQuery({
    queryKey: rapportiniKeys.detail(rapportinoId),
    queryFn: async () => await getFn({ data: { id: rapportinoId } }),
  });

  const canViewEcon = user.has(
    "proprietario", "amministratore", "amministrazione",
  );

  const { data: costi = [] } = useQuery({
    queryKey: ["rapportino", rapportinoId, "costi"],
    queryFn: async () => (await costFn({ data: { rapportino_id: rapportinoId } })) ?? [],
    enabled: canViewEcon && !!r,
  });

  const riepilogoFn = useServerFn(getRapportinoRiepilogoCosti);
  const { data: riepilogo } = useQuery({
    queryKey: extraKeys.riepilogo(rapportinoId),
    queryFn: async () => await riepilogoFn({ data: { rapportino_id: rapportinoId } }),
    enabled: canViewEcon && !!r,
  });

  const [archOpen, setArchOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const arch = useMutation({
    mutationFn: async () => await archFn({ data: { id: r!.id, expected_updated_at: r!.updated_at, motivazione: motivo.trim() } }),
    onSuccess: () => {
      toast.success("Rapportino archiviato");
      setArchOpen(false); setMotivo("");
      qc.invalidateQueries({ queryKey: rapportiniKeys.all });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Fase 6 — ricalcolo del costo storico (solo proprietario/amministratore)
  const storicoFn = useServerFn(ricalcolaCostoStoricoRapportino);
  const [storicoOpen, setStoricoOpen] = useState(false);
  const [storicoMotivo, setStoricoMotivo] = useState("");
  const [storicoEsito, setStoricoEsito] = useState<any>(null);
  const storicoMut = useMutation({
    mutationFn: async () =>
      await storicoFn({ data: { rapportino_id: rapportinoId, motivo: storicoMotivo.trim() } }),
    onSuccess: (res: any) => {
      setStoricoEsito(res);
      toast.success("Costo storico ricalcolato");
      qc.invalidateQueries({ queryKey: ["rapportino", rapportinoId, "costi"] });
      qc.invalidateQueries({ queryKey: rapportiniKeys.all });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  }
  if (error || !r) {
    return (
      <div className="p-6">
        <Button variant="outline" size="sm" onClick={() => navigate({ to: "/rapportini" })}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Torna ai rapportini
        </Button>
        <div className="mt-4 text-sm text-destructive">
          {(error as any)?.message ?? "Rapportino non disponibile o accesso negato."}
        </div>
      </div>
    );
  }

  const activeCost = (costi as any[]).find((c) => c.stato === "contabilizzato" && !c.stornato_at);
  const readOnly = !!r.archived_at || r.stato === "annullato";
  const readOnlyBolle = !bolleModificabili(r as any, user.roles);
  const readOnlySubappalti = !rapportinoModificabile(r as any);


  return (
    <div>
      <PageHeader
        title={`Rapportino del ${dateIt(r.data)}`}
        description={`${fullName(r.user)} · ${Number(r.ore ?? 0).toFixed(2)} ore`}
        actions={
          <div className="flex gap-2 items-center">
            <StatoBadge stato={r.stato} archived={!!r.archived_at} />
            <RapportinoActionsMenu row={r as any} onArchive={() => setArchOpen(true)} />
            <Button variant="outline" size="sm" onClick={() => navigate({ to: "/rapportini" })}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Indietro
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="riepilogo">
        <TabsList className="flex w-full flex-wrap justify-start h-auto">
          <TabsTrigger value="riepilogo">Riepilogo</TabsTrigger>
          <TabsTrigger value="personale">Personale</TabsTrigger>
          <TabsTrigger value="bolle">Bolle e materiali</TabsTrigger>
          <TabsTrigger value="subappalti">Subappaltatori</TabsTrigger>
          <TabsTrigger value="documenti">Documenti</TabsTrigger>
        </TabsList>

        <TabsContent value="riepilogo">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-4 grid gap-4 grid-cols-2">
                <Field label="Data">{dateIt(r.data)}</Field>
                <Field label="Stato"><StatoBadge stato={r.stato} archived={!!r.archived_at} /></Field>
                <Field label="Autore">{fullName(r.user)}</Field>
                <Field label="Ore">{Number(r.ore ?? 0).toFixed(2)}</Field>
                <Field label="Ora inizio">{r.ora_inizio ?? "—"}</Field>
                <Field label="Ora fine">{r.ora_fine ?? "—"}</Field>
                <Field label="Pausa (min)">{r.pausa_minuti ?? 0}</Field>
                <Field label="Creato il">{r.created_at ? dateIt(r.created_at) : "—"}</Field>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 grid gap-4 grid-cols-1">
                <Field label="Commessa">
                  {r.commessa ? (
                    <Link
                      to="/commesse/$commessaId"
                      params={{ commessaId: r.commessa_id }}
                      className="text-primary hover:underline"
                    >
                      <span className="font-mono">{r.commessa.codice}</span> — {r.commessa.denominazione}
                    </Link>
                  ) : "—"}
                </Field>
                <Field label="Cantiere">
                  {r.cantiere ? `${r.cantiere.codice} — ${r.cantiere.nome}` : "—"}
                </Field>
                <Field label="Fase">{r.fase?.titolo ?? "—"}</Field>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardContent className="p-4 space-y-4">
              <Field label="Descrizione lavori">
                <div className="whitespace-pre-wrap">{r.descrizione_lavori ?? r.lavorazione ?? "—"}</div>
              </Field>
              <Field label="Note">
                <div className="whitespace-pre-wrap">{r.note ?? "—"}</div>
              </Field>
              {r.stato === "respinto" && r.rejection_reason && (
                <Field label="Motivo rifiuto">
                  <div className="text-rose-700">{r.rejection_reason}</div>
                </Field>
              )}
              {r.stato === "annullato" && r.cancellation_reason && (
                <Field label="Motivo annullamento">
                  <div className="text-zinc-700">{r.cancellation_reason}</div>
                </Field>
              )}
            </CardContent>
          </Card>

          {canViewEcon && (riepilogo as any)?.visibile && (
            <Card className="mt-4">
              <CardContent className="p-4">
                <div className="text-sm font-medium mb-3">Costi della giornata</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Field label="Manodopera">€ {Number((riepilogo as any).manodopera ?? 0).toFixed(2)}</Field>
                  <Field label="Materiali">€ {Number((riepilogo as any).materiali ?? 0).toFixed(2)}</Field>
                  <Field label="Subappalti">€ {Number((riepilogo as any).subappalti ?? 0).toFixed(2)}</Field>
                  <Field label="Totale giornata">
                    <strong>€ {Number((riepilogo as any).totale ?? 0).toFixed(2)}</strong>
                  </Field>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="mt-4">
            <CardContent className="p-4">
              <div className="text-sm font-medium mb-3">Timeline workflow</div>
              <ol className="space-y-2 text-sm">
                <li>
                  <span className="text-muted-foreground">Creato:</span>{" "}
                  {r.created_at ? dateIt(r.created_at) : "—"}
                </li>
                {r.submitted_at && (
                  <li>
                    <span className="text-muted-foreground">Inviato:</span> {dateIt(r.submitted_at)}
                  </li>
                )}
                {r.approved_at && (
                  <li>
                    <span className="text-emerald-700">Approvato:</span> {dateIt(r.approved_at)}
                  </li>
                )}
                {r.rejected_at && (
                  <li>
                    <span className="text-rose-700">Respinto:</span> {dateIt(r.rejected_at)}
                  </li>
                )}
                {r.cancelled_at && (
                  <li>
                    <span className="text-zinc-700">Annullato:</span> {dateIt(r.cancelled_at)}
                  </li>
                )}
                {r.archived_at && (
                  <li>
                    <span className="text-muted-foreground">Archiviato:</span> {dateIt(r.archived_at)}
                  </li>
                )}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="personale">
          <PersonaleSection rapportinoId={rapportinoId} readOnly={readOnly} />

          {canViewEcon && (
            <Card className="mt-4">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Contabilizzazione manodopera</div>
                  {activeCost && user.has("proprietario", "amministratore") && (
                    <Button size="sm" variant="outline" onClick={() => setStoricoOpen(true)}>
                      Ricalcola costo storico
                    </Button>
                  )}
                </div>
                {costiAttivi.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <Field label="Persone contabilizzate">{costiAttivi.length}</Field>
                    <Field label="Ore contabilizzate">{oreContabilizzate.toFixed(2)}</Field>
                    <Field label="Costo totale manodopera">€ {costoTotaleManodopera.toFixed(2)}</Field>
                    <Field label="Periodo">{costiAttivi[0]?.periodo_riferimento ?? "—"}</Field>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {r.stato === "approvato"
                      ? "Nessuna contabilizzazione attiva per questo rapportino."
                      : "La contabilizzazione avviene alla prima approvazione."}
                  </div>
                )}
                {costiAttivi.length > 1 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Il costo è calcolato per ogni singola persona impiegata: il dettaglio per persona è
                    nell'elenco “Personale impiegato” qui sopra.
                  </p>
                )}

              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="bolle">
          <BolleSection rapportinoId={rapportinoId} readOnlyBolle={readOnlyBolle} stato={r.stato} />
        </TabsContent>


        <TabsContent value="subappalti">
          <SubappaltatoriSection
            rapportinoId={rapportinoId}
            commessaId={r.commessa_id}
            readOnly={readOnlySubappalti}
          />
        </TabsContent>


        <TabsContent value="documenti">
          <div className="mt-4">
            <DocumentiEntityPanel
              entityType="rapportino"
              entityId={rapportinoId}
              commessaId={r.commessa_id}
              canUpload={!readOnly}
              canManage={user.has("proprietario", "amministratore", "ufficio_tecnico", "amministrazione")}
            />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={storicoOpen} onOpenChange={setStoricoOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ricalcola costo storico</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Il costo attualmente congelato verrà stornato e ricalcolato con la tariffa valida alla data del
              rapportino. Operazione registrata nel registro attività.
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Costo attuale">€ {Number(activeCost?.costo_totale ?? 0).toFixed(2)}</Field>
              <Field label="Tariffa attuale">€ {Number(activeCost?.costo_orario_applicato ?? 0).toFixed(2)}</Field>
            </div>
            {storicoEsito && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Nuovo costo">
                  {storicoEsito.costo_nuovo === null ? "—" : `€ ${Number(storicoEsito.costo_nuovo).toFixed(2)}`}
                </Field>
                <Field label="Nuova tariffa">
                  {storicoEsito.tariffa_nuova === null ? "—" : `€ ${Number(storicoEsito.tariffa_nuova).toFixed(2)}`}
                </Field>
              </div>
            )}
            <div className="space-y-1">
              <Label>Motivazione (obbligatoria)</Label>
              <Textarea
                value={storicoMotivo}
                onChange={(e) => setStoricoMotivo(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Es. tariffa corretta a posteriori dopo verifica amministrativa"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStoricoOpen(false)}>Annulla</Button>
            <Button
              onClick={() => storicoMut.mutate()}
              disabled={storicoMut.isPending || storicoMotivo.trim().length < 5}
            >
              {storicoMut.isPending ? "Ricalcolo…" : "Conferma ricalcolo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={archOpen} onOpenChange={setArchOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archivia rapportino</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Motivazione *</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo dell'archiviazione…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchOpen(false)}>Chiudi</Button>
            <Button onClick={() => arch.mutate()} disabled={!motivo.trim() || arch.isPending}>Archivia</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
