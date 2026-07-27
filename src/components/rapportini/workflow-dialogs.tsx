import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { rapportiniKeys } from "@/lib/rapportini.keys";
import {
  submitRapportino, approveRapportino, rejectRapportino,
  reopenRejectedRapportino, cancelRapportino,
} from "@/lib/rapportini.functions";
import { dateIt } from "@/lib/format";
import type { RapportinoRow } from "@/lib/rapportini.permissions";

type Extras = { data?: string; ore?: number | string; commessa?: any; rejection_reason?: string | null };

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: rapportiniKeys.all });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

// ── SUBMIT ────────────────────────────────────────────────────────────────
export function SubmitDialog({ row, open, onOpenChange }: {
  row: RapportinoRow & Extras & { updated_at: string };
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const fn = useServerFn(submitRapportino);
  const invalidate = useInvalidate();
  const m = useMutation({
    mutationFn: async () => await fn({ data: { id: row.id, expected_updated_at: row.updated_at } }),
    onSuccess: () => { toast.success("Rapportino inviato per approvazione"); invalidate(); onOpenChange(false); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Invia rapportino per approvazione</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              <div>Data: <b>{dateIt(row.data as any)}</b> · Ore: <b>{Number(row.ore ?? 0).toFixed(2)}</b></div>
              {row.commessa && <div>Commessa: <b>{row.commessa.codice}</b></div>}
              <div className="text-amber-700 text-sm mt-2">Dopo l'invio il rapportino non sarà più modificabile.</div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annulla</AlertDialogCancel>
          <AlertDialogAction disabled={m.isPending} onClick={(e) => { e.preventDefault(); m.mutate(); }}>Invia</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── APPROVE ───────────────────────────────────────────────────────────────
export function ApproveDialog({ row, open, onOpenChange }: {
  row: RapportinoRow & Extras & { updated_at: string };
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [note, setNote] = useState("");
  const fn = useServerFn(approveRapportino);
  const invalidate = useInvalidate();
  const m = useMutation({
    mutationFn: async () => await fn({ data: { id: row.id, expected_updated_at: row.updated_at, note: note.trim() || null } }),
    onSuccess: () => { toast.success("Rapportino approvato"); invalidate(); onOpenChange(false); setNote(""); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approva rapportino</DialogTitle>
          <DialogDescription>Data {dateIt(row.data as any)} · {Number(row.ore ?? 0).toFixed(2)} ore</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nota (opzionale)</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Es. rapportino verificato" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>Approva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── REJECT ────────────────────────────────────────────────────────────────
export function RejectDialog({ row, open, onOpenChange }: {
  row: RapportinoRow & Extras & { updated_at: string };
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const fn = useServerFn(rejectRapportino);
  const invalidate = useInvalidate();
  const m = useMutation({
    mutationFn: async () => await fn({ data: { id: row.id, expected_updated_at: row.updated_at, reason: reason.trim() } }),
    onSuccess: () => { toast.success("Rapportino respinto"); invalidate(); onOpenChange(false); setReason(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const disabled = reason.trim().length < 5 || m.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Respingi rapportino</DialogTitle>
          <DialogDescription>L'autore potrà correggerlo e reinviarlo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Motivazione * (min. 5 caratteri)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Spiega il motivo del rifiuto…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button variant="destructive" disabled={disabled} onClick={() => m.mutate()}>Respingi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── REOPEN ────────────────────────────────────────────────────────────────
export function ReopenDialog({ row, open, onOpenChange }: {
  row: RapportinoRow & Extras & { updated_at: string };
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const fn = useServerFn(reopenRejectedRapportino);
  const invalidate = useInvalidate();
  const m = useMutation({
    mutationFn: async () => await fn({ data: { id: row.id, expected_updated_at: row.updated_at } }),
    onSuccess: () => { toast.success("Rapportino riaperto in bozza"); invalidate(); onOpenChange(false); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Riapri in bozza</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {row.rejection_reason && (
                <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm">
                  <div className="font-medium text-rose-800">Motivazione del rifiuto</div>
                  <div className="text-rose-700">{row.rejection_reason}</div>
                </div>
              )}
              <div>Il rapportino tornerà in bozza per essere corretto. Lo storico del rifiuto verrà conservato.</div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annulla</AlertDialogCancel>
          <AlertDialogAction disabled={m.isPending} onClick={(e) => { e.preventDefault(); m.mutate(); }}>Riapri</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── CANCEL ────────────────────────────────────────────────────────────────
export function CancelDialog({ row, open, onOpenChange }: {
  row: RapportinoRow & Extras & { updated_at: string };
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const fn = useServerFn(cancelRapportino);
  const invalidate = useInvalidate();
  const m = useMutation({
    mutationFn: async () => await fn({ data: { id: row.id, expected_updated_at: row.updated_at, reason: reason.trim() } }),
    onSuccess: () => { toast.success("Rapportino annullato"); invalidate(); onOpenChange(false); setReason(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const disabled = reason.trim().length < 5 || m.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annulla rapportino</DialogTitle>
          <DialogDescription>Stato terminale: non sarà più possibile modificarlo o riportarlo attivo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Motivazione * (min. 5 caratteri)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Spiega il motivo dell'annullamento…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
          <Button variant="destructive" disabled={disabled} onClick={() => m.mutate()}>Annulla rapportino</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
