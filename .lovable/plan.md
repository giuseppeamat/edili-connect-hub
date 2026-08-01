# Correzione definitiva del caricamento pubblico

## Diagnosi confermata

- Il sito pubblicato risponde correttamente via HTTP, quindi hosting e routing sono attivi.
- Lovable Cloud è operativo e raggiungibile.
- Il crash avviene nel browser prima del caricamento dell’app: il bundle pubblicato non contiene `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Il client prova quindi il fallback server-only `process.env`, non disponibile nel browser, e la root error boundary mostra “Errore di caricamento”.

## Intervento

1. **Rendere deterministica la configurazione pubblica del client**
   - Aggiungere nella configurazione Vite un fallback di build per URL e chiave pubblicabile del backend.
   - Usare prima le variabili gestite da Lovable Cloud e ricorrere ai valori pubblici del progetto solo se l’iniezione automatica non è disponibile.
   - Non includere né esporre la chiave amministrativa o altri segreti server-side.

2. **Rimuovere il fallback browser verso `process.env`**
   - Lasciare il client browser dipendente esclusivamente dalla configurazione `VITE_*` incorporata in fase di build.
   - Mantenere la configurazione server separata, così un errore di pubblicazione non viene mascherato da un percorso incompatibile con il browser.

3. **Rafforzare l’avvio e la diagnostica**
   - Verificare che `/auth`, `/` e il controllo sessione non possano mandare in crash l’intera applicazione per una configurazione client assente.
   - Conservare un messaggio di errore utile nei log, evitando dettagli tecnici nell’interfaccia utente.

4. **Validazione completa**
   - Verificare il bundle di produzione e confermare che contenga la configurazione pubblica necessaria.
   - Testare da sessione pulita: apertura link pubblico, redirect al login, login, dashboard e refresh diretto.
   - Ripetere i test con viewport desktop e mobile, controllando console ed eventuali richieste fallite.

5. **Rilascio**
   - Ricollegare le variabili gestite del backend.
   - Pubblicare la revisione corretta e verificare direttamente `https://edili-connect-hub.lovable.app` dopo la distribuzione, senza fare affidamento sulla cache esistente.

## Dettagli tecnici

- File principali: `vite.config.ts` e configurazione del client backend.
- Le credenziali privilegiate rimangono esclusivamente nel runtime server.
- Criterio di accettazione: nessun errore `Missing Supabase environment variable(s)` in una nuova sessione browser e caricamento funzionante sia da desktop sia da mobile.
