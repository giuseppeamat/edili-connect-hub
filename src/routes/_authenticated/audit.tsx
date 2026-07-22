import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit — CantiereOS" },
      { name: "description", content: "Registro operazioni utenti." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { data: items = [] } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => (await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200)).data ?? [],
  });

  return (
    <div>
      <PageHeader title="Audit" description="Ultime 200 operazioni registrate" />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Azione</TableHead>
              <TableHead>Entità</TableHead>
              <TableHead className="hidden md:table-cell">Dettagli</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString("it-IT")}</TableCell>
                <TableCell><Badge variant="outline">{a.action}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{a.entity}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground truncate max-w-md">
                  {a.metadata ? JSON.stringify(a.metadata) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nessuna operazione registrata.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
