# Verifica errore su mobile

## Risposta breve
No, non è un problema legato al mobile. Il sito pubblicato risponde correttamente anche simulando un iPhone (HTTP 200, nessun "Errore di caricamento" nell'HTML). L'errore che vedi arriva dal browser dopo il caricamento, ed è lo stesso problema già affrontato: la vecchia versione dell'app resta in cache e l'URL della dashboard porta un parametro `periodo` malformato.

## Cosa propongo
1. Verifica reale su viewport mobile (iPhone) con login autenticato sul sito pubblicato: apertura `/auth`, accesso, arrivo in dashboard, cattura di eventuali errori console/rete.
2. Pulizia dell'URL lato client: se arriva `periodo` con virgolette o valore non valido, riscrivere l'indirizzo senza il parametro prima di eseguire la query, sia in dashboard sia nel redirect post-login.
3. Rimozione dei parametri tecnici `__lovable_*` dal redirect salvato, così l'indirizzo finale resta pulito.
4. Se dai test emerge ancora la schermata di errore, isolare la causa (sessione, server function, cache) e correggerla nello stesso passaggio.
5. Ripubblicazione e nuova verifica su mobile.

## Nota tecnica
- Controllo mirato su `src/routes/auth.tsx` (`safeRedirect`) e `src/routes/_authenticated/index.tsx` (normalizzazione `periodo` e stato di errore).
- Test con Playwright a viewport 390x844 e user agent iOS, contro l'URL pubblicato.
- Nessuna modifica al database o alle policy.

## Da fare comunque sul tuo telefono
Svuota la cache del browser o apri il sito in una scheda anonima: la versione vecchia dell'app resta memorizzata e continua a mostrare l'errore anche dopo la ripubblicazione.
