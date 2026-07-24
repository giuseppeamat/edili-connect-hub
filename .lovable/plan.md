
# Sprint 4 · Blocco 1 — Audit tecnico modulo Commesse

Nessuna modifica applicata al codice, database, policy o dati. Analisi basata su schema live e file reali del progetto.

## 1. Executive summary
La tabella `commesse` esiste ma è ancora "leggera": copre commessa + cantiere in un'unica riga, senza fasi, membri, budget analitico, chiusura/archiviazione, audit dedicato. La conversione da preventivo → commessa è già server-side, atomica e protetta da `UNIQUE(preventivo_id)`, quindi è la parte più solida da cui partire. Le lacune principali sono: mancanza di separazione commessa/cantiere, numerazione buona ma non anno-based coerente col calcolo lato SQL, nessun campo economico "previsto vs consuntivo", nessuna traccia responsabile/capocantiere oltre a un singolo `responsabile_id`, RLS del `responsabile_commessa` troppo larga (accede a tutte le commesse dell'org in SELECT). Raccomando strategia B (tabella `cantieri` 1:N con auto-creazione di un cantiere "principale" per ogni commessa esistente) da fare nel Blocco 4, mantenendo il resto retro-compatibile.

## 2. Stato attuale (dati live)
- 7 commesse totali; 0 senza cliente/org; 7 senza responsabile; 4 senza preventivo; 0 importi/date incoerenti; 0 duplicati codice; 0 preventivi collegati a più commesse; 0 cross-tenant.
- 10 rapportini, 0 orfani da commessa.

## 3. Schema `public.commesse` (reale)
Colonne: `id, organization_id, cliente_id, preventivo_id, responsabile_id, codice, denominazione, indirizzo_cantiere, data_inizio, data_fine_prevista, data_fine_effettiva, importo, budget_costi, costi_sostenuti, avanzamento_pct, stato (enum commessa_stato), note, created_at, updated_at`.
Indici: PK, `(id, organization_id)` unique, `(organization_id, codice)` unique, `preventivo_id` unique parziale, indici su org/cliente/responsabile/stato.
FK composite anti cross-tenant su cliente, preventivo, org.
Trigger: solo `tg_set_updated_at`. Nessun trigger ricalcolo.
RLS: 5 policy (`sel` a tutti i ruoli interni + operaio, `ins/upd_admin` a proprietario/amministratore/ufficio_tecnico, `upd_responsabile` scoped `responsabile_id=auth.uid()`, `del` a proprietario/amministratore).

**Campi mancanti rispetto al target richiesto**: `titolo, descrizione, tipologia, data_apertura, data_inizio_prevista, data_inizio_effettiva, importo_contratto, ricavi_previsti, costi_previsti, costi_impegnati, margine_previsto, margine_aggiornato, margine_percentuale, priorita, note_interne, created_by, archived_at/by, closed_at/by`. Presenti con nome diverso: `denominazione` (≈titolo), `importo` (≈importo_contratto), `budget_costi` (≈costi_previsti), `costi_sostenuti`, `avanzamento_pct` (≈percentuale_avanzamento), `data_inizio` (usata come effettiva/prevista senza distinzione).

## 4. Anomalie dati
Nessuna anomalia bloccante. Unico dato notevole: 7/7 commesse senza `responsabile_id` → coerente col fatto che la creazione da preventivo non lo compila. Va reso obbligatorio o gestito con default esplicito nel Blocco 3.

## 5. Conversione preventivo → commessa
File: `src/lib/preventivi.functions.ts` invoca RPC SQL `convert_preventivo_to_commessa` (SECURITY DEFINER). Anche `change_preventivo_stato` chiama la RPC quando lo stato diventa `accettato`.
Copre: assegnazione codice via `assign_commessa_codice` (advisory lock su org+anno), copia cliente/importo/costi/responsabile/preventivo_id, aggiorna stato preventivo a `convertito`, scrive `preventivo_storico_stati` e `audit_log`, controlla ruolo con `has_any_role`, blocca doppia conversione via `UNIQUE(preventivo_id)` + check esplicito.
Verdetto: **atomica** (singola transazione SQL), doppia conversione impedita a livello DB. Manca: propagazione `titolo/descrizione` (usa `COALESCE(titolo, oggetto)` come denominazione, i campi puri non esistono ancora), nessuna copia di budget analitico (non esiste), nessun campo `ricavi_previsti` esplicito distinto da `importo`.

