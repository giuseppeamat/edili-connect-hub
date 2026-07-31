import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Upload } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listDocumenti } from "@/lib/documenti.functions";
import { documentiKeys } from "@/lib/documenti.keys";
import { DocumentiTable } from "@/components/documenti/documenti-table";
import { DocumentoUploadDialog } from "@/components/documenti/documento-upload-dialog";

const ALL = "__all__";

export type DocumentiEntityPanelProps = {
  entityType: "commessa" | "cantiere" | "cliente" | "fornitore";
  entityId: string;
  /** Commessa di riferimento (per preselezionare l'upload dal cantiere). */
  commessaId?: string | null;
  canUpload: boolean;
  canManage: boolean;
  /** Cantieri disponibili per il filtro, quando il pannello è su una commessa. */
  cantieri?: Array<{ id: string; codice?: string | null; nome?: string | null }>;
};

/**
 * Pannello Documenti riutilizzabile per commessa, cantiere, cliente e fornitore.
 * Nessuna logica duplicata: usa le stesse server functions e la stessa tabella.
 */
export function DocumentiEntityPanel({
  entityType,
  entityId,
  commessaId,
  canUpload,
  canManage,
  cantieri = [],
}: DocumentiEntityPanelProps) {
  const [open, setOpen] = useState(false);
  const [cantiereFilter, setCantiereFilter] = useState(ALL);
  const [includeArchived, setIncludeArchived] = useState(false);
  const listFn = useServerFn(listDocumenti);

  const filters = {
    commessa_id: entityType === "commessa" ? entityId : (commessaId ?? null),
    cantiere_id:
      entityType === "cantiere" ? entityId : cantiereFilter === ALL ? null : cantiereFilter,
    cliente_id: entityType === "cliente" ? entityId : null,
    fornitore_id: entityType === "fornitore" ? entityId : null,
    includeArchived,
  };

  const keyBase =
    entityType === "commessa"
      ? documentiKeys.byCommessa(entityId)
      : entityType === "cantiere"
        ? documentiKeys.byCantiere(entityId)
        : entityType === "cliente"
          ? documentiKeys.byCliente(entityId)
          : documentiKeys.byFornitore(entityId);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...keyBase, filters],
    queryFn: () => listFn({ data: { ...filters, pageSize: 50 } }),
  });

  const preset =
    entityType === "commessa"
      ? { commessa_id: entityId, cantiere_id: cantiereFilter === ALL ? null : cantiereFilter }
      : entityType === "cantiere"
        ? { commessa_id: commessaId ?? null, cantiere_id: entityId }
        : entityType === "cliente"
          ? { cliente_id: entityId }
          : { fornitore_id: entityId };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">
          Documenti collegati {data ? `(${data.total})` : ""}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          {entityType === "commessa" && cantieri.length > 0 && (
            <Select value={cantiereFilter} onValueChange={setCantiereFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Tutti i cantieri" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tutti i cantieri</SelectItem>
                {cantieri.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {[k.codice, k.nome].filter(Boolean).join(" — ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-2">
            <Switch id="doc-arch" checked={includeArchived} onCheckedChange={setIncludeArchived} />
            <Label htmlFor="doc-arch" className="text-sm">
              Archiviati
            </Label>
          </div>
          {canUpload && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Upload className="h-4 w-4 mr-1" />
              Carica
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="text-sm text-muted-foreground py-6">Caricamento…</div>}
        {isError && (
          <div className="py-6 text-sm">
            <p className="text-destructive">
              {(error as any)?.message ?? "Errore di caricamento."}
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
              Riprova
            </Button>
          </div>
        )}
        {data && (
          <DocumentiTable
            items={data.items}
            canManage={canManage && data.capabilities.canManage}
            canUpload={canUpload && data.capabilities.canUpload}
            showCommessa={entityType !== "commessa"}
          />
        )}
      </CardContent>
      <DocumentoUploadDialog open={open} onOpenChange={setOpen} preset={preset} lockPreset />
    </Card>
  );
}
