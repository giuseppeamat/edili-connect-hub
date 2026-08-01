# Correzione caricamento dashboard autenticata

## Stato verificato
- La pagina di accesso nell’anteprima si apre correttamente e non genera errori client.
- La versione pubblicata risponde HTTP 200 per `/`, `/auth` e per il vecchio URL con `periodo=%2230%22`.
- L’errore rimasto è quindi nel passaggio autenticato alla dashboard, non nel rendering del login.
- `src/lib/dashboard.functions.ts` contiene helper e logica runtime a livello modulo insieme a `createServerFn`; questa struttura non è sicura con lo splitting delle server function in produzione e può produrre un errore di caricamento non visibile da sessione anonima.
- Il redirect conserva ancora il vecchio parametro `periodo` con virgolette, ma questo non spiega da solo la schermata d’errore.

## Intervento
1. Rendere `dashboard.functions.ts` un wrapper sottile contenente soltanto import, tipi e la dichiarazione esportata della server function.
2. Spostare helper, query aggregate e trasformazioni della dashboard in un modulo server dedicato, senza modificare risultati, permessi o isolamento tenant.
3. Normalizzare definitivamente `periodo` prima del redirect autenticato, accettando solo `oggi`, `7`, `30` e `mese` e rimuovendo il valore predefinito dall’URL.
4. Migliorare l’errore locale della dashboard affinché distingua sessione scaduta, permessi e guasto server, senza esporre dettagli sensibili.

## Verifica
- Controllare la build di produzione, perché il difetto di splitting può non comparire in sviluppo.
- Verificare login → dashboard con URL pulito e caricamento dei KPI.
- Verificare il vecchio link `/?periodo=%2230%22` e confermare la sostituzione con `/`.
- Controllare console, richieste della server function e resa mobile della dashboard.

## Ambito tecnico
- Modifiche limitate alla dashboard, al relativo server function wrapper e alla normalizzazione del redirect.
- Nessuna modifica a schema database, policy RLS, ruoli o altri moduli ERP.