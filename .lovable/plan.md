# Evoluzione Rapportini — bolle, materiali, subappaltatori

## 1. Audit iniziale (FASE 1 — completato, nessun dato modificato)

**Cosa esiste già e si riutilizza**
- `rapportini` — contenitore giornaliero con commessa, cantiere, fase, autore, stato, workflow completo (invio/approvazione/rifiuto/annullamento/archiviazione), optimistic locking su `updated_at`.
- `rapportini_personale` — personale multiplo già implementato: membro, ore, nota, tariffa congelata, costo congelato, stato contabilizzazione. Manca solo il campo **mansione**.
- `rapportini_costi` — ledger autorevole della manodopera interna (una riga per riga personale, storno tracciato).
- `personale_costi_orari` — tariffe interne (solo personale, non utilizzabili per ditte esterne).
- `fornitori` — anagrafica unica: ragione sociale, P.IVA, contatti, categoria. **Nessun campo tipo soggetto / subappaltatore.**
- `documenti` — sistema documentale completo (Storage privato, versioni, signed URL, scadenze, archiviazione) con già una FK `fornitore_id`: riutilizzabile per i documenti dei subappaltatori senza nuovo Storage.
- `commessa_budget_voci` — categorie di costo già previste dal vincolo DB: manodopera, **materiali**, **subappalti**, noleggi, mezzi, trasporti, consulenze, sicurezza, smaltimenti, utenze, spese generali, imprevisti, altro. Nessuna nuova categoria da creare.
- `notifiche` + `audit_log` — riutilizzabili per i nuovi eventi.
- Apertura dettaglio: oggi avviene solo cliccando su data/autore/descrizione in tabella; nessuna icona "Apri" dedicata.

**Cosa manca (da creare)**
- Nessuna tabella materiali, bolle, righe bolla, storico prezzi, subappaltatori, contratti subappalto, costi subappalto.
- Nessuna sezione allegati nel rapportino (i documenti non sono collegabili a un rapportino).
- Aggregati commessa/dashboard oggi conoscono solo la manodopera interna.

**Duplicazioni da evitare**
- Nessuna seconda anagrafica per i subappaltatori: si estende `fornitori` con tipo soggetto.
- Nessun secondo Storage: si usa `documenti`.

## 2. Modello dati (nuove tabelle, tutte con `organization_id`, RLS e GRANT)

```text
fornitori            + tipo_soggetto (fornitore|subappaltatore|entrambi)
                     + specializzazioni, stato_qualifica, note_operative, is_active
documenti            + rapportino_id, subappaltatore_id (FK fornitori)
rapportini_personale + mansione

materiali                      anagrafica minima per organizzazione
rapportini_bolle               bolla legata a rapportino/commessa/cantiere/fornitore
rapportini_bolle_righe         righe materiale con quantità, prezzo, sconto, totale
materiali_prezzi_fornitori     storico prezzi append-only, legato alla riga bolla
subappalti_contratti           contratti opzionali per commessa/cantiere
rapportini_subappaltatori      presenze ditta nel rapportino, importo congelato
```

Regole economiche: il totale riga si calcola server-side; lo storico prezzi è
append-only e mai sovrascritto; l'importo subappalto viene congelato al
salvataggio e mai ricalcolato retroattivamente; nessuna tariffa personale
applicata alle ditte.

## 3. Backend

- Migrazioni separate per: estensione fornitori/documenti, materiali + prezzi, bolle + righe, subappalti + contratti.
- RPC `SECURITY DEFINER` transazionali e idempotenti: `save_rapportino_bolla`, `save_rapportino_subappaltatori`, `delete_*`, con verifica organizzazione, permessi, coerenza commessa/cantiere, congelamento costi, audit.
- Server functions in `src/lib/bolle.functions.ts`, `materiali.functions.ts`, `subappaltatori.functions.ts` con `requireSupabaseAuth`; `organization_id` mai accettato dal client.
- Campi economici (prezzi, importi, tariffe) filtrati server-side per i ruoli operativi (`responsabile_commessa`, `capocantiere`, `operaio`), non solo nascosti in UI.

## 4. Aggregati e propagazione costi

Sorgenti autorevoli, una per categoria, nessun doppio conteggio:
- manodopera → `rapportini_costi`
- materiali → righe bolla non annullate
- subappalti → righe subappalto contabilizzate

Aggiornamento di: dettaglio rapportino, dettaglio commessa, dettaglio cantiere,
dashboard KPI, budget analitico (voci per categoria esistente).

## 5. Frontend

- Dettaglio rapportino riorganizzato in tab mobile-friendly: Riepilogo · Personale · Bolle e materiali · Subappaltatori · Allegati · Costi. Il riepilogo mostra ore, costo manodopera, materiali, subappalti, totale giornaliero, allegati, anomalie.
- Lista rapportini: nuova icona/azione primaria "Apri rapportino" (tooltip, focus da tastiera, visibile su mobile) che apre `/rapportini/:id` in sola visualizzazione.
- Fornitori: sotto-sezioni elenco, materiali, bolle, prezzi materiali (con confronto fornitori e filtri per materiale/periodo).
- Nuova voce di menu **Subappaltatori** separata da Fornitori: elenco ditte, contratti, documenti, scadenze, assegnazioni, costi.
- Selezione fornitore solo da anagrafica esistente; azione "Nuovo fornitore" riservata ai ruoli autorizzati.
- Invalidazione cache mirata per ogni nuova key (bolle, materiali, prezzi, subappaltatori, contratti) più commesse, cantieri, budget, dashboard, documenti.

## 6. Verifica

Test unitari sui moduli puri (calcolo riga bolla, totali per categoria,
modalità compenso, storico prezzi, permessi economici), QA runtime dello
scenario end-to-end richiesto, poi `tsgo --noEmit`, `vitest run`, `bun run build`.

## Note tecniche

- L'implementazione procede per blocchi con migrazioni approvate una alla volta.
- Nessun accesso `anon` sulle nuove tabelle; policy per tenant e per accesso a commessa/cantiere coerenti con quelle esistenti.
- I costi congelati storici non vengono toccati.
