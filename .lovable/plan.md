# Personale multiplo e costi nei rapportini

## Audit (verificato ora sul database)

Modello attuale — **un rapportino = una sola persona**:

- `rapportini` porta in testata `user_id` (account Auth) e `membro_id` (membro organizzazione, aggiunto di recente), più `ore`, `data`, `commessa_id`, `cantiere_id`, `fase_id`, `stato`.
- Dati reali: 16 rapportini, tutti con `user_id`, solo 10 con `membro_id` valorizzato.
- Non esiste alcuna tabella figlia di righe personale: le ore sono un unico numero in testata.
- L'autore non è separato dal lavoratore: `created_by` esiste, ma le ore sono attribuite a `user_id`/`membro_id` della testata.
- Il costo è salvato in `rapportini_costi` (6 righe su 6 rapportini, 3 con `membro_id`): una riga per rapportino, con `ore`, `costo_orario_applicato`, `costo_totale`, `costo_orario_id` (tariffa congelata), `stato` (`contabilizzato`/`non_contabilizzato`/`stornato`), `periodo_riferimento`.
- Identità usata per la tariffa: `_rap_membro_effettivo` risolve `membro_id`, altrimenti il membro collegato a `user_id`; poi `get_costo_orario_membro_at_date` con fallback su `get_personale_costo_orario_at_date(user_id)`. `_tariffe_valide_membro > 1` fa fallire la contabilizzazione (conflitto tariffe).
- Aggregati: `_recalculate_labor_budget_voce(commessa, cantiere, fase, periodo)` somma le righe attive di `rapportini_costi` in una voce di budget manodopera, solo per commesse in modalità `analitico`.
- Retry: `ricalcola_costi_rapportini_mancanti` (dry-run + conferma) e `ricalcola_costo_storico_rapportino` operano sul rapportino intero.
- Annullamento: storno riga costo (`stornato_at`) + ricalcolo voce budget.

Conclusione: il supporto multi-persona va costruito da zero con una tabella figlia; la logica di tariffa/congelamento/aggregati esiste già e va spostata a livello di riga.

## Cosa costruiamo

### 1. Modello dati (migration)

Nuova tabella `public.rapportini_personale`:
`id, organization_id, rapportino_id, membro_id, ore, nota, tariffa_id, tariffa_oraria_congelata, costo_congelato, stato_contabilizzazione, errore_contabilizzazione, contabilizzato_at, annullato_at, created_at/by, updated_at/by`.

Stati: `da_contabilizzare | contabilizzato | tariffa_mancante | conflitto_tariffa | annullato`.

Vincoli: `ore > 0`, `costo_congelato >= 0`, unicità `(rapportino_id, membro_id)` sulle righe non annullate, FK composite `(rapportino_id, organization_id)` e `(membro_id, organization_id)` per impedire cross-tenant, `tariffa_id` verificata sullo stesso membro da trigger.

GRANT: nessun accesso `anon`; lettura solo via RPC/`SELECT` sotto RLS con colonne economiche filtrate per ruolo.

`rapportini_costi` resta la sorgente degli aggregati: guadagna `rapportino_personale_id` così che ogni riga personale contabilizzata generi esattamente una riga costo (nessun doppio conteggio con la vecchia riga di testata, che viene migrata).

### 2. Backfill

Per ogni rapportino esistente: creata una riga personale con il membro effettivo (`membro_id`, altrimenti membro collegato a `user_id`), stesse ore, stessa tariffa/costo congelato e stato ereditati dalla riga `rapportini_costi` esistente; le righe costo esistenti vengono collegate alla nuova riga personale (nessuna riga costo nuova, nessun ricalcolo). Rapportini dove il membro non è risolvibile: riga non creata, rapportino marcato `da_revisionare` e riportato nel report.

### 3. Logica server (RPC SECURITY DEFINER)

- `save_rapportino_personale(rapportino_id, righe[], expected_updated_at)`: transazionale e idempotente, org dalla sessione, valida permessi e righe, crea/aggiorna/rimuove, contabilizza le righe con tariffa valida, marca `tariffa_mancante`/`conflitto_tariffa`, aggiorna i totali e gli aggregati budget, scrive audit.
- Ricerca tariffa per riga: `membro_id` + data rapportino; 0 tariffe → `tariffa_mancante`; >1 → `conflitto_tariffa` (nessuna scelta arbitraria); 1 → congela tariffa e costo.
- Ricalcolo mancanti esteso alla singola riga personale (anteprima + conferma), riusando le funzioni di ricalcolo esistenti.
- Modifica ore dopo la contabilizzazione: costo congelato mai sovrascritto in automatico; ricalcolo esplicito con prima/dopo e audit.
- Annullamento rapportino → tutte le righe `annullato` + storno costi; rimozione singola persona → storno solo del suo costo. Idempotente.

### 4. UI

Nel form rapportino nuova sezione **"Personale impiegato"** con CTA "Aggiungi persona": per riga selettore membro (membri attivi non archiviati della org, anche senza account), qualifica, ore, nota, stato tariffa, tariffa trovata, costo, rimuovi. Blocco duplicati e ore ≤ 0 lato UI e lato server.

Nel dettaglio rapportino: ore totali, costo totale personale, numero persone, righe contabilizzate / tariffa mancante / conflitto; azione "Ricalcola costi mancanti" per riga.

Ruoli senza accesso economico (capocantiere, responsabile_commessa, operaio) vedono persona, ore e stato generico; tariffa e costi sono rimossi **dalla risposta del server**, non solo nascosti in UI.

### 5. Aggregati, notifiche, audit

Aggregati per rapportino, giornata, persona, cantiere, commessa e fase derivati da `rapportini_costi` (nessuna duplicazione: righe annullate/stornate escluse). Notifiche solo riepilogative per rapportino (tariffa mancante, conflitti, contabilizzazione completata), mai per riga, mai a membri senza accesso. Audit: aggiunta/rimozione persona, modifica ore, contabilizzazione, ricalcolo, storno, tariffa mancante, conflitto.

### 6. Test e QA

Nuovo modulo puro con la logica di riga/totali + test Vitest sui casi elencati (un operaio, più operai, autore diverso, membro senza accesso, archiviato, duplicato, tariffa valida/mancante/futura/scaduta/sovrapposta, totali, aggregati, modifica ore, ricalcolo, congelamento, annullamento, rimozione singola, idempotenza, permessi economici, cross-tenant, anon). QA runtime autenticato con Playwright sullo scenario a 20 passi. Chiusura con `tsgo --noEmit`, `vitest run`, `bun run build`.

## Note tecniche

- La testata `rapportini.user_id`/`membro_id`/`ore` viene mantenuta per retro-compatibilità: `ore` diventa un totale derivato dalle righe, `membro_id` non è più usato per attribuire costi (l'autore resta in `created_by`).
- Ordine di lavoro: migration + backfill → RPC → server functions → UI → test → QA → report.

## Assunzioni da confermare (procedo così se non indicato diversamente)

- Un membro può comparire **una sola volta** per rapportino (niente fasce orarie multiple).
- Le ore di testata diventano la somma delle righe personale, non un valore indipendente.
