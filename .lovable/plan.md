# Team commessa: assegnare qualsiasi membro dell'organizzazione

Oggi la tendina "Aggiungi membro" elenca solo le persone con un account di accesso attivo (viene letta la lista degli utenti, non l'anagrafica membri). Chi è in organizzazione ma non ha ancora accesso all'app non compare.

## Cosa cambia

- La tendina elenca tutti i membri dell'anagrafica organizzazione attivi e non archiviati, con o senza account.
- Accanto ai nomi senza account compare l'etichetta "Senza accesso", così è chiaro chi non può ancora entrare nell'app.
- Restano esclusi i membri con ruolo Cliente o Fornitore (non sono team interno).
- Nella tabella del team i membri senza account vengono mostrati con nome, cognome ed email dell'anagrafica, con lo stesso badge "Senza accesso".
- Se in futuro quel membro accetta l'invito e ottiene l'account, la riga del team resta collegata alla stessa persona.

## Dettagli tecnici

La tabella `commessa_membri` ha già `membro_id` (FK verso `organization_members`) e `user_id` nullable: nessuna migrazione necessaria.

1. `listAssignableMembers` (`src/lib/commesse.functions.ts`): sostituire la lettura da `user_roles` + `profiles` con `organization_members` filtrata su `organization_id`, `archived_at is null`, `is_active`, `ruolo_organizzativo` non in (`cliente`, `fornitore`). Restituire `{ membro_id, user_id, nome, cognome, email, ruolo_organizzativo, has_access }`.
2. `addCommessaMember`: lo schema accetta `membro_id` (uuid) al posto di `user_id`. Il server risolve il membro nell'organizzazione, verifica che sia attivo/non archiviato e non cliente/fornitore, e scrive `membro_id` più `user_id` derivato da `organization_members.user_id` (può restare null). Sostituisce `assertUserActiveInOrg` con l'equivalente su membro.
3. `listCommessaMembers`: arricchire le righe leggendo `organization_members` per `membro_id`, con fallback su `profiles` per le righe storiche che hanno solo `user_id`.
4. UI `AddMemberDialog` e tabella Team in `src/routes/_authenticated/commesse.$commessaId.tsx`: passare `membro_id`, mostrare nome dall'anagrafica e il badge "Senza accesso".

I permessi di gestione team e le regole sul ruolo `responsabile_commessa` restano invariati.
