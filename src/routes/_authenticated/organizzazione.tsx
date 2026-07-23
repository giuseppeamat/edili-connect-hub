import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  createInvite,
  regenerateInvite,
  revokeInvite,
  changeMemberRole,
  setMemberActive,
} from "@/lib/invites.functions";
import { useCurrentUser, ROLE_LABELS, type AppRole } from "@/hooks/use-current-user";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, RefreshCw, Trash2, UserPlus, Ban, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/organizzazione")({
  head: () => ({
    meta: [
      { title: "Organizzazione — CantiereOS" },
      { name: "description", content: "Gestione dati aziendali, membri e inviti." },
    ],
  }),
  component: OrganizzazionePage,
});

const INVITABLE: AppRole[] = [
  "amministratore",
  "ufficio_tecnico",
  "amministrazione",
  "responsabile_commessa",
  "capocantiere",
  "operaio",
  "cliente",
  "fornitore",
];

function OrganizzazionePage() {
  const { organizationId, isAdmin, isProprietario, isLoading } = useCurrentUser();

  if (isLoading) return <div className="p-6 text-muted-foreground">Caricamento…</div>;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Organizzazione" />
        <Alert>
          <AlertTitle>Accesso limitato</AlertTitle>
          <AlertDescription>
            Solo Proprietario e Amministratore possono gestire membri e inviti.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Organizzazione"
        description="Dati azienda, membri e inviti"
      />
      <Tabs defaultValue="azienda">
        <TabsList>
          <TabsTrigger value="azienda">Dati azienda</TabsTrigger>
          <TabsTrigger value="membri">Membri</TabsTrigger>
          <TabsTrigger value="inviti">Inviti</TabsTrigger>
        </TabsList>
        <TabsContent value="azienda">
          <OrgDataCard organizationId={organizationId!} canEdit={isAdmin} />
        </TabsContent>
        <TabsContent value="membri">
          <MembriTab organizationId={organizationId!} isProprietario={isProprietario} />
        </TabsContent>
        <TabsContent value="inviti">
          <InvitiTab organizationId={organizationId!} isProprietario={isProprietario} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------- ORG DATA ----------------
function OrgDataCard({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: org } = useQuery({
    queryKey: ["organization", organizationId],
    queryFn: async () =>
      (await supabase.from("organizations").select("*").eq("id", organizationId).single()).data,
  });

  const save = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from("organizations").update(payload).eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization"] });
      qc.invalidateQueries({ queryKey: ["current-user"] });
      toast.success("Dati aziendali aggiornati");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!org) return null;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {};
    fd.forEach((v, k) => (payload[k] = String(v || "").trim() || null));
    save.mutate(payload);
  };

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Dati azienda</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field name="nome" label="Ragione sociale *" defaultValue={org.nome ?? ""} required />
          <Field name="nome_commerciale" label="Nome commerciale" defaultValue={org.nome_commerciale ?? ""} />
          <Field name="partita_iva" label="P.IVA" defaultValue={org.partita_iva ?? ""} />
          <Field name="codice_fiscale" label="Codice fiscale" defaultValue={org.codice_fiscale ?? ""} />
          <Field name="email" label="Email" type="email" defaultValue={org.email ?? ""} />
          <Field name="pec" label="PEC" type="email" defaultValue={org.pec ?? ""} />
          <Field name="telefono" label="Telefono" defaultValue={org.telefono ?? ""} />
          <Field name="sito_web" label="Sito web" defaultValue={org.sito_web ?? ""} />
          <Field name="indirizzo" label="Indirizzo" defaultValue={org.indirizzo ?? ""} />
          <Field name="citta" label="Città" defaultValue={org.citta ?? ""} />
          <Field name="cap" label="CAP" defaultValue={org.cap ?? ""} />
          <Field name="provincia" label="Provincia" defaultValue={org.provincia ?? ""} />
          <Field name="paese" label="Paese" defaultValue={org.paese ?? "IT"} />
          {canEdit && (
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={save.isPending}>Salva</Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Field(props: { name: string; label: string; defaultValue?: string; type?: string; required?: boolean }) {
  return (
    <div>
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input id={props.name} name={props.name} type={props.type ?? "text"} defaultValue={props.defaultValue} required={props.required} />
    </div>
  );
}

// ---------------- MEMBRI ----------------
type MemberRow = {
  id: string;
  nome: string | null;
  cognome: string | null;
  email: string | null;
  is_active: boolean;
  role: AppRole | null;
};

function MembriTab({ organizationId, isProprietario }: { organizationId: string; isProprietario: boolean }) {
  const qc = useQueryClient();
  const changeRole = useServerFn(changeMemberRole);
  const setActive = useServerFn(setMemberActive);

  const { data: members = [] } = useQuery<MemberRow[]>({
    queryKey: ["members", organizationId],
    queryFn: async () => {
      const [{ data: profs }, { data: roles }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, nome, cognome, email, is_active")
          .eq("organization_id", organizationId),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("organization_id", organizationId),
      ]);
      const roleByUser = new Map<string, AppRole>();
      (roles ?? []).forEach((r: any) => roleByUser.set(r.user_id, r.role));
      return (profs ?? []).map((p: any) => ({
        id: p.id,
        nome: p.nome,
        cognome: p.cognome,
        email: p.email,
        is_active: p.is_active,
        role: roleByUser.get(p.id) ?? null,
      }));
    },
  });

  const mRole = useMutation({
    mutationFn: async (v: { user_id: string; role: AppRole }) =>
      changeRole({ data: v as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Ruolo aggiornato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mActive = useMutation({
    mutationFn: async (v: { user_id: string; active: boolean }) => setActive({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Membro aggiornato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Membri ({members.length})</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Ruolo</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isOwner = m.role === "proprietario";
              const allowed = INVITABLE.filter((r) => (isProprietario ? true : r !== "amministratore"));
              return (
                <TableRow key={m.id}>
                  <TableCell>{[m.nome, m.cognome].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="text-xs">{m.email}</TableCell>
                  <TableCell>
                    {isOwner ? (
                      <Badge>Proprietario</Badge>
                    ) : (
                      <Select
                        value={m.role ?? undefined}
                        onValueChange={(v) => mRole.mutate({ user_id: m.id, role: v as AppRole })}
                      >
                        <SelectTrigger className="w-52"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {allowed.map((r) => (
                            <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.is_active ? (
                      <Badge variant="outline" className="text-green-700 border-green-700">Attivo</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Disattivato</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!isOwner &&
                      (m.is_active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => confirm("Disattivare questo membro?") && mActive.mutate({ user_id: m.id, active: false })}
                        >
                          <Ban className="h-4 w-4 mr-1" /> Disattiva
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mActive.mutate({ user_id: m.id, active: true })}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Riattiva
                        </Button>
                      ))}
                  </TableCell>
                </TableRow>
              );
            })}
            {members.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nessun membro.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- INVITI ----------------
type InviteRow = {
  id: string;
  email: string;
  role: AppRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
};

function InvitiTab({ organizationId, isProprietario }: { organizationId: string; isProprietario: boolean }) {
  const qc = useQueryClient();
  const createFn = useServerFn(createInvite);
  const regenFn = useServerFn(regenerateInvite);
  const revokeFn = useServerFn(revokeInvite);
  const [freshToken, setFreshToken] = useState<{ inviteId: string; token: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: invites = [] } = useQuery<InviteRow[]>({
    queryKey: ["invites", organizationId],
    queryFn: async () =>
      ((await supabase
        .from("invites")
        .select("id, email, role, status, created_at, expires_at")
        .order("created_at", { ascending: false })).data as any) ?? [],
  });

  const create = useMutation({
    mutationFn: async (v: { email: string; role: AppRole }) => createFn({ data: v as any }),
    onSuccess: (r: any) => {
      setFreshToken({ inviteId: r.invite_id, token: r.token });
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["invites"] });
      toast.success("Invito creato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const regen = useMutation({
    mutationFn: async (id: string) => regenFn({ data: { invite_id: id } }),
    onSuccess: (r: any) => {
      setFreshToken({ inviteId: r.invite_id, token: r.token });
      qc.invalidateQueries({ queryKey: ["invites"] });
      toast.success("Nuovo link generato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => revokeFn({ data: { invite_id: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invites"] });
      toast.success("Invito revocato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const allowedRoles = INVITABLE.filter((r) => (isProprietario ? true : r !== "amministratore"));
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<AppRole>(allowedRoles[0]);

  const onCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email || !newRole) return;
    create.mutate({ email, role: newRole });
    setNewEmail("");
  };

  const inviteUrl = (token: string) =>
    `${window.location.origin}/accetta-invito?token=${encodeURIComponent(token)}`;
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token));
    toast.success("Link copiato negli appunti");
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="h-4 w-4 mr-1" /> Nuovo invito</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invita un membro</DialogTitle></DialogHeader>
            <form onSubmit={onCreate} className="space-y-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="off"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div>
                <Label>Ruolo</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allowedRoles.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>Crea invito</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {freshToken && (
        <Alert>
          <AlertTitle>Link di invito generato</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Questo link viene mostrato una sola volta. Copialo e consegnalo al destinatario.
            </p>
            <div className="flex gap-2 items-center">
              <Input readOnly value={inviteUrl(freshToken.token)} className="font-mono text-xs" />
              <Button size="sm" onClick={() => copy(freshToken.token)}>
                <Copy className="h-4 w-4 mr-1" /> Copia
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFreshToken(null)}>Chiudi</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>Inviti ({invites.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Ruolo</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Scadenza</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="text-xs">{inv.email}</TableCell>
                  <TableCell>{ROLE_LABELS[inv.role]}</TableCell>
                  <TableCell>
                    <StatusBadge status={inv.status} expiresAt={inv.expires_at} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(inv.expires_at).toLocaleString("it-IT")}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {inv.status === "pending" && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(inv.id)}>
                        <Trash2 className="h-4 w-4 mr-1" /> Revoca
                      </Button>
                    )}
                    {(inv.status === "pending" || inv.status === "revoked" || inv.status === "expired") && (
                      <Button size="sm" variant="ghost" onClick={() => regen.mutate(inv.id)}>
                        <RefreshCw className="h-4 w-4 mr-1" /> Rigenera link
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {invites.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nessun invito.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status, expiresAt }: { status: InviteRow["status"]; expiresAt: string }) {
  const expired = status === "pending" && new Date(expiresAt).getTime() < Date.now();
  if (expired) return <Badge variant="outline">Scaduto</Badge>;
  const map: Record<string, { label: string; className?: string }> = {
    pending: { label: "In attesa", className: "border-amber-500 text-amber-700" },
    accepted: { label: "Accettato", className: "border-green-600 text-green-700" },
    revoked: { label: "Revocato", className: "text-muted-foreground" },
    expired: { label: "Scaduto" },
  };
  const m = map[status];
  return <Badge variant="outline" className={m.className}>{m.label}</Badge>;
}
