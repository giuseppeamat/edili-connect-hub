# BLOCCO 6a — Audit, modello economico e piano

## 1. Executive summary

- Le fondamenta economiche esistono già su `public.commesse` (ricavi_previsti, costi_previsti, costi_impegnati, costi_sostenuti, margine_previsto, margine_aggiornato, margine_percentuale) e su `public.preventivi` (totale, totale_costo, totale_ricavo, margine). Mancano completamente le voci analitiche, la baseline, gli scostamenti canonici e la modalità manuale/analitica del budget.
- Non esistono tabelle costi/acquisti/fatture/movimenti: nessun rischio di collisione. Rapportini ha `ore` ma NON ha `costo_orario` → non è possibile stimare costi da rapportini in modo affidabile (rimane fuori scope, come da vincoli).
- Le 7 commesse storiche hanno valori economici coerenti tranne `CANT-2026-0001` (margine previsto negativo -80.000, ma aggiornato +21.000 e costi_sostenuti = 0). L'anomalia è dato utente/demo, non va toccata: preservare così com'è.
- Il modulo Fasi è protetto (SELECT-only + RPC): userò lo stesso pattern per `commessa_budget_voci`.
- Nessuna scrittura frontend diretta agli aggregati economici in `commesse` risulta necessaria; il refactoring 5.1 ha già centralizzato le mutazioni tramite RPC.

## 2. Schema attuale — sintesi rilevante

**public.commesse** (economics):
`importo`, `importo_contratto`, `ricavi_previsti`, `budget_costi` (legacy), `costi_previsti`, `costi_impegnati`, `costi_sostenuti`, `margine_previsto`, `margine_aggiornato`, `margine_percentuale`. Check `>= 0` su tutti. FK composite `(id, organization_id)` presente. Nessun campo per baseline, ricavi_acquisiti, extra, ricavi_aggiornati, costi_residui_stimati, costo_aggiornato, scostamenti, budget_modalita.

**public.preventivi**: espone `totale`, `totale_costo`, `totale_ricavo`, `margine`, `totale_iva`. Le voci in `preventivo_voci` hanno `costo_totale`, `importo_netto`, `margine`, `margine_pct`, `categoria_id → preventivo_categorie`, `codice`, `descrizione`, `unita_misura`, `quantita`, `costo_unitario`, `prezzo_unitario`.

**public.commessa_fasi**: nessun campo economico (corretto).

**public.rapportini**: `ore`, `user_id`, `commessa_id`, `cantiere_id`. Nessun `fase_id`, nessun `costo_orario`.

**public.cantieri**: già FK composite pronta.

## 3. Anomalie rilevate

- `CANT-2026-0001`: costi_previsti (101k) > ricavi_previsti (21k) → margine previsto -80k. Dato demo incoerente ma legittimo: NON modificare.
- `budget_costi` e `costi_previsti` sono sempre uguali nelle 7 righe: campi legacy paralleli. Mantenere entrambi, `budget_costi` è il legacy, `costi_previsti` è il canonico.
- `importo` == `importo_contratto` == `ricavi_previsti` in tutte le righe: modello attualmente ridondante ma non contraddittorio.
- 7 righe risultano da `SELECT` per un contatore duplicato apparente (in realtà 6 distinte + 1 nuova). Nessuna azione richiesta.

## 4. Modello economico proposto

Aggregati canonici finali su `public.commesse` (aggiungere solo mancanti):

```text
RICAVI                                 COSTI                              MARGINI/SCOSTAMENTI
- ricavi_previsti      (esiste)        - costi_previsti      (esiste)     - margine_previsto           (esiste)
- ricavi_acquisiti     (NEW)           - costi_impegnati     (esiste)     - margine_aggiornato         (esiste)
- extra_approvati      (NEW)           - costi_sostenuti     (esiste)     - margine_percentuale        (esiste, = previsto)
- extra_non_approvati  (NEW)           - costi_residui_stimati (NEW)      - margine_percentuale_aggiornato (NEW)
- ricavi_aggiornati    (NEW, derived)  - costo_aggiornato    (NEW, derived) - scostamento_costi        (NEW, derived)
                                                                          - scostamento_ricavi         (NEW, derived)
                                                                          - scostamento_margine        (NEW, derived)
+ budget_modalita ('manuale'|'analitico')  NEW
+ budget_calcolato_at                       NEW
+ baseline_preventivo_id / baseline_ricavi / baseline_costi / baseline_margine / baseline_created_at   NEW
```

Formule centralizzate in una SQL function `_compute_commessa_totals(_org, _commessa)`:

```
ricavi_aggiornati    = COALESCE(ricavi_acquisiti,0) + COALESCE(extra_approvati,0)
impegnato_residuo    = GREATEST(costi_impegnati - costi_sostenuti, 0)   -- semplificato v1
costo_aggiornato     = costi_sostenuti + impegnato_residuo + costi_residui_stimati
margine_previsto     = ricavi_previsti - costi_previsti
margine_aggiornato   = ricavi_aggiornati - costo_aggiornato
margine_pct_prev     = CASE WHEN ricavi_previsti  > 0 THEN margine_previsto   / ricavi_previsti   * 100 ELSE 0 END
margine_pct_agg      = CASE WHEN ricavi_aggiornati> 0 THEN margine_aggiornato / ricavi_aggiornati * 100 ELSE 0 END
scostamento_costi    = costo_aggiornato   - costi_previsti
scostamento_ricavi   = ricavi_aggiornati  - ricavi_previsti
scostamento_margine  = margine_aggiornato - margine_previsto
```

