
# Sprint 3 — Preventivi: Audit e Piano

## FASE 1 — Audit (stato attuale)

### `preventivi` (17 colonne)
- Chiavi: `id`, `organization_id` (NOT NULL, FK CASCADE), `cliente_id` (FK RESTRICT + composite anti-cross-tenant).
- Numerazione: `numero TEXT NOT NULL`, `versione INT NOT NULL DEFAULT 1`. Unique `(org, numero, versione)`. Nessuna generazione server-side: la pagina attuale la fa scrivere dal client.
- Stato: enum `preventivo_stato` = `bozza | inviato | accettato | rifiutato | scaduto`. **Mancano**: `in_revisione`, `pronto`, `annullato`, `convertito`.
- Economici: `totale_costo`, `totale_ricavo`, `totale_iva`, `totale`, `margine` (numeric(14,2)). Ricalcolati dal trigger `tg_recalc_preventivo` a partire dalle voci.
- Testi: solo `oggetto` e `note`. **Mancano**: titolo separato, tipo, responsabile, condizioni pagamento, tempi, esclusioni, garanzie, aliquota IVA default, sconto/maggiorazione/spese globali.
- Versionamento: nessun campo `root_preventivo_id`, `parent_version_id`, `is_current_version`, `superseded_at/by`.
- Storico stati: assente. Audit generico presente (`audit_log`).
- Trigger: `tg_set_updated_at`.
- RLS: select (proprietario/amministratore/ufficio_tecnico/amministrazione/responsabile_commessa); insert/update (proprietario/amministratore/ufficio_tecnico); delete (proprietario/amministratore). Operaio/capocantiere/cliente/fornitore esclusi. Nessuna ricorsione.
- Nessun campo `data_invio`, `data_accettazione`, `motivo_rifiuto`, `annullato_at`, `convertito_at`, `commessa_id` (inverso presente).

### `preventivo_voci` (16 colonne)
- Struttura piatta con `capitolo` e `categoria` come TEXT: **non c'è tabella `preventivo_categorie`**. Le categorie sono stringhe libere denormalizzate.
- Campi: `ordine`, `descrizione`, `unita_misura`, `quantita(14,3)`, `costo_unitario(14,4)`, `ricarico_pct`, `prezzo_unitario(14,4)`, `sconto_pct`, `iva_pct` (default 22), `totale`.
- Trigger `tg_calc_voce` (BEFORE): se prezzo=0 e costo>0 → deriva prezzo da ricarico; imponibile = `prezzo × quantità × (1 - sconto%)`. **Nessuna maggiorazione**. `totale` è imponibile, non IVA compresa.
- Trigger `tg_recalc_preventivo` (AFTER): aggrega su preventivo.
- Manca `updated_at`, `margine`, `note`, `codice`, `categoria_id` FK.

### `commesse`
- Ha già `preventivo_id` FK (SET NULL) + composite. **Nessun UNIQUE su `preventivo_id`**: teoricamente ammette conversioni multiple.
- La conversione attuale in `preventivi.tsx` è **non atomica** (2 query dal client) e non blocca doppie conversioni.

### Anomalie dati
- 7 preventivi (3 bozza, 2 inviato, 2 accettato), 8 voci, 2 commesse con `preventivo_id`. Nessun duplicato numero/versione. Dati compatibili con nuovo enum.

### Codice
- `src/routes/_authenticated/preventivi.tsx`: lista + form create + "toCommessa" client-side non atomico. Nessuna scheda dettaglio `/preventivi/$id`.
- `src/lib/crm.functions.ts` e `invites.functions.ts` sono i pattern di riferimento (createServerFn + requireSupabaseAuth).
- `useCurrentUser`/`useCurrentRole` centralizzano organizzazione e ruoli.
- Nessuna generazione PDF esistente; bucket `documenti` privato disponibile e riutilizzabile.

### Sintesi gap
1. Enum stati incompleto; nessuno storico stati; nessuna transizione validata.
2. Numerazione client-side (non concorrente-safe).
3. Nessun versionamento (root/parent/is_current).
4. Categorie come stringa (no tabella dedicata).
5. Formule calcolate solo su imponibile; mancano maggiorazione, totali globali con sconto/spese, margine per voce.
6. Nessun campo per condizioni, tipo, responsabile, IVA default, sconto/spese globali.
7. Conversione in commessa non atomica, senza vincolo di unicità.
8. Nessuna scheda dettaglio, nessun PDF, nessun template, nessun allegato collegato al preventivo.
9. Server functions per preventivi assenti: tutto passa dal client.

---

## FASE 2 — Piano di implementazione (a blocchi)

Eseguo un blocco per turno, chiedendo conferma prima del successivo.

