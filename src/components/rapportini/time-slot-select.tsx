import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { slotOrari, slotPause } from "@/lib/rapportini-personale";

const NONE = "__none__";

/** Selettore orario a slot fissi da 30 minuti (niente digitazione libera). */
export function TimeSlotSelect({
  value,
  onChange,
  placeholder = "—",
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const slots = slotOrari(30);
  const current = value ? value.slice(0, 5) : "";
  return (
    <Select
      value={current || NONE}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        <SelectItem value={NONE}>—</SelectItem>
        {slots.map((s) => (
          <SelectItem key={s} value={s}>{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Selettore pausa in slot da 30 minuti. */
export function PausaSlotSelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const opts = slotPause(240, 30);
  const safe = opts.includes(value) ? value : 0;
  return (
    <Select value={String(safe)} disabled={disabled} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label="Pausa">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {opts.map((m) => (
          <SelectItem key={m} value={String(m)}>
            {m === 0 ? "Nessuna pausa" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
