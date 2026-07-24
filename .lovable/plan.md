# Sprint 4 · Blocco 4 — Cantieri, Membri e Dettaglio Commessa

## Sintesi audit

**Stato database attuale**
- `public.commesse`: 39 colonne — canoniche e legacy già presenti (titolo/denominazione, importo/importo_contratto, margini, closed_at/archived_at). OK.
- `public.rapportini`: 11 righe (non 10 come da spec), tutte con `commessa_id` valorizzato → backfill cantiere principale possibile per tutte.
- `public.documenti`: 13 righe, colonna `commessa_id` presente ma non tutte le righe la hanno.
- Tabelle `cantieri`, `commessa_membri`: **non esistono** → da creare.
- Enum `app_role`: `proprietario, amministratore, ufficio_tecnico, amministrazione, responsabile_commessa, capocantiere, operaio, cliente, fornitore` — coerente.
- **7 commesse storiche**, ma tutte con `responsabile_id NULL` (nessuno da sincronizzare in `commessa_membri` al backfill).
- RLS commesse: SELECT concede a `capocantiere` e `operaio` accesso a tutte le commesse dell'org → da restringere per assegnazione.
- Nessun `commessa_fasi` / `commessa_budget` presente (correttamente fuori scope).

**Osservazioni chiave**
- Nessun responsabile assegnato oggi → migrazione responsabile↔membri è banale (nulla da migrare); solo la logica futura deve mantenere sincronia.
- 4 commesse hanno codici duplicati tra 2 organizzazioni diverse (`C2025-01`, `C2025-02`, `C2024-08`): non è cross-tenant, ok.
- `indirizzo_cantiere` legacy popolato in 6/7 commesse → utilizzabile come `indirizzo` del cantiere principale al backfill; per la settima (`test`), backfill con `indirizzo = NULL`.

## Piano

Applicherò **due migration** sequenziali seguite da codice applicativo.

### Migration 1 — `s4_04_cantieri_membri`
Include (unica migration per evitare stati intermedi rotti):
1. `public.commessa_membri` con colonne, CHECK su ruolo_operativo whitelist, FK composite `(commessa_id, organization_id)`, unique parziale `(commessa_id, user_id, ruolo_operativo)` WHERE `is_active AND archived_at IS NULL`, CHECK date, indici richiesti.
2. `public.cantieri` con colonne, CHECK su stato whitelist, FK composite verso commesse, unique `(commessa_id, codice)`, unique parziale `is_principale` per commessa attiva.
3. Aggiunta `cantiere_id` nullable a `commessa_membri` + FK composite `(cantiere_id, organization_id)` + trigger che valida `cantiere.commessa_id = membro.commessa_id`.
4. Aggiunta `cantiere_id` nullable a `rapportini` e `documenti` con FK composite verso cantieri; trigger di coerenza commessa/cantiere.
5. **Backfill**: crea 1 cantiere `PRIN` principale per ognuna delle 7 commesse (nome=titolo/denominazione, indirizzo=indirizzo_cantiere legacy, stato derivato); aggiorna `rapportini.cantiere_id` e `documenti.cantiere_id` con il PRIN della loro commessa quando `commessa_id NOT NULL`.
6. Helper SQL security definer: `is_membro_commessa`, `is_membro_cantiere`, `can_access_commessa`, `can_access_cantiere`, `is_capocantiere_di`. Tutti con `search_path=public`, `GRANT EXECUTE TO authenticated`.
7. RLS su nuove tabelle: full policies SELECT/INSERT/UPDATE per amministrativi, responsabile_commessa (proprie), capocantiere (limitato campi operativi), self-view per membri.
8. **Restringimento RLS `commesse`**: sostituzione `commesse_sel` per limitare `responsabile_commessa`, `capocantiere`, `operaio` alle commesse dove hanno assegnazione attiva (via helper). Amministrativi invariati.
9. GRANT su nuove tabelle: `SELECT,INSERT,UPDATE` a `authenticated`, `ALL` a `service_role`, no `anon`.
10. Trigger `updated_at`.
11. Audit action strings vengono usate dalle server fn (nessuna nuova tabella audit).

Verifiche pre/post nella stessa migration con `DO $$ ... RAISE EXCEPTION $$` se conteggi non tornano (7 commesse → 7 cantieri principali, rapportini count invariato, no cross-tenant).

### Migration 2 — `s4_05_protezione_dati_economici`
- Vista `public.commesse_operativa` che espone i campi non economici (esclude importo*, ricavi_previsti, costi_*, margine_*, budget_costi). RLS legge tramite la vista quando l'utente è solo `capocantiere`/`operaio`. Server fn di list userà payload differenziato per ruolo (soluzione A del brief); la vista serve come backstop.

