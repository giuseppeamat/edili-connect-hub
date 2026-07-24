# Sprint 4 · Blocco 5 — Fasi di commessa, avanzamento e ritardi

## Audit sintetico

**Stato Blocco 4** — stabile:
- `public.commesse` (39 col.) hardenizzata; contiene già `avanzamento_pct NUMERIC(5,2)` con CHECK `0..100`, default 0. **Nessun trigger** aggiorna oggi il valore: è puramente manuale.
- 7 commesse storiche presenti, tutte con `avanzamento_pct` valorizzato manualmente (0/30/55/100). **Va preservato.**
- `public.cantieri` presente con FK composite `(commessa_id, organization_id)` e cantiere principale per commessa.
- `public.commessa_membri` presente con helper `is_membro_commessa`, `is_membro_cantiere`, `can_access_commessa`, `can_access_cantiere`, `has_any_role` (SECURITY DEFINER, `search_path=public`).
- Enum `commessa_stato`: `bozza, pianificata, in_corso, sospesa, completata, annullata`.
- Nessuna tabella `commessa_fasi | task | milestone` presente (solo `crm_attivita`, non riutilizzabile). Nessun trigger `updated_at` centralizzato: uso funzione condivisa `tg_set_updated_at`.
- RLS commesse: 5 policy (`commesse_sel/ins/upd_admin/upd_responsabile/del`).
- Dashboard e lista commesse leggono `avanzamento_pct` come singolo campo; nessun calcolo client-side aggregato.
- Rapportini: presenti 11 righe, non toccheremo lo schema (integrazione fase_id posticipata a Sprint Rapportini).

**Dipendenze soddisfatte** dal Blocco 4 → procediamo full-scope, esclusa integrazione rapportini (documentata come estensione futura).

## Piano

### Migration 1 · `s4_07_commessa_fasi`
1. **`public.commessa_fasi`** con tutte le colonne del brief + FK composite `(commessa_id, organization_id)` verso `commesse`, `(cantiere_id, organization_id)` verso `cantieri`, `responsabile_id → auth.users ON DELETE SET NULL`, `created_by/archived_by → auth.users ON DELETE SET NULL`.
2. **CHECK**: `posizione >= 0`; `peso_percentuale BETWEEN 0 AND 100`; `avanzamento_percentuale BETWEEN 0 AND 100`; date coerenti (prev./eff.); `stato IN ('non_iniziata','in_corso','sospesa','completata','annullata')`; `stato='completata' ⇒ avanzamento=100`. Le regole cross-tabella (cantiere della stessa commessa, responsabile membro attivo) sono in **trigger** + server functions, non in CHECK.
3. **Indici**: org, commessa, cantiere, responsabile, stato, (commessa,posizione), (commessa,archived_at), date, updated_at.
4. **Trigger**: `updated_at` (riuso `tg_set_updated_at`); `tg_commessa_fasi_validate` (coerenza cantiere↔commessa, org matching); `tg_commessa_fasi_recalc` (AFTER INS/UPD/DEL → chiama `recalculate_commessa_avanzamento` quando `avanzamento_modalita='fasi'`).
5. **Aggiunte a `public.commesse`**: `avanzamento_modalita TEXT NOT NULL DEFAULT 'manuale' CHECK IN ('manuale','fasi')`; `avanzamento_calcolato_at TIMESTAMPTZ NULL`. Default 'manuale' preserva le 7 commesse storiche.
6. **GRANT** su `commessa_fasi`: `SELECT, INSERT, UPDATE, DELETE` a `authenticated`; `ALL` a `service_role`; no `anon`.
7. **RLS** su `commessa_fasi` con helper esistenti del Blocco 4 (nessuna ricorsione):
   - SELECT: `can_access_commessa(commessa_id) OR (cantiere_id IS NOT NULL AND can_access_cantiere(cantiere_id))`.
   - INSERT/UPDATE full: admin, ufficio_tecnico; responsabile_commessa se `commesse.responsabile_id = auth.uid()`.
   - UPDATE limitato (stato/avanzamento/date effettive/note): capocantiere del cantiere assegnato — enforcement dei campi ammessi via **server functions** (RLS ammette la riga; le funzioni filtrano payload). Documentato nel report.
   - DELETE: nessuno via UI (solo `service_role`).