## 6. Commessa vs cantiere — valutazione
Oggi la commessa **è** il cantiere (`indirizzo_cantiere` in `commesse`). Rapportini e documenti puntano solo a commessa. In edilizia reale una commessa può avere più cantieri (lotti, appartamenti, sedi diverse) ma il 90% dei casi PMI è 1:1.

| Opzione | Pro | Contro | Rischio dati |
|---|---|---|---|
| A · lasciare 1 entità | zero migrazione, zero regressioni | non copre commesse multi-cantiere, blocca crescita | nessuno |
| **B · tabella `cantieri` 1:N + backfill cantiere "principale" per ogni commessa esistente** | pulizia semantica, retro-compatibile, rapportini/documenti possono aggiungere `cantiere_id` nullable puntando al principale | migrazione + doppia scrittura temporanea sui campi indirizzo | basso (backfill deterministico) |
| C · come B ma senza backfill | schema pulito ma dati vecchi orfani | rapportini storici senza cantiere | medio |
| D · `cantieri` senza migrazione dei dati | rapido | rompe le 7 commesse esistenti | alto |

Impatti B: rapportini e documenti acquisiscono `cantiere_id` **nullable** in fase 1 (retro-compat), UI mostra "Cantiere principale" di default, RLS eredita da commessa via join (o FK composite `(id, organization_id)` come già fatto altrove).

**Raccomandazione: opzione B nel Blocco 4**. Nel Blocco 2/3 lasciamo `indirizzo_cantiere` su `commesse` come "indirizzo principale" per non rompere UI. Le colonne dedicate (`citta, provincia, referente_cantiere, capocantiere_id, stato_operativo, note_operative`) nascono direttamente su `cantieri`.

## 7. Rapportini
Struttura reale: `id, organization_id, commessa_id (nullable, FK composite), user_id, data, ora_inizio, ora_fine, ore, lavorazione, note, foto_urls, created_at`. **Manca**: `stato`, `approvazione/approvato_by/approvato_at`, `costo_orario`/costo derivato, `updated_at`, trigger che aggiorna `commesse.costi_sostenuti`. RLS: 6 policy corrette con separazione operaio (own-row) vs internal.
Nessun rapportino orfano, nessun cross-tenant.
Compatibilità con futuro `cantiere_id`: **ok**, colonna aggiungibile nullable senza rompere nulla. Aggiornamento automatico costi commessa: **assente**, va introdotto nel Blocco 6 (trigger o ricalcolo on-demand). **Sprint 4 fuori scope per Rapportini** salvo aggiunta `cantiere_id` opzionale nel Blocco 4.

## 8. Documenti
`documenti.commessa_id` presente + FK composite `(commessa_id, organization_id)`. Storage path libero (non organizzato per commessa). RLS scoped su org. Aggiunta futura `cantiere_id` **nullable + FK composite**: compatibile. Nessuna esposizione cross-tenant. Nessuna modifica in Sprint 4 salvo aggiunta colonna nel Blocco 4.

## 9. Ruoli e RLS — matrice reale su `commesse`
| Ruolo | SEL | INS | UPD | DEL | Cambio stato | Cambio responsabile | Legge costi/margini |
|---|---|---|---|---|---|---|---|
| proprietario | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| amministratore | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ufficio_tecnico | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| amministrazione | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| responsabile_commessa | ✅ **(tutte)** | ❌ | ✅ solo se `responsabile_id=uid` | ❌ | ✅ sulle proprie | ❌ (via WITH CHECK non lo può togliere a sé) | ✅ |
| capocantiere | ✅ **(tutte)** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| operaio | ✅ **(tutte)** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ ❗ |
| cliente/fornitore | n/a (nessun ruolo app) | | | | | | |

**Gap critici**:
- `responsabile_commessa` vede tutte le commesse dell'org: dovrebbe vedere solo le proprie + (eventualmente) quelle dove è nel team.
- `capocantiere/operaio` leggono `importo/budget/costi/margini`: esposizione margine agli operai. Andrà mitigata con vista `commesse_public` senza colonne economiche oppure con RLS a livello colonna (grants) nel Blocco 2.
- `has_any_role`/`has_role`/`is_org_member` **non escludono utenti disattivati** (nessun join con `profiles.is_active`). Va aggiunto nel Blocco 2.
- Nessuna policy ricorsiva rilevata su `commesse`.

