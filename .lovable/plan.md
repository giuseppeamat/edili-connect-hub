## Problema
Il redirect a `/auth` scatta perché il login anonimo di Supabase fallisce (probabilmente non abilitato sul progetto), quindi il layout `_authenticated` ti sbatte sulla pagina di accesso e non vedi nulla del gestionale.

## Soluzione
Rimuovo del tutto il controllo di autenticazione dal layout: entri direttamente nel software e puoi navigare tutte le pagine (Dashboard, Clienti, Fornitori, Preventivi, Commesse, Rapportini, Documenti, Scadenziario, Audit) anche senza login.

### Cosa cambia
1. **`src/routes/_authenticated/route.tsx`** — tolgo `beforeLoad` e il tentativo di sign-in anonimo. Il layout renderizza sempre `AppShell` + `Outlet`, senza redirect.
2. **`src/routes/index.tsx`** (nuovo) — reindirizza `/` alla dashboard `/` autenticata... in pratica creo un index che monta direttamente la Dashboard, così aprendo il preview vedi subito il gestionale.
3. **`src/components/user-menu.tsx`** — siccome non c'è più utente, mostro sempre l'etichetta "Modalità demo" con il bottone **Accedi / Registrati** che porta a `/auth` (rimane disponibile per quando vorrai creare un account vero).
4. **`src/routes/auth.tsx`** — resta com'è, raggiungibile solo cliccando "Accedi".

### Conseguenza sui dati
Senza utente autenticato, le policy RLS bloccano tutte le query: le pagine si aprono ma le tabelle sono vuote (nessun errore, solo "Nessun risultato"). Questo ti permette comunque di **vedere la struttura, la navigazione e i form** di ogni modulo — che è quello che hai chiesto ("so dove andare a lavorare").

Per vedere dati veri servirà registrarsi una volta (nome impresa + email + password) e cliccare "Carica dati demo" in Dashboard — ma non è più bloccante per esplorare.

### File modificati
- `src/routes/_authenticated/route.tsx` (rimozione gate auth)
- `src/components/user-menu.tsx` (sempre in modalità ospite)

### Cosa NON tocco
- Schema DB, RLS, policy di sicurezza
- Pagina `/auth` (funziona già)
- Nessuna modifica al backend