`margine_percentuale` legacy = percentuale prevista (retro-compat garantita). NON rinominare.

## 5. Nuova tabella `public.commessa_budget_voci`

Campi come da richiesta, con FK composite `(commessa_id, organization_id)`, `(cantiere_id, organization_id)`, `(fase_id, organization_id)`, `(fornitore_id, organization_id)`, `(preventivo_voce_id, organization_id)`. Check su range importi/quantità/tipo/fonte/categoria. Trigger `tg_set_updated_at`. Trigger validation: cantiere ⊂ commessa, fase ⊂ commessa, preventivo_voce ⊂ preventivo della commessa. Indici come da specifica. RLS SELECT-only per authenticated con matrice ruoli. `REVOKE INSERT/UPDATE/DELETE FROM authenticated`.

## 6. Piano di implementazione (mini-blocchi)

### 6b — Migration + RPC + import preventivo (DB hardening)

- Migration `s4_08_commessa_budget_voci`:
  - Aggiungere colonne mancanti a `commesse` con default sicuri (0/NULL). Backfill conservativo:
    `ricavi_acquisiti = COALESCE(importo_contratto, ricavi_previsti)`, `extra_approvati = 0`, `costi_residui_stimati = 0`, `budget_modalita = 'manuale'`.
    Ricalcolo di `costo_aggiornato / margine_aggiornato / scostamenti` SOLO se tutti gli input sono valorizzati; altrimenti lascia come sono per non toccare le 7 storiche.
  - CREATE TABLE `commessa_budget_voci` + indici + GRANT SELECT `TO authenticated`, GRANT ALL `TO service_role`. RLS + policy SELECT per ruolo. Nessuna policy INSERT/UPDATE/DELETE (mutazioni via RPC SECURITY DEFINER).
- RPC SECURITY DEFINER:
  - `commessa_budget_voce_create/update/archive/restore/reorder` con `expected_updated_at` e validazioni.
  - `recalculate_commessa_budget(_commessa_id)` idempotente (usato in modalità analitica).
  - `import_budget_from_preventivo(_commessa_id, _expected_updated_at, _strategy)` con strategie `init_if_empty` e `add_missing` (tracciamento per `preventivo_voce_id`).
  - `set_commessa_budget_mode(_commessa_id, _mode, _expected_updated_at, _motivo)`.
  - `update_manual_commessa_budget(...)` (solo modalità manuale).
  - `set_commessa_baseline(...)` + audit `baseline_created/baseline_replaced`.
- REVOKE PUBLIC EXECUTE + GRANT EXECUTE alle sole RPC necessarie a `authenticated`.

### 6c — Server functions + UI (Tab Budget)

- `src/lib/commessa-budget.functions.ts`: elenco funzioni indicato nella specifica, tutte via RPC + `mapServerError`.
- Route `commesse.$commessaId.tsx`: nuova tab **Budget**, visibile ai ruoli economici (proprietario/amministratore/ufficio_tecnico/amministrazione/responsabile_commessa). Header + KPI + lista voci + filtri + form + dialog import preventivo + dialog baseline + alert.
- Integrazione Fasi/Cantieri: solo aggregati derivati via query (nessun campo cache in `commessa_fasi`).
- Aggiornare `use-current-user.ts` con `canViewCommessaBudget` / `canEditCommessaBudget`.

### 6d — Test, regressione, hardening

- Test funzionali (migration, calcoli, import, modalità, baseline, sicurezza, concorrenza, UI, regressione).
- TypeScript check + build + smoke E2E multi-ruolo.

## 7. Rischi e mitigazioni

- **Backfill valori aggregati**: rischio alterare le 7 storiche. Mitigazione: aggiornare solo `budget_modalita='manuale'` e `ricavi_acquisiti = COALESCE(importo_contratto, ricavi_previsti)`; NON toccare `margine_*` esistenti.
- **Doppio conteggio impegnato/sostenuto**: la formula usa `GREATEST(impegnato - sostenuto, 0)`. Semplificazione documentata v1, evolvibile quando arriveranno Ordini/Fatture.
- **Regressione tab Cantieri per capocantiere**: nessuna esposizione economica → verificata in 6c/6d.
- **`preventivo_voce_id` cross-tenant**: prevenuto da FK composite + trigger di validazione (voce deve appartenere al preventivo della commessa).
- **Ricalcolo ricorsivo**: `recalculate_commessa_budget` non chiama trigger che rimodificano le voci; è invocato esplicitamente dalle RPC voce e da import.

## 8. Compatibilità con dati esistenti

- Tutti i campi nuovi sono NULL o hanno default 0 → nessuna riga esistente viene invalidata.
- `budget_modalita='manuale'` di default per tutte le commesse esistenti.
- Nessun `commessa_budget_voci` viene creato automaticamente.
- Campi legacy (`importo`, `budget_costi`) preservati.
- Nessun rinominamento.

## 9. Prossimo passo

Approva questo audit + piano per procedere con **Blocco 6b** (migration + RPC + import). Non tocco codice o DB prima della tua conferma.