## 10. Frontend attuale
File: `src/routes/_authenticated/commesse.tsx` (lista + dialog creazione), riferimenti in `index.tsx` (KPI), `rapportini.tsx` (select commessa). Nessuna route dettaglio commessa. Nessun uso di server functions per commesse (INSERT client-side con `organization_id` letto da `profiles`). Nessuna paginazione/filtri. Nessuna gestione permessi UI (bottone "Nuova commessa" sempre visibile). Calcoli KPI eseguiti client-side su tutte le commesse.
Da rifattorizzare: creazione via `createServerFn` con `requireSupabaseAuth` + assegnazione codice server-side (già disponibile via `assign_commessa_codice`). Da creare: `src/routes/_authenticated/commesse.$id.tsx` (dettaglio), `src/lib/commesse.functions.ts`, sub-componenti (`header`, `budget-panel`, `fasi-panel`, `team-panel`, `rapportini-panel`, `documenti-panel`). `useCurrentRole` già disponibile per gating UI.

## 11. Numerazione
`assign_commessa_codice(_org, _anno)` genera `CANT-<anno>-<NNNN>` con advisory lock per org+anno, scan MAX sulla tabella. Il calcolo `MAX` è **safe grazie all'advisory lock**, ma **`_anno` è passato dal chiamante** e la conversione lo prende da `_data_inizio` o `CURRENT_DATE`: se in un anno si creano commesse con `_data_inizio` di anno diverso, il contatore parte da 1 in ogni anno separato — atteso, ma va documentato. `UNIQUE (organization_id, codice)` presente. Nessun rischio duplicazione osservabile.
Strategia Blocco 3: mantenere formato; opzionalmente introdurre tabella `commessa_counters(org, anno, ultimo_n)` per evitare la scan MAX (ottimizzazione, non requisito).

## 12. Budget e calcoli
Presenti solo aggregati grezzi: `importo, budget_costi, costi_sostenuti, avanzamento_pct`. Nessun trigger ricalcola; nessuna origine dai preventivi oltre alla copia one-shot in fase di conversione.
Opzioni:
- A · solo aggregati su `commesse` → semplice ma inflessibile.
- **B · `commessa_budget_voci` (categoria, descr, qta, costo_unit, ricavo_unit, importo_previsto, importo_consuntivo) + aggregati cache su `commesse` mantenuti via trigger.** Consente controllo economico reale, importazione dalle voci preventivo, confronto previsto vs consuntivo. Raccomandata.
- C · tutto dinamico → performance/dashboard.
- D · combinato: come B.

**Raccomandazione: opzione B nel Blocco 6.**

## 13. Fasi e avanzamento
Assenti. Avanzamento attuale = campo `avanzamento_pct` manuale.
Modello minimo proposto per il Blocco 5: `commessa_fasi(id, organization_id, commessa_id, cantiere_id NULL, titolo, ordine, data_inizio_prev, data_fine_prev, data_inizio_eff, data_fine_eff, percentuale (0-100), stato enum, responsabile_id, note)` con FK composite. Avanzamento commessa = media ponderata delle fasi (trigger di aggiornamento).

## 14. Membri e assegnazioni
Esiste solo `responsabile_id` single-role. Nessuna relazione utente↔commessa/cantiere per capocantieri/operai/collaboratori.
Necessaria tabella `commessa_membri(commessa_id, user_id, ruolo_operativo enum, dal, al NULL, attivo bool)` (Blocco 4). Serve per:
- RLS `responsabile_commessa/capocantiere/operaio` limitata alle commesse assegnate;
- storico assegnazioni;
- gestione utenti disattivati (join `profiles.is_active`).

## 15. Chiusura, archiviazione, soft delete
`commesse.stato` ha già `completata` e `annullata`. Mancano: `archived_at/by, closed_at/by, deleted_at`. Attualmente DELETE fisico consentito a proprietario/amministratore.
Strategia raccomandata Blocco 2:
- niente DELETE fisico dalla UI (rimuovere bottone, mantenere policy per casi limite via admin);
- `stato = chiusa` + `closed_at/by` per chiusura operativa (reversibile);
- `archived_at/by` per uscita dalla lista attiva;
- nessun `deleted_at` per ora (le FK verso preventivi/rapportini/documenti sono già `SET NULL`/`RESTRICT`).

## 16. Audit
`audit_log` è già scritto da `convert_preventivo_to_commessa` (`convert_to_commessa`) e da `change_preventivo_stato`. **Nessuna traccia** per creazione manuale, update, cambio responsabile, chiusura, archiviazione, modifica costi/avanzamento. Nel Blocco 7 aggiungere trigger `AFTER INSERT/UPDATE` su `commesse` che scrive eventi tipizzati (`commessa.created|updated|status_changed|closed|archived|budget_changed`).

