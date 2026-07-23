
# Sprint 2 — CRM Clienti, Contatti, Attività

## FASE 1 — Audit (risultato)

### Tabella `clienti` esistente
Colonne: `id`, `organization_id`, `ragione_sociale` (NOT NULL), `partita_iva`, `codice_fiscale`, `indirizzo`, `citta`, `cap`, `provincia`, `telefono`, `email`, `pec`, `referente`, `note`, `created_at`, `updated_at`.

Indici: PK, UNIQUE composite `(id, organization_id)`, btree `organization_id`.
FK composite anti cross-tenant già in uso verso `commesse`, `preventivi`, `documenti`.
Trigger `updated_at` presente.

Policy RLS attive (per ruolo, via `has_any_role`):
- SELECT: tutti i ruoli interni (inclusi operaio, capocantiere, responsabile_commessa).
- INSERT/UPDATE: proprietario, amministratore, ufficio_tecnico, amministrazione.
- DELETE: proprietario, amministratore (cancellazione fisica ancora possibile).

### UI Clienti (`src/routes/_authenticated/clienti.tsx`)
CRUD base con Dialog inline, senza scheda dettaglio, senza contatti/attività/timeline, senza filtri, senza archiviazione. `DELETE` fisica esposta. Query dirette a `profiles` per `organization_id` (non usa `useCurrentUser`).

### Mancanti
Nessuna tabella `cliente_contatti`, `crm_attivita`. Nessun enum `cliente_tipo`, `cliente_stato`, `attivita_tipo/stato/priorita`. Nessun campo `tipo`, `nome/cognome`, `stato_cliente`, `fonte_acquisizione`, `responsabile_id`, `created_by`, `archived_at/by`, `cellulare`, `sito_web`, `codice_destinatario`, `numero_civico`, `paese`, `note_interne`.

### Duplicati
Nessuno rilevato nei dati attuali (base fresh).

---

## Piano di intervento

### Step 1 — Migration DB (unica migration versionata)

1. **Enum**
   - `cliente_tipo`: `persona_fisica`, `azienda`, `condominio`, `ente`, `altro`.
   - `cliente_stato`: `potenziale`, `attivo`, `inattivo`, `archiviato`.
   - `attivita_tipo`: `telefonata`, `email`, `incontro`, `sopralluogo`, `nota`, `promemoria`, `altro`.
   - `attivita_stato`: `pianificata`, `completata`, `annullata`.
   - `attivita_priorita`: `bassa`, `normale`, `alta`, `urgente`.

2. **`ALTER TABLE clienti`** — aggiungere: `tipo` (default `azienda`, backfill), `denominazione` (backfill = `ragione_sociale`), `nome`, `cognome`, `codice_destinatario`, `cellulare`, `sito_web`, `numero_civico`, `paese` (default `IT`), `note_interne`, `fonte_acquisizione` (text controllato), `stato_cliente` (default `attivo`), `responsabile_id` (FK `profiles`), `created_by` (FK `profiles`), `archived_at`, `archived_by`. `ragione_sociale` diventa nullable (retro-compat: mantenuto per aziende).

3. **`cliente_contatti`** (nuova): campi come da spec + FK composite `(cliente_id, organization_id)` → `clienti(id, organization_id)`. Indice unico parziale per `is_primary` attivo per cliente.

4. **`crm_attivita`** (nuova): campi come da spec + FK composite verso `clienti` e `cliente_contatti`. Trigger che valorizza `completata_at` quando `stato=completata`.

5. **Indici**: come da spec (evitando duplicati con quelli esistenti).

6. **RLS + GRANT** per le due nuove tabelle. Aggiornamento policy `clienti`:
   - SELECT: escludere `operaio`, `cliente`, `fornitore`.
   - DELETE: **rimossa dalla UI** — restringere a `proprietario` soltanto (o rimuovere del tutto e usare solo archiviazione).
   - UPDATE: mantenuto set attuale.
   - Nuova regola: archived_at è modificabile solo tramite server function.

7. **Nessun policy ricorsiva**, uso di `has_any_role` e `is_org_member`.

### Step 2 — Server functions (`src/lib/crm.functions.ts`)
Tutte con `requireSupabaseAuth`, derivano `organization_id` dal profilo del chiamante:
- `createCliente` — normalizza P.IVA/CF/email/telefono; controllo duplicati (blocco P.IVA/CF identici non archiviati; avviso email/tel/denominazione simile ritornato come `warnings`).
- `updateCliente` — protegge `organization_id`, `created_by`, `archived_*`.
- `archiveCliente` / `restoreCliente`.
- `setResponsabile`.
- `createContatto` / `updateContatto` / `archiveContatto` / `setContattoPrimary`.
- `createAttivita` / `updateAttivita` / `completeAttivita` / `cancelAttivita`.
- Ogni operazione scrive in `audit_log` via server (INSERT client-side su audit_log resta vietato).

### Step 3 — UI

- **`/clienti`** (lista): KPI (attivi/potenziali/archiviati/attività in scadenza), ricerca full-text lato client su set paginato (limit 100 + "carica altri"), filtri tipo/stato/responsabile/fonte/città, ordinamento, azioni per riga.
- **`/clienti/$clienteId`** (nuova): header + tab Panoramica / Contatti / Attività / Preventivi / Commesse / Documenti / Storico (timeline aggregata).
- **Form cliente**: dinamico per tipo, validazione zod, dialogo "Possibili duplicati" prima del salvataggio, azione "Archivia" al posto di "Elimina".
- **Componenti nuovi**: `ClienteForm`, `ContattoForm`, `AttivitaForm`, `ClienteTimeline`, `DuplicatiDialog`.
- Sidebar: nessun cambiamento (Clienti già presente). Operaio: la voce viene nascosta.

### Step 4 — Integrazioni
- **Preventivi**: link "Nuovo preventivo" dalla scheda cliente precompila `cliente_id`.
- **Commesse / Documenti**: sola lettura nella scheda (link a modulo esistente).

### Step 5 — Verifiche
- `tsgo` per typecheck.
- Test manuali chiave (creazione, duplicati P.IVA, archiviazione, RLS cross-tenant via query psql).
- Regressione: login, profilo, organizzazione, dashboard, altri moduli invariati.

## Note & limiti dichiarati
- L'invio reale di email/telefonate non è implementato (solo registrazione attività), come da spec.
- I test end-to-end automatici non sono disponibili; test eseguiti manualmente + psql.
- Seed demo non toccato.
- Nessun accesso operaio al CRM (voce nascosta + RLS SELECT ristretta).

Confermi il piano? Procedo con la migration in un secondo passaggio.