### Server functions (`src/lib/commesse.functions.ts` + nuovo `src/lib/cantieri.functions.ts`)
Nuove: `listCommessaMembers`, `addCommessaMember`, `updateCommessaMember`, `removeCommessaMember`, `setCommessaResponsabile`, `listCantieri`, `createCantiere`, `updateCantiere`, `archiveCantiere`, `restoreCantiere`, `setCapocantiere`, `listAssignableMembers`, `getCommessaDetail`, `listCommessaAuditEntries`. 
Modifiche: `updateCommessa` non tocca più `responsabile_id` (centralizzato in `setCommessaResponsabile`); `listCommesse` esistente ritorna payload economico solo per ruoli autorizzati (nuovo hook server-side che filtra colonne). `createCommessa` continua a impostare `responsabile_id` e chiama internamente `setCommessaResponsabile` per creare la riga in `commessa_membri`.

### UI
- **Nuova rotta**: `src/routes/_authenticated/commesse.$commessaId.tsx` con Header + 6 tab (Panoramica, Cantieri, Team, Rapportini, Documenti, Storico) usando shadcn `Tabs`.
- **Nuovi componenti**: 
  - `src/components/commesse/dettaglio-header.tsx`
  - `src/components/commesse/panoramica-tab.tsx` (con dialog "Modifica dati generali")
  - `src/components/commesse/cantieri-tab.tsx` (dialog nuovo/modifica cantiere, assegna capocantiere, archivia)
  - `src/components/commesse/team-tab.tsx` (dialog aggiungi/modifica membro, filtri cantiere/ruolo)
  - `src/components/commesse/rapportini-tab.tsx` (read-only list con link)
  - `src/components/commesse/documenti-tab.tsx` (read-only list)
  - `src/components/commesse/storico-tab.tsx` (audit log formattato)
  - `src/components/commesse/dialogs/*.tsx` — dialog per cambio stato, chiusura, archiviazione, riapertura, rimozione membro, archiviazione cantiere (sostituiscono `window.prompt`/`confirm`).
- **Lista commesse**: aggiunge colonne `#cantieri`, riga cliccabile → `/commesse/$id`, sostituzione prompt/confirm con i nuovi dialog, payload economico condizionato al ruolo.

### Audit
Nuovi action strings loggati in `audit_log`:
`commessa.member_added|updated|removed`, `cantiere.created|updated|archived|restored|capocantiere_changed`, `commessa.responsabile_changed`.

### Test
- Verifiche in-migration (RAISE EXCEPTION su conteggi errati).
- Post-migration: query psql di controllo (conteggi, unicità principale, no cross-tenant).
- Typecheck + build automatici a fine turno.
- I test RLS 23-31 richiedono utenti reali di diverse organizzazioni → **non eseguibili automaticamente** in questo turno; verranno documentati nel report finale come "verifica manuale suggerita".

### Fuori scope (rispetto rigoroso del brief)
Nessuna tabella `commessa_fasi` / `commessa_budget`, nessun modulo SAL / Gantt / acquisti / magazzino / notifiche. Nessuna modifica a Storage o al modulo Rapportini (solo aggiunta colonna). Nessuna eliminazione di dati o colonne legacy.

## Dettagli tecnici salienti

**RLS commesse — evita ricorsione**
Le nuove policy usano helper `SECURITY DEFINER` che leggono `commessa_membri` **senza** RLS (bypass definer) → nessuna ricorsione. Le policy su `commessa_membri` non fanno riferimento a `commesse.responsabile_id` per la stessa ragione (usano helper).

**Sincronia responsabile ↔ membri**
Centralizzata in `setCommessaResponsabile`:
1. Termina l'assegnazione precedente (`is_active=false`, `data_fine=today`, `archived_at=now()`).
2. Inserisce nuova riga con `ruolo_operativo='responsabile_commessa'`.
3. Aggiorna `commesse.responsabile_id`.
4. Audit `commessa.responsabile_changed`.
`updateCommessa` **rifiuta** `responsabile_id` in payload con errore chiaro → l'utente usa il dialog dedicato.

**Payload economico ruolo-scoped**
`listCommesse` server fn: se ruoli dell'utente ⊂ `{capocantiere, operaio}` → SELECT esplicito sulle sole colonne non economiche (no `importo*`, no `ricavi_*`, no `costi_*`, no `margine_*`, no `budget_costi`). Amministrativi e responsabile_commessa (per proprie commesse) → payload completo.

## Ordine di esecuzione tool
1. `supabase--migration` → `s4_04_cantieri_membri` (attende approvazione utente).
2. `supabase--migration` → `s4_05_protezione_dati_economici`.
3. Scrittura codice TS (server fn + route + componenti + dialog).
4. Verifica typecheck/build.
5. Query di verifica finale.
6. Report finale.
