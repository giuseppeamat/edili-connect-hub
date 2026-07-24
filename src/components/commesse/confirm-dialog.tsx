import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  requireMotivazione?: boolean;
  motivazionePlaceholder?: string;
  extraField?: {
    key: string;
    label: string;
    type?: "date" | "text";
    defaultValue?: string;
    required?: boolean;
  };
  onConfirm: (values: { motivazione?: string; extra?: string }) => Promise<void> | void;
  isPending?: boolean;
  warning?: string;
};

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "Conferma",
  destructive, requireMotivazione, motivazionePlaceholder, extraField,
  onConfirm, isPending, warning,
}: ConfirmDialogProps) {
  const [motivazione, setMotivazione] = useState("");
  const [extra, setExtra] = useState(extraField?.defaultValue ?? "");
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (requireMotivazione && !motivazione.trim()) {
      setErr("Motivazione obbligatoria");
      return;
    }
    if (extraField?.required && !extra.trim()) {
      setErr(`${extraField.label} obbligatorio`);
      return;
    }
    try {
      await onConfirm({ motivazione: motivazione.trim() || undefined, extra: extra.trim() || undefined });
      setMotivazione(""); setExtra(extraField?.defaultValue ?? "");
    } catch (e: any) {
      setErr(e?.message ?? "Errore");
    }
  };

  const handleOpenChange = (v: boolean) => {
    if (!v && !isPending) {
      setMotivazione(""); setExtra(extraField?.defaultValue ?? ""); setErr(null);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {warning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}
          {extraField && (
            <div>
              <Label>{extraField.label}{extraField.required && " *"}</Label>
              <Input
                type={extraField.type ?? "text"}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                required={extraField.required}
              />
            </div>
          )}
          {requireMotivazione && (
            <div>
              <Label>Motivazione *</Label>
              <Textarea
                value={motivazione}
                onChange={(e) => setMotivazione(e.target.value)}
                placeholder={motivazionePlaceholder ?? "Descrivi brevemente il motivo…"}
                rows={3}
                required
              />
            </div>
          )}
          {err && <div className="text-sm text-destructive">{err}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Annulla
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={isPending}>
              {isPending ? "Attendere…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