## 17. Migration proposte (in sequenza)

1. **`s4_01_commesse_hardening`** — colonne `titolo, descrizione, tipologia, priorita, data_apertura, data_inizio_prevista, data_inizio_effettiva, importo_contratto, ricavi_previsti, costi_previsti, costi_impegnati, margine_previsto, margine_aggiornato, margine_percentuale, note_interne, created_by, closed_at, closed_by, archived_at, archived_by`; backfill (`titolo=denominazione`, `importo_contratto=importo`, `costi_previsti=budget_costi`, `data_apertura=created_at::date`); indice `(organization_id, archived_at)`; trigger update `updated_at` esistente ok. Rischio basso. Rollback: drop colonne (dati derivati).
2. **`s4_02_roles_active_filter`** — aggiornare `has_role/has_any_role/is_org_member` per escludere `profiles.is_active=false`. Rischio medio (impatta ovunque). Rollback: ripristino funzioni.
3. **`s4_03_commesse_rls_scoping`** — nuove policy SELECT scoped per `responsabile_commessa/capocantiere/operaio` via `commessa_membri` (creata al passo 5) e rimozione lettura globale; vista `commesse_public` senza colonne economiche per ruoli operativi (o revocare colonne). Dipende da 5.
4. **`s4_04_commesse_close_archive`** — funzioni SECURITY DEFINER `close_commessa/reopen/archive/unarchive` + eventi audit; revoca DELETE dalla UI (mantiene policy DB per emergency).
5. **`s4_05_commessa_membri`** — tabella `commessa_membri(commessa_id, user_id, ruolo_operativo, dal, al, attivo)` + FK composite + RLS + GRANT; helper `is_membro_commessa(_commessa)`.
6. **`s4_06_cantieri`** — tabella `cantieri(id, organization_id, commessa_id, codice, denominazione, indirizzo, citta, provincia, cap, referente, capocantiere_id, stato_operativo enum, data_inizio, data_fine_prev, data_fine_eff, note)` + FK composite + RLS derivata da commessa + UNIQUE `(commessa_id, codice)`; backfill: 1 cantiere "principale" per commessa esistente (`codice='PRIN'`, indirizzo=`commesse.indirizzo_cantiere`). Aggiunta `cantiere_id` nullable a `rapportini` e `documenti` con FK composite; backfill al cantiere principale della commessa.
7. **`s4_07_commessa_fasi`** — tabella `commessa_fasi` + trigger aggiornamento `commesse.avanzamento_pct` (media ponderata).
8. **`s4_08_budget_voci`** — `commessa_budget_voci` + trigger aggregati (`ricavi_previsti/costi_previsti/margine_previsto`); trigger `costi_sostenuti` derivato da rapportini (costo orario da `profiles` o override).
9. **`s4_09_commesse_audit_events`** — trigger `AFTER INSERT/UPDATE` che scrive `audit_log`.

## 18. Piano a blocchi

### Blocco 2 — Schema e sicurezza (base)
- Obiettivo: preparare terreno senza toccare UI/flussi.
- DB: migration 1, 2 e 4.
- Backend/Frontend: nessuna modifica funzionale visibile; sostituire client-side INSERT/UPDATE con server functions `createCommessa/updateCommessa` (`requireSupabaseAuth`, ruolo verificato).
- File: nuovo `src/lib/commesse.functions.ts`; ritocchi `src/routes/_authenticated/commesse.tsx` per usare `useServerFn`.
- Accettazione: build verde; lista commesse invariata; RLS nega scritture non autorizzate; `is_active=false` non passa i check ruolo.
- Rischi: rottura `has_any_role` in aree già usate (preventivi, crm) → test regressione. Fuori scope: cantieri, fasi, budget.

### Blocco 3 — Commesse e numerazione (creazione manuale robusta)
- DB: nessuna migration nuova (usa `assign_commessa_codice` esistente).
- Backend: `createCommessa` genera codice server-side; validazione Zod; scrive audit `commessa.created`.
- Frontend: form creazione con select responsabile (solo ruoli abilitati e attivi), campo `titolo/descrizione/tipologia/priorita/data_apertura/data_inizio_prevista`. Gate UI via `useCurrentRole`.
- Accettazione: doppia creazione concorrente non produce codice duplicato; ruoli non abilitati non vedono il bottone.

