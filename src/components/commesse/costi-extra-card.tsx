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
        <p className="text-xs text-muted-foreground mt-3">
          Importi calcolati dalle bolle e dalle presenze ditte registrate nei rapportini non annullati.
        </p>
      </CardContent>
    </Card>
  );
}
