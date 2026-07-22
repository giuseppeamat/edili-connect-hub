## Obiettivo
Permetterti di vedere e navigare tutto il software senza dover fare login, mantenendo però la possibilità di riattivare l'autenticazione in futuro.

## Approccio: "Modalità Demo" bypass auth

Aggiungo un flag `VITE_DEMO_MODE=true` (attivo di default) che:

1. **Salta il redirect al login** in `src/routes/_authenticated/route.tsx`: se il flag è attivo e non c'è utente, invece di reindirizzare a `/auth` usa un'organizzazione demo fittizia e mostra comunque la UI.

2. **Reindirizza `/` alla dashboard**: al primo caricamento vedi direttamente il gestionale con dati demo, non la schermata di login.

3. **Header aggiornato**: il `UserMenu` mostra "Ospite demo" con un pulsante "Accedi" che porta a `/auth` per chi vuole registrarsi davvero.

4. **Dati visibili senza login**: siccome le tabelle hanno RLS attivo, un utente non autenticato non vedrebbe nulla. Due opzioni:
   - **A (consigliata)**: precarico dati mock in memoria (clienti, preventivi, commesse, rapportini finti di "Edilizia Rossi S.r.l.") mostrati solo in demo mode, senza toccare il database. Le operazioni CRUD funzionano in-memory nella sessione.
   - **B**: creo un'organizzazione demo pubblica nel DB con policy RLS che permette lettura anonima solo per quell'org. Più invasivo e con rischio sicurezza.

Vado con l'opzione A: nessuna modifica al database, nessun rischio, e puoi comunque cliccare "Accedi" per creare un account reale quando vuoi.

## File toccati
- `src/routes/_authenticated/route.tsx` — bypass del redirect quando demo mode
- `src/routes/index.tsx` (nuovo) — redirect `/` → `/` autenticato o landing
- `src/components/user-menu.tsx` — mostra "Ospite" + CTA Accedi in demo mode
- `src/lib/demo-data.ts` (nuovo) — dataset mock in memoria
- Ogni pagina CRUD (`clienti`, `fornitori`, `preventivi`, `commesse`, `rapportini`, `documenti`, `scadenziario`, `audit`, `index`) — se demo mode, legge/scrive dal dataset mock invece che da Supabase
- `.env` — aggiungo `VITE_DEMO_MODE=true`

## Come tornare al comportamento normale
Basta impostare `VITE_DEMO_MODE=false` (o rimuoverlo): tutto torna a richiedere il login reale, senza altre modifiche.

## Nota
Per rispondere anche alla prima domanda ("come faccio ad accedere?"): dalla pagina `/auth` clicchi la tab **Registrati**, inserisci nome impresa + i tuoi dati, e vieni loggato automaticamente. Ma con la modalità demo non servirà più per esplorare l'app.