### Blocco 4 — Cantieri e assegnazioni
- DB: migration 5 e 6.
- Backend: server functions `addMembro/removeMembro/setResponsabile/createCantiere/updateCantiere`; aggiornamento `commesse.rls` policy per scoping via `is_membro_commessa`.
- Frontend: nuova route `commesse.$id.tsx` con tab Anagrafica, Cantieri, Team; select cantiere nei form rapportini/documenti (fallback "principale").
- Accettazione: capocantiere vede solo commesse dove è membro; rapportino storico continua a funzionare (cantiere principale); nessun cross-tenant.
- Rischi: RLS stretta rompe visualizzazioni per utenti storici → verifica su dati demo.

### Blocco 5 — Fasi e avanzamento
- DB: migration 7.
- Backend: CRUD fasi; trigger ricalcola `avanzamento_pct`.
- Frontend: tab Fasi (lista ordinata, drag-reorder opzionale, progress).
- Accettazione: modifica % fase → avanzamento commessa aggiornato; date consistenti.

### Blocco 6 — Budget e controllo economico
- DB: migration 8.
- Backend: `importBudgetFromPreventivo(commessa_id)` che copia voci da `preventivo_voci`; trigger `costi_sostenuti` da rapportini.
- Frontend: tab Budget (previsto vs consuntivo, margine, alert su sforamento).
- Accettazione: import da preventivo popola voci; modifica voce ricalcola aggregati; costi rapportini si vedono in tempo reale.

### Blocco 7 — UI, audit, integrazioni, test
- DB: migration 9.
- Backend: eventi audit su ogni azione strutturale.
- Frontend: filtri lista (stato, responsabile, cliente, periodo), paginazione server-side, dashboard aggiornata a nuovi campi, gate UI completo per ruoli operativi (nascondi importi/margini a operaio/capocantiere).
- Accettazione: log audit completo; test E2E creazione → assegnazione → fase → budget → chiusura.

## 19. Rischi e mitigazioni
| Rischio | Mitigazione |
|---|---|
| Perdita/duplicazione dati durante backfill cantieri | Backfill in singola transazione con verifica conteggio prima/dopo; migration idempotente. |
| Rottura conversione preventivo→commessa | Non modificare `convert_preventivo_to_commessa`; solo estendere con default per nuovi campi. Test dedicato. |
| Ricorsione RLS su `profiles/user_roles` | Nuove policy usano solo `has_any_role` (SECURITY DEFINER) — evitare subquery su `profiles` in policy. |
| Cross-tenant | Nuove FK sempre composite `(id, organization_id)`. |
| Regressione rapportini | `cantiere_id` nullable + backfill; nessuna modifica alla UI rapportini nel Blocco 4 salvo select opzionale. |
| Regressione documenti | Idem, colonna nullable. |
| Costi aggregati incoerenti | Trigger idempotenti; funzione `recalc_commessa(_id)` chiamabile a mano. |
| Numerazione duplicata | Mantenuto advisory lock + UNIQUE. Test concorrenza. |
| Assegnazione a utenti disattivati | `has_any_role` filtra `is_active`; check anche in server functions. |
| Blocco proprietario | Trigger `tg_user_roles_protect_owner` esistente resta invariato. |
| Accesso eccessivo capocantiere | Nuova policy SELECT via `is_membro_commessa`; vista senza colonne economiche. |
| Esposizione margini agli operai | Vista `commesse_public` + revoke SELECT colonne economiche a `operaio`; UI nasconde comunque. |
| Chiusura irreversibile | `reopen_commessa` disponibile a proprietario/amministratore. |
| Performance dashboard | Aggregati cache + indici; query lista paginata server-side. |

## 20. Raccomandazione finale
Procedere nel Blocco 2 con **migration 1, 2, 4** e refactor delle scritture in server functions, **senza** ancora introdurre cantieri/fasi/budget. Questo isola il rischio (retro-compat totale) e crea la base sicura per gli sblocchi successivi. Cantieri (opzione B con backfill) rimandati al Blocco 4 quando avremo anche `commessa_membri` per RLS scoping.

## Conferme
- Nessun file modificato.
- Nessuna migration creata.
- Nessuna tabella/policy/dato modificato.
- Nessuna funzionalità nuova.
- Analisi basata su schema live (`\d`, `pg_policies`, `information_schema`) e sui file reali del repo.

In attesa di approvazione prima del Blocco 2.
