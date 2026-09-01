# Fix badge "Anomala" e totale manodopera per commessa

## Cosa ho verificato sui dati reali

Sui rapportini della commessa aperta:

- I rapportini multi-operaio hanno correttamente 3 persone da 8 ore ciascuna (nessuna persona oltre 16h), quindi il badge "Anomala" è sbagliato.
- La tabella delle righe personale ha una regola di accesso che nega qualsiasi lettura diretta all'utente autenticato. Le liste rapportini leggono quelle righe direttamente: ricevono zero persone e ricadono sul totale di testata (24h), che supera 16h → badge "Anomala".
- I costi: le righe personale contabilizzate valgono 10.687,50 € in totale, mentre le righe costo attive (quelle che alimentano commesse, budget e dashboard) valgono 8.482,50 €. 8 righe personale contabilizzate non hanno alcuna riga costo attiva corrispondente.
- Causa: durante il passaggio al costo per singola persona alcuni storni hanno colpito le righe corrette invece di quelle vecchie di testata. Esempio: un rapportino da 3×360 € risulta a 0 € (le tre righe per persona stornate, resta solo la vecchia riga di testata non contabilizzata); un altro da 3×202,50 € conta solo 202,50 €.

## Cosa faremo

### 1. Badge "Anomala" corretto (conteggio persone visibile)

Esporre il conteggio persone e le ore massime per persona attraverso il canale server autorizzato invece della lettura diretta bloccata, così liste e dettaglio ricevono i dati reali. Il badge comparirà solo quando una singola persona supera 16 ore; i rapportini di squadra da 24h su 3 operai torneranno normali.

### 2. Riallineamento dei costi manodopera

Migrazione di bonifica che, per ogni rapportino:

- riattiva o ricrea una riga costo per ogni riga personale contabilizzata (una per persona, con tariffa e costo congelati già presenti);
- storna definitivamente le vecchie righe costo di testata (quelle senza corrispondenza con una persona) per evitare doppi conteggi;
- ricalcola le voci di budget manodopera collegate.

Al termine il totale manodopera per commessa, cantiere, fase e dashboard coinciderà con la somma dei costi per persona (10.687,50 € complessivi sull'organizzazione, contro gli 8.482,50 € mostrati oggi).

### 3. Prevenzione

- La contabilizzazione genera sempre una riga costo per persona e mai una riga di testata quando esistono righe personale.
- Lo storno di un rapportino agisce su tutte le righe per persona, in modo idempotente.
- Report finale post-migrazione con confronto prima/dopo per rapportino.

## Verifiche di chiusura

- Query di controllo: nessuna riga personale contabilizzata senza riga costo attiva; nessuna riga costo di testata attiva su rapportini con personale.
- Confronto totale commessa aperta prima/dopo.
- Test automatici e build.

## Note tecniche

- Lettura persone/ore massime tramite funzione server già autorizzata (`get_rapportino_personale` o aggregato equivalente) invece del `select` diretto su `rapportini_personale`, che ha policy `false` per `authenticated`.
- Bonifica dei costi con migrazione SQL su `rapportini_costi` + `_recalculate_labor_budget_voce` per le voci di budget interessate.
- Nessuna modifica al costo congelato: si riusano tariffa e costo già registrati sulle righe personale.
