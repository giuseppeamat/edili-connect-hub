import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listOrganizationMembers,
  createOrganizationMember,
  updateOrganizationMember,
  archiveOrganizationMember,
  restoreOrganizationMember,
  setOrganizationMemberAccess,
} from "@/lib/organization-members.functions";
import { createInvite } from "@/lib/invites.functions";
import {
  ACCESS_STATE_LABELS,
  ASSIGNABLE_MEMBER_ROLES,
  canInviteMember,
  deriveAccessState,
  memberFullName,
  type AppRole,
  type MemberAccessState,
} from "@/lib/organization-members-model";
import { ROLE_LABELS } from "@/hooks/use-current-user";
import { getPublicAppUrl } from "@/lib/app-url";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Archive, Copy, MoreHorizontal, Pencil, RotateCcw, Send, UserPlus } from "lucide-react";

type MemberRow = {
  id: string;
  user_id: string | null;
  nome: string;
  cognome: string | null;
  email: string | null;
  telefono: string | null;
  ruolo_organizzativo: AppRole;
  qualifica: string | null;
  stato_accesso: MemberAccessState;
  is_active: boolean;
  archived_at: string | null;
  updated_at: string;
  invito: { status: string; expires_at: string } | null;
};

const ACCESS_BADGE: Record<MemberAccessState, string> = {
  senza_accesso: "text-muted-foreground",
  invitato: "border-amber-500 text-amber-700",
  attivo: "border-green-600 text-green-700",
  invito_scaduto: "border-destructive text-destructive",
  disabilitato: "text-muted-foreground",
};

