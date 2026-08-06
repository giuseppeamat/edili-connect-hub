import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getSoggettoScheda } from "@/lib/subappaltatori.functions";

const eur = (n: number | null | undefined) =>
  n == null ? "—" : `€ ${Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateIt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("it-IT") : "—");

function scadenzaTone(d?: string | null) {
  if (!d) return "";
  const x = String(d).slice(0, 10);
  const oggi = new Date().toISOString().slice(0, 10);
  const fra30 = new Date();
  fra30.setDate(fra30.getDate() + 30);
  if (x < oggi) return "text-rose-700 border-rose-400";
  if (x <= fra30.toISOString().slice(0, 10)) return "text-amber-700 border-amber-400";
  return "text-emerald-700 border-emerald-400";
}

/** Scheda operativa di un fornitore / subappaltatore: bolle, prezzi, documenti e contratti. */
export function SchedaSoggettoDialog({
  fornitoreId,
  onOpenChange,
}: {
  fornitoreId: string | null;
  onOpenChange: (v: boolean) => void;
}) {
  const fn = useServerFn(getSoggettoScheda);
  const { data, isLoading } = useQuery({
    queryKey: ["fornitori", "scheda", fornitoreId],
    enabled: !!fornitoreId,
    queryFn: async () => await fn({ data: { fornitore_id: fornitoreId! } }),
  });

  const d = data as any;
  const econ = d?.canSeeEconomics === true;

  return (
    <Dialog open={!!fornitoreId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d?.soggetto?.ragione_sociale ?? "Scheda soggetto"}</DialogTitle>
        </DialogHeader>

        {isLoading || !d ? (
          <div className="text-sm text-muted-foreground py-6">Caricamento…</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {d.soggetto.partita_iva && <span>P.IVA {d.soggetto.partita_iva}</span>}
              {d.soggetto.telefono && <span>· {d.soggetto.telefono}</span>}
              {d.soggetto.email && <span>· {d.soggetto.email}</span>}
              {(d.soggetto.specializzazioni ?? []).length > 0 && (
                <span>· {(d.soggetto.specializzazioni as string[]).join(", ")}</span>
              )}
            </div>

            {econ && d.totali && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Bolle</div>
                  <div className="text-sm">{d.totali.bolle} · {eur(d.totali.totaleBolle)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Contratti</div>
                  <div className="text-sm">{d.totali.contratti}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Importo contratti</div>
                  <div className="text-sm">{eur(d.totali.totaleContratti)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Maturato</div>
                  <div className="text-sm">{eur(d.totali.totaleMaturato)}</div>
                </div>
              </div>
            )}

            <Tabs defaultValue="bolle" className="mt-4">
              <TabsList>
                <TabsTrigger value="bolle">Bolle ({d.bolle.length})</TabsTrigger>
                <TabsTrigger value="prezzi">Storico prezzi ({d.prezzi.length})</TabsTrigger>
                <TabsTrigger value="contratti">Contratti ({d.contratti.length})</TabsTrigger>
                <TabsTrigger value="documenti">Documenti ({d.documenti.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="bolle" className="mt-3 space-y-1">
                {d.bolle.length === 0 && (
                  <div className="text-sm text-muted-foreground">Nessuna bolla registrata.</div>
                )}
                {d.bolle.map((b: any) => (
                  <div key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-1 text-sm">
                    <span>
                      <Link
                        to="/rapportini/$rapportinoId"
                        params={{ rapportinoId: b.rapportino_id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {b.numero_bolla}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">
                        {dateIt(b.data_bolla)} · {b.commessa?.codice ?? "—"}
                      </span>
                      {b.stato === "annullata" && (
                        <Badge variant="outline" className="ml-2 text-zinc-500">Annullata</Badge>
                      )}
                    </span>
                    {econ && <span className="text-sm">{eur(b.imponibile)}</span>}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="prezzi" className="mt-3 space-y-1">
                {!econ ? (
                  <div className="text-sm text-muted-foreground">
                    Storico prezzi visibile solo ai ruoli con accesso economico.
                  </div>
                ) : d.prezzi.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nessun prezzo storicizzato.</div>
                ) : (
                  d.prezzi.map((p: any) => (
                    <div key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-1 text-sm">
                      <span>
                        {p.materiale?.descrizione ?? p.descrizione}{" "}
                        <span className="text-xs text-muted-foreground">{dateIt(p.data_prezzo)}</span>
                      </span>
                      <span>
                        {eur(p.prezzo_unitario)}
                        {p.unita_misura ? ` / ${p.unita_misura}` : ""}
                      </span>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="contratti" className="mt-3 space-y-1">
                {d.contratti.length === 0 && (
                  <div className="text-sm text-muted-foreground">Nessun contratto di subappalto.</div>
                )}
                {d.contratti.map((c: any) => (
                  <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-1 text-sm">
                    <span>
                      <strong>{c.oggetto}</strong>{" "}
                      <span className="text-xs text-muted-foreground">
                        {c.commessa?.codice ?? "—"} · {dateIt(c.data_inizio)} → {dateIt(c.data_fine)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{c.stato}</Badge>
                      {econ && <span>{eur(c.importo_contratto)}</span>}
                    </span>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="documenti" className="mt-3 space-y-1">
                {d.documenti.length === 0 && (
                  <div className="text-sm text-muted-foreground">Nessun documento della ditta.</div>
                )}
                {d.documenti.map((doc: any) => (
                  <div key={doc.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-1 text-sm">
                    <span>
                      <Link
                        to="/documenti/$documentoId"
                        params={{ documentoId: doc.id }}
                        className="text-primary hover:underline"
                      >
                        {doc.nome}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">{doc.categoria ?? "—"}</span>
                    </span>
                    <Badge variant="outline" className={scadenzaTone(doc.data_scadenza)}>
                      {doc.data_scadenza ? `Scade il ${dateIt(doc.data_scadenza)}` : "Senza scadenza"}
                    </Badge>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