### Blocco A — Schema, enum, categorie, numerazione, calcoli server-side
Migrations:
1. Estendere enum `preventivo_stato` aggiungendo `in_revisione, pronto, annullato, convertito` (senza rimuovere valori esistenti).
2. `preventivi` — nuove colonne (nullable/default sicuri): `titolo`, `tipo` (nuovo enum `preventivo_tipo`), `responsabile_id` (FK profiles), `data_invio`, `data_accettazione`, `data_rifiuto`, `motivo_rifiuto`, `annullato_at`, `convertito_at`, `commessa_id` (FK + composite), `sconto_globale_pct`, `maggiorazione_globale_pct`, `spese_accessorie`, `iva_default_pct` (default 22), `condizioni_pagamento`, `tempi_esecuzione`, `esclusioni`, `garanzie`, `condizioni_generali`, `firma_referente`, `root_preventivo_id`, `parent_version_id`, `is_current_version` (bool default true), `superseded_at`, `superseded_by`, `version` (counter per optimistic locking), `created_by`. Indici richiesti.
3. Nuova tabella `preventivo_categorie` (org, preventivo, titolo, descrizione, posizione, timestamps) + GRANT + RLS ereditata dal preventivo padre + composite FK anti-cross-tenant.
4. `preventivo_voci` — nuove colonne: `categoria_id` (FK + composite), `codice`, `maggiorazione_pct`, `importo_netto`, `costo_totale`, `margine`, `margine_pct`, `note`, `updated_at`. Migrazione dati: per ogni preventivo esistente creare una categoria "Voci" e associare le voci; ricalcolare economici col nuovo trigger.
5. Nuova tabella `preventivo_storico_stati` (immutabile: policy solo INSERT tramite SECURITY DEFINER, no UPDATE/DELETE).
6. Nuova tabella `preventivo_templates` (nome, testi default, iva default, attivo, scoped per org).
7. Aggiornare trigger `tg_calc_voce` con nuova formula completa (lordo → sconto → maggiorazione → netto → costo → margine) e `tg_recalc_preventivo` per includere sconto globale/maggiorazione/spese.
8. Funzione SQL `assign_preventivo_numero(org, anno)` con advisory lock per numerazione atomica `PREV-YYYY-NNNN`.
9. UNIQUE parziale su `commesse.preventivo_id WHERE preventivo_id IS NOT NULL` per impedire doppia conversione.
10. `documenti.preventivo_id` (verificare/aggiungere) + composite FK.

### Blocco B — Server functions
Nuovo `src/lib/preventivi.functions.ts` con `createServerFn` + `requireSupabaseAuth`:
- `createPreventivo` (assegna numero, versione=1, is_current=true, root=id)
- `updatePreventivoHeader` (con `expected_updated_at` per optimistic lock)
- `upsertCategoria`, `deleteCategoria`, `moveCategoria`
- `upsertVoce`, `deleteVoce`, `moveVoce`, `duplicateVoce`
- `changeStato` (valida transizioni, scrive `preventivo_storico_stati`)
- `createNuovaVersione` (copia intestazione/categorie/voci, marca precedente `is_current_version=false, superseded_at/by`)
- `duplicatePreventivo` (nuovo numero, nuovo root)
- `markInviato` / `markAccettato` / `markRifiutato` / `markScaduto` / `annulla`
- `convertToCommessa` — transazione via RPC SQL SECURITY DEFINER: verifica stato/org/role/no-commessa-esistente, crea commessa, aggiorna preventivo a `convertito`, storico, audit, rollback su errore.
- `generatePreventivoPdf` — genera PDF con pdf-lib (Worker-safe), watermark `BOZZA`/`VERSIONE SUPERATA`/`ANNULLATO`, salva in bucket `documenti` (privato), inserisce record in `documenti` collegato.

### Blocco C — UI
- Rifare `src/routes/_authenticated/preventivi.tsx` come lista: KPI (bozze/inviati/accettati/scaduti/valore aperto/accettato/margine), filtri (stato/cliente/tipo/anno/responsabile/convertito), ricerca, paginazione, empty state.
- Nuova rotta `src/routes/_authenticated/preventivi.$preventivoId.tsx` con tab: Riepilogo, Voci, Condizioni, Allegati, Versioni, Storico. Azioni contestuali in base allo stato e ai ruoli (via `useCurrentRole`).
- Wizard/form di creazione a sezioni (Cliente → Info → Voci → Condizioni → Riepilogo).
- Editor categorie/voci con "Sposta su/giù", duplicazione, subtotali, alert margine basso.
- Rinominare esistente `preventivi.tsx` → `preventivi.index.tsx` (come già fatto per clienti).
- Aggiornare scheda cliente: tab Preventivi già in lettura, verificare che filtri per `cliente_id` funzioni con nuovo schema.

### Blocco D — Test, regressione, cleanup
- Test funzionali su tutti i 48 casi elencati (quelli automatizzabili via psql/curl).
- `tsgo` typecheck.
- Report finale.

## Dettagli tecnici chiave
- **PDF**: uso `pdf-lib` (puro JS, Worker-compatible). Font Helvetica standard; per accentate italiane uso Latin-1 (pdf-lib gestisce correttamente).
- **Numerazione**: `pg_advisory_xact_lock(hashtext(org::text || anno::text))` + SELECT MAX per anno + INSERT nello stesso statement transazionale.
- **Conversione**: implementata come funzione `plpgsql SECURITY DEFINER` chiamata da server function, garantisce atomicità.
- **Storico stati**: RLS solo SELECT per lettori del preventivo; INSERT solo tramite `SECURITY DEFINER` (revoke insert dagli utenti).
- **Optimistic locking**: colonna `updated_at` confrontata; se diversa → errore 409.
- **Compatibilità dati**: tutti i default sono retroattivamente sicuri; migrazione voci→categoria "Generale" per non perdere dati.

## Cosa NON viene fatto in questo sprint
Computo metrico avanzato, prezzari, SAL, contabilità, firma digitale, email automatiche, portale cliente, fatturazione, AI, import PriMus/DCF, drag-and-drop complesso, autosave.

## Ordine di esecuzione proposto
1. Approvazione piano.
2. Blocco A (migration unica versionata).
3. Blocco B (server functions).
4. Blocco C (UI lista + scheda).
5. Blocco D (test + report).

Confermi di procedere in questo ordine, o preferisci restringere il primo blocco (es. senza `preventivo_templates` e senza `documenti.preventivo_id`) per accelerare?
