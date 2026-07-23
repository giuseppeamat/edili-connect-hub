import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createCliente, updateCliente } from "@/lib/crm.functions";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Tipo = "persona_fisica" | "azienda" | "condominio" | "ente" | "altro";

export type ClienteFormValues = {
  id?: string;
  tipo: Tipo;
  denominazione: string;
  nome?: string | null;
  cognome?: string | null;
  ragione_sociale?: string | null;
  codice_fiscale?: string | null;
  partita_iva?: string | null;
  codice_destinatario?: string | null;
  pec?: string | null;
  email?: string | null;
  telefono?: string | null;
  cellulare?: string | null;
  sito_web?: string | null;
  indirizzo?: string | null;
  numero_civico?: string | null;
  cap?: string | null;
  citta?: string | null;
  provincia?: string | null;
  paese?: string | null;
  note?: string | null;
  note_interne?: string | null;
  fonte_acquisizione?: string | null;
  stato_cliente?: "potenziale" | "attivo" | "inattivo" | "archiviato";
  responsabile_id?: string | null;
};

const FONTI = ["passaparola", "sito_web", "social", "pubblicita", "portale_immobiliare", "cliente_esistente", "fornitore", "evento", "altro"];

export function ClienteForm({ initial, onSaved, onCancel }: {
  initial?: ClienteFormValues;
  onSaved: (id: string) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<ClienteFormValues>(initial ?? { tipo: "azienda", denominazione: "", stato_cliente: "attivo", paese: "IT" });
  const [duplicates, setDuplicates] = useState<{ blocks: string[]; warnings: string[] } | null>(null);
  const [confirmedWarnings, setConfirmedWarnings] = useState(false);

  const createFn = useServerFn(createCliente);
  const updateFn = useServerFn(updateCliente);

  const { data: members = [] } = useQuery({
    queryKey: ["org-members-for-select"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, nome, cognome, email, is_active")
        .eq("is_active", true)
        .order("cognome");
      return data ?? [];
    },
  });

  const isPersona = v.tipo === "persona_fisica";
  const requiredDenom = useMemo(() => {
    if (isPersona) return `${v.nome ?? ""} ${v.cognome ?? ""}`.trim();
    return (v.ragione_sociale ?? v.denominazione ?? "").trim();
  }, [v, isPersona]);

  const upd = <K extends keyof ClienteFormValues>(k: K, val: ClienteFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const save = useMutation({
    mutationFn: async () => {
      const denominazione = requiredDenom || v.denominazione;
      if (!denominazione) throw new Error(isPersona ? "Nome e cognome richiesti" : "Ragione sociale / denominazione richiesta");
      const cliente = { ...v, denominazione };
      const force = confirmedWarnings;
      const res = v.id
        ? await updateFn({ data: { id: v.id, patch: cliente, force } as any })
        : await createFn({ data: { cliente: cliente as any, force } });
      if (!res.ok) {
        setDuplicates({ blocks: res.blocks ?? [], warnings: res.warnings ?? [] });
        throw new Error(res.blocks?.[0] ?? "Possibili duplicati");
      }
      if (res.warnings?.length && !confirmedWarnings) {
        setDuplicates({ blocks: [], warnings: res.warnings });
      }
      return (res as any).id ?? v.id!;
    },
    onSuccess: (id) => { toast.success("Cliente salvato"); onSaved(id); },
    onError: (e: any) => toast.error(e.message ?? "Errore"),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Tipo *</Label>
          <Select value={v.tipo} onValueChange={(x) => upd("tipo", x as Tipo)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="persona_fisica">Persona fisica</SelectItem>
              <SelectItem value="azienda">Azienda</SelectItem>
              <SelectItem value="condominio">Condominio</SelectItem>
              <SelectItem value="ente">Ente / PA</SelectItem>
              <SelectItem value="altro">Altro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Stato</Label>
          <Select value={v.stato_cliente ?? "attivo"} onValueChange={(x) => upd("stato_cliente", x as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="potenziale">Potenziale</SelectItem>
              <SelectItem value="attivo">Attivo</SelectItem>
              <SelectItem value="inattivo">Inattivo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isPersona ? (
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nome *</Label><Input value={v.nome ?? ""} onChange={(e) => upd("nome", e.target.value)} required /></div>
          <div><Label>Cognome *</Label><Input value={v.cognome ?? ""} onChange={(e) => upd("cognome", e.target.value)} required /></div>
        </div>
      ) : (
        <div><Label>{v.tipo === "condominio" ? "Denominazione *" : "Ragione sociale *"}</Label>
          <Input value={v.ragione_sociale ?? v.denominazione ?? ""} onChange={(e) => { upd("ragione_sociale", e.target.value); upd("denominazione", e.target.value); }} required />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div><Label>Partita IVA</Label><Input value={v.partita_iva ?? ""} onChange={(e) => upd("partita_iva", e.target.value)} /></div>
        <div><Label>Codice fiscale</Label><Input value={v.codice_fiscale ?? ""} onChange={(e) => upd("codice_fiscale", e.target.value)} /></div>
        {!isPersona && (
          <>
            <div><Label>PEC</Label><Input type="email" value={v.pec ?? ""} onChange={(e) => upd("pec", e.target.value)} /></div>
            <div><Label>Codice destinatario</Label><Input value={v.codice_destinatario ?? ""} onChange={(e) => upd("codice_destinatario", e.target.value)} /></div>
          </>
        )}
        <div><Label>Email</Label><Input type="email" value={v.email ?? ""} onChange={(e) => upd("email", e.target.value)} /></div>
        <div><Label>Sito web</Label><Input value={v.sito_web ?? ""} onChange={(e) => upd("sito_web", e.target.value)} /></div>
        <div><Label>Telefono</Label><Input value={v.telefono ?? ""} onChange={(e) => upd("telefono", e.target.value)} /></div>
        <div><Label>Cellulare</Label><Input value={v.cellulare ?? ""} onChange={(e) => upd("cellulare", e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-4"><Label>Indirizzo</Label><Input value={v.indirizzo ?? ""} onChange={(e) => upd("indirizzo", e.target.value)} /></div>
        <div className="col-span-2"><Label>N. civico</Label><Input value={v.numero_civico ?? ""} onChange={(e) => upd("numero_civico", e.target.value)} /></div>
        <div className="col-span-2"><Label>CAP</Label><Input value={v.cap ?? ""} onChange={(e) => upd("cap", e.target.value)} /></div>
        <div className="col-span-3"><Label>Città</Label><Input value={v.citta ?? ""} onChange={(e) => upd("citta", e.target.value)} /></div>
        <div className="col-span-1"><Label>Prov.</Label><Input maxLength={2} value={v.provincia ?? ""} onChange={(e) => upd("provincia", e.target.value.toUpperCase())} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Fonte acquisizione</Label>
          <Select value={v.fonte_acquisizione ?? "__none"} onValueChange={(x) => upd("fonte_acquisizione", x === "__none" ? null : x)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">—</SelectItem>
              {FONTI.map((f) => <SelectItem key={f} value={f}>{f.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Responsabile interno</Label>
          <Select value={v.responsabile_id ?? "__none"} onValueChange={(x) => upd("responsabile_id", x === "__none" ? null : x)}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">—</SelectItem>
              {members.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>{[m.cognome, m.nome].filter(Boolean).join(" ") || m.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div><Label>Note interne</Label><Textarea rows={3} value={v.note_interne ?? ""} onChange={(e) => upd("note_interne", e.target.value)} /></div>

      {duplicates && (duplicates.blocks.length > 0 || duplicates.warnings.length > 0) && (
        <Alert variant={duplicates.blocks.length ? "destructive" : "default"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{duplicates.blocks.length ? "Duplicato bloccante" : "Possibili duplicati"}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 mt-1 text-sm">
              {[...duplicates.blocks, ...duplicates.warnings].map((s, i) => <li key={i}>{s}</li>)}
            </ul>
            {duplicates.blocks.length === 0 && !confirmedWarnings && (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setConfirmedWarnings(true)}>Procedi comunque</Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Annulla</Button>}
        <Button type="submit" disabled={save.isPending}>Salva</Button>
      </div>
    </form>
  );
}