export function MembriTab({ isProprietario }: { isProprietario: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listOrganizationMembers);
  const createFn = useServerFn(createOrganizationMember);
  const updateFn = useServerFn(updateOrganizationMember);
  const archiveFn = useServerFn(archiveOrganizationMember);
  const restoreFn = useServerFn(restoreOrganizationMember);
  const accessFn = useServerFn(setOrganizationMemberAccess);
  const inviteFn = useServerFn(createInvite);

  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [freshInvite, setFreshInvite] = useState<string | null>(null);

  const allowedRoles = ASSIGNABLE_MEMBER_ROLES.filter((r) =>
    isProprietario ? true : r !== "amministratore",
  );

  const { data: members = [], isLoading, isError, error, refetch } = useQuery<MemberRow[]>({
    queryKey: ["organization-members", showArchived],
    queryFn: async () => (await listFn({ data: { includeArchived: showArchived } })) as any,
  });

  /**
   * Invalidazione mirata: elenco membri + risoluzione permessi/identità.
   * Cambi di ruolo o di stato accesso devono riflettersi subito su menu e route.
   */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["organization-members"] });
    qc.invalidateQueries({ queryKey: ["current-user"] });
    qc.invalidateQueries({ queryKey: ["current-role"] });
    qc.invalidateQueries({ queryKey: ["assignable-members"] });
    qc.invalidateQueries({ queryKey: ["notifiche"] });
  };


  const save = useMutation({
    mutationFn: async (v: any) =>
      editing
        ? updateFn({ data: { ...v, id: editing.id, expected_updated_at: editing.updated_at } })
        : createFn({ data: v }),
    onSuccess: (_data: any, variables: any) => {
      const wasEditing = Boolean(editing);
      const changedRole =
        wasEditing && editing?.ruolo_organizzativo !== variables?.ruolo_organizzativo;

      invalidate();
      setDialogOpen(false);
      setEditing(null);
      toast.success(wasEditing ? "Membro aggiornato" : "Membro creato senza accesso");
      if (changedRole) {
        toast.info(
          "Ruolo aggiornato: il membro vedrà i nuovi permessi entro pochi istanti o al prossimo aggiornamento della pagina.",
        );
      }
    },
    onError: (e: any) => toast.error(e.message),

  });

  const archive = useMutation({
    mutationFn: async (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Membro archiviato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const restore = useMutation({
    mutationFn: async (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Membro ripristinato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const access = useMutation({
    mutationFn: async (v: { id: string; stato: MemberAccessState }) => accessFn({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("Accesso aggiornato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const invite = useMutation({
    mutationFn: async (m: MemberRow) =>
      inviteFn({ data: { email: m.email!, role: m.ruolo_organizzativo as any } }),
    onSuccess: (r: any) => {
      setFreshInvite(`${getPublicAppUrl()}/accetta-invito?token=${encodeURIComponent(r.token)}`);
      invalidate();
      qc.invalidateQueries({ queryKey: ["invites"] });
      toast.success("Invito creato");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (m: MemberRow) => {
    setEditing(m);
    setDialogOpen(true);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save.mutate({
      nome: String(fd.get("nome") ?? "").trim(),
      cognome: String(fd.get("cognome") ?? "").trim() || null,
      email: String(fd.get("email") ?? "").trim() || null,
      telefono: String(fd.get("telefono") ?? "").trim() || null,
      qualifica: String(fd.get("qualifica") ?? "").trim() || null,
      ruolo_organizzativo: String(fd.get("ruolo") ?? "operaio"),
    });
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="archiviati" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="archiviati" className="text-sm text-muted-foreground">
            Mostra archiviati
          </Label>
        </div>
        <Button onClick={openNew}>
          <UserPlus className="h-4 w-4 mr-1" /> Nuovo membro
        </Button>
      </div>

      {freshInvite && (
        <Alert>
          <AlertTitle>Link di invito generato</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Mostrato una sola volta: copialo e invialo alla persona.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <Input readOnly value={freshInvite} className="font-mono text-xs flex-1 min-w-48" />
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(freshInvite);
                  toast.success("Link copiato");
                }}
              >
                <Copy className="h-4 w-4 mr-1" /> Copia
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFreshInvite(null)}>
                Chiudi
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Impossibile caricare i membri</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs">{(error as any)?.message}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Riprova
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Membri ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead className="hidden md:table-cell">Contatti</TableHead>
                <TableHead>Ruolo</TableHead>
                <TableHead className="hidden sm:table-cell">Qualifica</TableHead>
                <TableHead>Accesso</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const stato = deriveAccessState(m, m.invito);
                const isOwner = m.ruolo_organizzativo === "proprietario";
                return (
                  <TableRow key={m.id} className={m.archived_at ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="font-medium">{memberFullName(m)}</div>
                      {m.archived_at && (
                        <span className="text-xs text-muted-foreground">Archiviato</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      <div>{m.email ?? "—"}</div>
                      <div>{m.telefono ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ROLE_LABELS[m.ruolo_organizzativo] ?? m.ruolo_organizzativo}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {m.qualifica ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ACCESS_BADGE[stato]}>
                        {ACCESS_STATE_LABELS[stato]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" aria-label={`Azioni per ${memberFullName(m)}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(m)} disabled={isOwner}>
                            <Pencil className="h-4 w-4 mr-2" /> Modifica
                          </DropdownMenuItem>
                          {canInviteMember({ ...m, stato_accesso: stato }) && (
                            <DropdownMenuItem onClick={() => invite.mutate(m)}>
                              <Send className="h-4 w-4 mr-2" />
                              {stato === "invito_scaduto" ? "Rinvia invito" : "Invita al gestionale"}
                            </DropdownMenuItem>
                          )}
                          {m.user_id && !isOwner && stato === "attivo" && (
                            <DropdownMenuItem
                              onClick={() => access.mutate({ id: m.id, stato: "disabilitato" })}
                            >
                              Disabilita accesso
                            </DropdownMenuItem>
                          )}
                          {m.user_id && !isOwner && stato === "disabilitato" && (
                            <DropdownMenuItem
                              onClick={() => access.mutate({ id: m.id, stato: "attivo" })}
                            >
                              Riattiva accesso
                            </DropdownMenuItem>
                          )}
                          {m.archived_at ? (
                            <DropdownMenuItem onClick={() => restore.mutate(m.id)}>
                              <RotateCcw className="h-4 w-4 mr-2" /> Ripristina
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={isOwner}
                              onClick={() =>
                                confirm(
                                  "Archiviare questo membro? Lo storico resta invariato ma non sarà più assegnabile.",
                                ) && archive.mutate(m.id)
                              }
                            >
                              <Archive className="h-4 w-4 mr-2" /> Archivia
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nessun membro. Aggiungi le persone che lavorano in azienda, anche senza accesso.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica membro" : "Nuovo membro"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nome">Nome *</Label>
              <Input id="nome" name="nome" required maxLength={80} defaultValue={editing?.nome ?? ""} />
            </div>
            <div>
              <Label htmlFor="cognome">Cognome</Label>
              <Input id="cognome" name="cognome" maxLength={80} defaultValue={editing?.cognome ?? ""} />
            </div>
            <div>
              <Label htmlFor="email">Email (facoltativa)</Label>
              <Input id="email" name="email" type="email" defaultValue={editing?.email ?? ""} />
              <p className="text-xs text-muted-foreground mt-1">
                Serve solo per invitare la persona ad accedere.
              </p>
            </div>
            <div>
              <Label htmlFor="telefono">Telefono</Label>
              <Input id="telefono" name="telefono" maxLength={40} defaultValue={editing?.telefono ?? ""} />
            </div>
            <div>
              <Label htmlFor="qualifica">Qualifica / mansione</Label>
              <Input id="qualifica" name="qualifica" maxLength={80} defaultValue={editing?.qualifica ?? ""} />
            </div>
            <div>
              <Label>Ruolo *</Label>
              <Select
                name="ruolo"
                defaultValue={
                  editing && editing.ruolo_organizzativo !== "proprietario"
                    ? editing.ruolo_organizzativo
                    : "operaio"
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                {editing ? "Salva" : "Crea membro"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