8. **Funzione SQL** `public.recalculate_commessa_avanzamento(_commessa_id uuid)` (SECURITY DEFINER, `search_path=public`):
   - Legge fasi non archiviate e stato ≠ 'annullata';
   - Calcola `SUM(avanzamento*peso)/SUM(peso)` a 2 decimali;
   - Se `SUM(peso)=0` → **non** sovrascrive `avanzamento_pct`;
   - Se modalità = 'manuale' → non tocca `avanzamento_pct` ma aggiorna comunque `avanzamento_calcolato_at` come promemoria (solo se esistono fasi valide);
   - Se modalità = 'fasi' → aggiorna `avanzamento_pct` e `avanzamento_calcolato_at`.
   - Idempotente, no ricorsione (non triggera trigger su commesse che tocchino fasi).
9. **Guardia post-migration** (`DO $$ RAISE $$`): conferma 7 commesse presenti, tutte con `avanzamento_modalita='manuale'`, tutte con `avanzamento_pct` invariato.

### Server functions · `src/lib/commessa-fasi.functions.ts` (nuovo)
`listCommessaFasi`, `getCommessaFase`, `createCommessaFase`, `updateCommessaFase` (rifiuta org_id/commessa_id/stato/avanzamento/created_by/archived_by), `changeCommessaFaseState`, `updateCommessaFaseProgress`, `archiveCommessaFase`, `restoreCommessaFase`, `reorderCommessaFasi` (normalizza posizioni), `distributeCommessaFasiWeights` (equal | proportional; solo su richiesta esplicita).

Su `src/lib/commesse.functions.ts` aggiungo: `setCommessaProgressMode`, `updateManualCommessaProgress`, `recalculateCommessaProgress` (wrapper RPC). Ogni funzione: `requireSupabaseAuth`, verifica ruolo + `can_access_commessa`, controllo `commesse.closed_at/archived_at`, optimistic locking via `expected_updated_at`, audit su `audit_log` con action strings del brief. Motivazione obbligatoria per: riapertura completata, annullamento, riduzione avanzamento, archiviazione fase in corso/completata.

### UI · pagina dettaglio
Aggiungo la 7ª tab **"Fasi"** in `src/routes/_authenticated/commesse.$commessaId.tsx`.
- Nuovo componente `src/components/commesse/fasi-tab.tsx`: riepilogo (avanzamento, modalità, peso totale, contatori: totali/completate/in corso/in ritardo/sospese), lista con progress bar + badge stato + badge ritardo + warning peso≠100, filtri (stato/cantiere/responsabile/ritardo/attive-archiviate), ordinamenti.
- Nuovi dialog in `src/components/commesse/dialogs/`: `fase-form-dialog.tsx` (crea/modifica), `fase-stato-dialog.tsx`, `fase-avanzamento-dialog.tsx`, `fase-archivia-dialog.tsx`, `fase-distribuzione-pesi-dialog.tsx`, `commessa-modalita-dialog.tsx`, `commessa-avanzamento-manuale-dialog.tsx`. Riuso `ConfirmDialog` per operazioni semplici. Nessun `window.prompt/confirm`.
- Alert su tab **Panoramica**: nessuna fase, peso ≠ 100, fasi in ritardo/senza responsabile/sospese, tutte fasi completate ma commessa non completata, commessa completata con fasi aperte.
- Lista `commesse.tsx` e Dashboard: nuova colonna/badge "Ritardi" (aggregato server-side leggero: count fasi in ritardo per commesse visibili in un unico query call). Nessun ricalcolo client-side dell'avanzamento.

### Permessi
Estendo `use-current-user.ts` e `use-current-role.ts` con: `canManageFasi` (admin/ufficio_tecnico/responsabile_commessa sulla propria), `canUpdateFaseOperational` (capocantiere), `canChangeProgressMode` (admin/ufficio_tecnico), `canUpdateManualProgress` (admin/ufficio_tecnico/responsabile). Le UI usano questi flag solo per nascondere/disabilitare; la sicurezza reale resta server-side + RLS.

### Fuori scope (rispettato)
Budget/costi per fase, SAL, Gantt, dipendenze task, ordini, magazzino, notifiche, AI, drag-and-drop, integrazione `fase_id` su rapportini (rinviata).

### Test
Migration verifica (7 commesse, avanzamento invariato, modalità 'manuale'). Test manuali documentati nel report per RLS multi-tenant e matrice ruoli (non eseguibili senza utenti reali di 2 org). Typecheck + build finali.

## Ordine di esecuzione
1. `supabase--migration` → `s4_07_commessa_fasi` (attende approvazione).
2. Server functions (`commessa-fasi.functions.ts` + estensioni a `commesse.functions.ts`).
3. Hook permessi.
4. UI: dialog + `fasi-tab` + integrazione in `commesse.$commessaId.tsx` + alert panoramica + colonna ritardi lista/dashboard.
5. Typecheck.
6. Report finale con matrice test.
