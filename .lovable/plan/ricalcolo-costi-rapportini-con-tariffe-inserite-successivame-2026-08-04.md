# Ricalcolo costi rapportini con tariffe inserite successivamente

## Fase 1 — Audit (già eseguito, dati reali)

Come funziona oggi:

- La ricerca tariffa avviene nella funzione di contabilizzazione: prima per `membro_id` del rapportino, poi in fallback per `user_id`.
- La data usata per la validità è la **data del rapportino** (`valido_dal <= data <= valido_al`, con `valido_al` nullo = aperta).
- Il costo congelato è salvato in `rapportini_costi`: ore, tariffa applicata, costo totale, riferimento alla tariffa, timestamp e periodo di competenza (mese). L'aggregato di Budget viene ricalcolato solo per commesse in modalità analitica.
- I rapportini "senza costo" sono quelli senza una riga di costo attiva in stato contabilizzato.
- Un retry esiste già: contabilizzazione singola e contabilizzazione massiva dei pendenti (solo rapportini **approvati**), ma **senza anteprima** e senza reportistica per riga.
- Le tariffe hanno già un vincolo che impedisce periodi sovrapposti per lo stesso membro (e per lo stesso utente), quindi il conflitto è oggi strutturalmente raro ma va comunque gestito e segnalato.

Situazione reale in banca dati (14 rapportini senza costo contabilizzato):

- 10 rapportini in stato "inviato" (non ancora approvati) → non contabilizzabili finché non approvati.
- 4 rapportini approvati (29/07, 30/07, 03/08, 04/08, 8 ore ciascuno) intestati a Danilo Bartucca: hanno già una riga in stato "tariffa mancante".
- **Causa reale**: quei 4 rapportini non hanno il collegamento al membro (`membro_id` vuoto) e le 8 tariffe esistenti sono state create sul membro, non sull'utente. Inoltre il membro corrispondente a quell'utente **non ha alcuna tariffa**: le 8 tariffe attive (45 €/h dal 29/07) appartengono ad altri membri.

Conseguenza: anche a regola corretta, quei 4 rapportini restano "tariffa mancante" finché non viene creata una tariffa per quel membro. Il ricalcolo va quindi accompagnato dalla risoluzione del membro a partire dall'utente.

## Fase 2 — Regola di calcolo

Per ogni rapportino eleggibile (approvato, non annullato, non archiviato, senza costo attivo):

1. risoluzione del membro: `membro_id` del rapportino, altrimenti il membro attivo collegato all'utente del rapportino;
2. ricerca tariffa valida alla data del rapportino per quel membro (fallback su utente solo se la tariffa è intestata all'utente);
3. costo = ore × tariffa, arrotondato al centesimo;
4. salvataggio di tariffa applicata, costo congelato, riferimento tariffa, timestamp, periodo di competenza, stato "contabilizzato";
5. nessuna tariffa valida → nessuna modifica al rapportino, esito "tariffa mancante";
6. più tariffe valide sovrapposte → esito "conflitto tariffa", nessuna contabilizzazione;
7. aggiornamento dell'aggregato di Budget solo per commesse in modalità analitica (comportamento esistente).

Ore e contenuto del rapportino non vengono mai toccati. I costi già congelati restano invariati.

## Fase 3–4 — Ricalcolo sicuro con anteprima obbligatoria

Nuova funzione di database `ricalcola_costi_rapportini_mancanti` (SECURITY DEFINER, transazionale, idempotente) e server function `recalculateMissingRapportiniCosts`:

- input ammessi: membro, intervallo date, elenco rapportini, `dry_run` (default `true`);
- l'organizzazione è ricavata dalla sessione, mai dal client;
- ruoli ammessi: proprietario, amministratore, amministrazione;
- esclusioni: altra organizzazione, annullati/archiviati, non approvati, già contabilizzati con costo attivo;
- output per riga: rapportino, membro, data, ore, tariffa trovata, costo calcolato, esito (contabilizzabile / tariffa mancante / conflitto / escluso / annullato) e motivo;
- output aggregato: analizzati, contabilizzabili, senza tariffa, conflitti, esclusi, totale costo generato;
- in modalità anteprima nessuna scrittura, nemmeno delle righe "tariffa mancante".

## Fase 5 — UI

In "Costi personale", scheda "Rapportini pendenti":

- pulsante "Anteprima ricalcolo" con filtri persona, intervallo date, stato, solo tariffa mancante, solo non contabilizzati;
- tabella di anteprima con badge: Contabilizzato, Tariffa mancante, Conflitto tariffa, Escluso, Annullato;
- pulsante "Conferma contabilizzazione" attivo solo dopo l'anteprima, con riepilogo di quante righe verranno scritte;
- nessuna azione massiva senza anteprima (la vecchia azione massiva diretta viene sostituita dal flusso anteprima → conferma).

## Fase 6 — Rapportini già contabilizzati

Azione separata "Ricalcola costo storico", visibile solo a proprietario e amministratore:

- conferma esplicita, confronto prima/dopo, motivazione obbligatoria;
- storno della riga esistente e nuova contabilizzazione con la tariffa valida alla data;
- mai attivata dal ricalcolo standard.

## Fase 7 — Tariffe retroattive

Alla creazione di una tariffa con validità antecedente a oggi, se esistono rapportini senza costo nel periodo, viene mostrato un avviso con invito all'anteprima. Nessun ricalcolo automatico.

## Fase 8 — Notifiche

Una sola notifica riepilogativa all'utente che ha eseguito il ricalcolo reale: contabilizzati, senza tariffa, conflitti, errori. Nessuna notifica per singolo rapportino.

## Fase 9 — Audit

Eventi registrati: avvio, completamento, esito parziale, ricalcolo storico manuale. Metadati: intervallo date, membro opzionale, analizzati, contabilizzati, esclusi, senza tariffa, conflitti, totale costo. Nessun dato personale superfluo.

## Fase 10–12 — Test e qualità

Modulo puro con i criteri di eleggibilità e la selezione della tariffa, coperto da test: tariffa creata dopo ma valida alla data, tariffa futura esclusa, tariffa scaduta esclusa, due tariffe sovrapposte, membro senza account con tariffa valida, già contabilizzato escluso, annullato escluso, idempotenza, anteprima senza scritture, conferma con scritture, calcolo ore × tariffa, aggregato.
Verifiche a livello di database per cross-tenant e ruolo non autorizzato. Poi typecheck, suite di test e build.

## Fase 13 — Report e QA runtime

Al termine viene fornito il report in 18 punti richiesto, con QA runtime sul caso reale: creazione della tariffa mancante per il membro coinvolto, anteprima, conferma, verifica del costo congelato, dell'aggregato di commessa, dell'idempotenza e dell'invarianza dello storico.

## Note tecniche

- Nuova migrazione: funzione `ricalcola_costi_rapportini_mancanti(_dry_run, _membro_id, _date_from, _date_to, _rapportino_ids)` che restituisce righe di esito, più `ricalcola_costo_storico_rapportino(_rapportino_id, _motivo)`; entrambe con controllo ruolo interno e `GRANT EXECUTE` al ruolo autenticato.
- La risoluzione membro↔utente viene applicata sia nella nuova funzione sia nella contabilizzazione esistente, così i rapportini creati senza `membro_id` trovano comunque la tariffa del membro.
- Nuove server function in `src/lib/personale-costi.functions.ts`, modulo puro in `src/lib/ricalcolo-costi.ts`, test in `src/lib/__tests__/`.
- UI in `src/routes/_authenticated/costi-personale.tsx` e azione storica nel dettaglio rapportino.
