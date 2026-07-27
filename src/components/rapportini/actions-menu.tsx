import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Send, CheckCircle2, XCircle, RotateCcw, Ban, Archive } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  canSubmitRapportino, canApproveRapportino, canRejectRapportino,
  canReopenRejectedRapportino, canCancelRapportino, canArchiveRapportinoByState,
  STATO_LABEL, STATO_BADGE_CLASS, type RapportinoRow,
} from "@/lib/rapportini.permissions";
import {
  SubmitDialog, ApproveDialog, RejectDialog, ReopenDialog, CancelDialog,
} from "@/components/rapportini/workflow-dialogs";

export function StatoBadge({ stato, archived }: { stato: string; archived?: boolean }) {
  return (
    <span className="inline-flex gap-1 items-center">
      <Badge variant="outline" className={STATO_BADGE_CLASS[stato] ?? ""}>
        {STATO_LABEL[stato] ?? stato}
      </Badge>
      {archived && <Badge variant="outline">Archiviato</Badge>}
    </span>
  );
}

export function RapportinoActionsMenu({
  row,
  onArchive,
}: {
  row: RapportinoRow & { updated_at: string; data?: string; ore?: number | string; commessa?: any; rejection_reason?: string | null };
  onArchive?: (row: any) => void;
}) {
  const u = useCurrentUser();
  const [submit, setSubmit] = useState(false);
  const [approve, setApprove] = useState(false);
  const [reject, setReject] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [cancel, setCancel] = useState(false);
  const ctx = {
    userId: u.userId,
    roles: u.roles,
    canAccessCommessa: true, // riga visibile ⇒ RLS ha permesso l'accesso
    isCapocantiereDi: u.has("capocantiere") && !!row.cantiere_id,
  };
  const items: Array<{ key: string; label: string; icon: any; onClick: () => void; danger?: boolean }> = [];
  if (canSubmitRapportino(row, ctx)) items.push({ key: "submit", label: "Invia per approvazione", icon: Send, onClick: () => setSubmit(true) });
  if (canApproveRapportino(row, ctx)) items.push({ key: "approve", label: "Approva", icon: CheckCircle2, onClick: () => setApprove(true) });
  if (canRejectRapportino(row, ctx)) items.push({ key: "reject", label: "Respingi", icon: XCircle, onClick: () => setReject(true), danger: true });
  if (canReopenRejectedRapportino(row, ctx)) items.push({ key: "reopen", label: "Riapri in bozza", icon: RotateCcw, onClick: () => setReopen(true) });
  if (canCancelRapportino(row, ctx)) items.push({ key: "cancel", label: "Annulla rapportino", icon: Ban, onClick: () => setCancel(true), danger: true });
  if (onArchive && canArchiveRapportinoByState(row, ctx)) items.push({ key: "archive", label: "Archivia", icon: Archive, onClick: () => onArchive(row) });

  if (!items.length) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Azioni rapportino">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Azioni</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {items.map((it) => (
            <DropdownMenuItem key={it.key} onClick={it.onClick} className={it.danger ? "text-destructive" : ""}>
              <it.icon className="h-4 w-4 mr-2" />
              {it.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {submit && <SubmitDialog row={row} open={submit} onOpenChange={setSubmit} />}
      {approve && <ApproveDialog row={row} open={approve} onOpenChange={setApprove} />}
      {reject && <RejectDialog row={row} open={reject} onOpenChange={setReject} />}
      {reopen && <ReopenDialog row={row} open={reopen} onOpenChange={setReopen} />}
      {cancel && <CancelDialog row={row} open={cancel} onOpenChange={setCancel} />}
    </>
  );
}
