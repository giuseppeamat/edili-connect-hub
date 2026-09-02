# Accesso ai dati per Ilaria Bartucca (ruolo Amministrazione)

## Cosa risulta dai dati

Verifiche fatte sul database:

- Il membro Ilaria Bartucca è collegato a un account attivo, nella tua organizzazione, con stato accesso "attivo".
- Il ruolo "Amministrazione" le è stato assegnato oggi alle 12:54 (ora italiana), mentre il suo ultimo accesso al software risale alle 11:45 — quindi la sua sessione aperta sta ancora usando il vecchio ruolo.
- Prima era "Responsabile Commessa" e non era assegnata a nessuna commessa: con quel ruolo il software mostra solo le commesse di cui si è responsabili o membri, per questo non vedeva alcun dato.
- Le regole di sicurezza del database trattano già "Amministrazione" esattamente come "Amministratore": con il nuovo ruolo vedrà clienti, commesse, rapportini, preventivi, documenti e organizzazione.

Nessun difetto nelle regole di accesso: manca solo la propagazione del nuovo ruolo alla sessione già aperta.

## Cosa faccio

1. Prima verifica immediata: Ilaria esce e rientra (logout/login). Con il nuovo ruolo dovrebbe vedere tutti i dati.
2. Miglioria per evitare che succeda ancora: quando un amministratore cambia il ruolo di un membro, il software forza l'aggiornamento dei permessi lato utente, senza bisogno di rifare l'accesso.
   - I permessi dell'utente vengono riletti automaticamente al rientro sulla scheda del browser e a intervalli brevi, invece di restare in cache.
   - Se il ruolo effettivo risulta cambiato rispetto a quello caricato all'apertura, compare un avviso "I tuoi permessi sono stati aggiornati" con ricarica della pagina.
3. Piccolo aiuto nella pagina Organizzazione: dopo il salvataggio di un cambio ruolo viene mostrato un promemoria che l'utente interessato vedrà i nuovi permessi al prossimo aggiornamento della pagina.

## Dettagli tecnici

- `src/hooks/use-current-user.ts`: ridurre `staleTime` della query `current-user`, abilitare `refetchOnWindowFocus` e un `refetchInterval` moderato; confrontare l'elenco ruoli con quello iniziale e segnalare il cambiamento.
- Avviso di permessi aggiornati tramite `sonner` (già in uso), con azione di ricarica.
- `src/components/organizzazione/membri-tab.tsx`: toast informativo dopo il cambio ruolo.
- Nessuna migrazione database necessaria: ruoli, stato accesso e policy RLS sono già corretti.
