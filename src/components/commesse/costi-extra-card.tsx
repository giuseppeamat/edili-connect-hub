import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { getCommessaCostiExtra } from "@/lib/subappaltatori.functions";
import { extraKeys } from "@/lib/rapportini-extra.keys";
import { useCurrentUser } from "@/hooks/use-current-user";

function Voce({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="text-sm mt-1">€ {Number(value ?? 0).toFixed(2)}</div>
    </div>
  );
}

/** Riepilogo costi extra (materiali e subappalti) provenienti dai rapportini. */
export function CostiExtraCard({ commessaId }: { commessaId: string }) {
  const user = useCurrentUser();
  const canSee = user.has("proprietario", "amministratore", "amministrazione", "ufficio_tecnico");
  const fn = useServerFn(getCommessaCostiExtra);

  const { data } = useQuery({
    queryKey: extraKeys.costiExtraCommessa(commessaId),
    enabled: canSee,
    queryFn: async () => await fn({ data: { commessa_id: commessaId } }),
  });

  if (!canSee || !(data as any)?.visibile) return null;
  const d = data as any;

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="text-sm font-medium mb-3">Costi extra dai rapportini</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Voce label="Materiali" value={d.materiali} />
          <Voce label="Subappalti" value={d.subappalti} />
          <Voce label="Manodopera" value={d.manodopera} />
          <Voce label="Totale" value={d.totale} />
        </div>
        {Array.isArray(d.per_cantiere) && d.per_cantiere.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="text-xs uppercase text-muted-foreground tracking-wide mb-2">
              Dettaglio per cantiere
            </div>
            <div className="space-y-1">
              {d.per_cantiere.map((r: any, i: number) => (
                <div
                  key={r.cantiere_id ?? `nc-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-xs border-b last:border-0 py-1"
                >
                  <span className="font-medium">{r.cantiere}</span>
                  <span className="text-muted-foreground">
                    materiali € {Number(r.materiali ?? 0).toFixed(2)} · subappalti €{" "}
                    {Number(r.subappalti ?? 0).toFixed(2)} · manodopera €{" "}
                    {Number(r.manodopera ?? 0).toFixed(2)} ·{" "}
                    <strong className="text-foreground">€ {Number(r.totale ?? 0).toFixed(2)}</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Importi calcolati dalle bolle e dalle presenze ditte registrate nei rapportini non annullati.
        </p>
      </CardContent>
    </Card>
  );
}
