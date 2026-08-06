# Piano — Abilita registrazione bolle su rapportino approvato

## Obiettivo
Permettere di aggiungere bolle e materiali a un rapportino già **approvato**, ma solo a determinati ruoli operativi. La sezione **Subappaltatori** resta invariata e non potrà essere modificata su rapportino approvato.

## Stato attuale verificato
- Il rapportino aperto (`a7092474-ea29-4f12-bfda-c781a82952ad`) è in stato `approvato`.
- La guardia server `_rap_extra_guard` blocca scrittura su stato `approvato` per chi non sia Proprietario o Amministratore.
- La UI usa `rapportinoModificabile()` che rende la sezione in sola lettura per ogni stato `approvato`, annullato o archiviato, indipendentemente dal ruolo.
- Il risultato è che il pulsante **“Nuova bolla”** non appare mai su rapportino approvato, anche se il server potrebbe permetterlo.

## Decisioni confermate dall'utente
- Ruoli autorizzati a registrare bolle post-approvazione: **Proprietario, Amministratore, Amministrazione, Ufficio Tecnico, Responsabile Commessa, Capocantiere** (ossia gli stessi ruoli già abilitati a `can_edit_rapportino_extra`).
- La modifica vale **solo per le bolle**, non per i subappaltatori.

## Modifiche previste

### 1. Database — guardia dedicata alle bolle
- Creare una nuova funzione `public._rap_bolla_guard(_rapportino_id uuid)` che:
  - verifichi che l'utente appartenga alla stessa organizzazione del rapportino;
  - verifichi accesso alla commessa;
  - verifichi `public.can_edit_rapportino_extra(r.organization_id)`;
  - blocchi se `archived_at` o stato `annullato`;
  - **permetta** la scrittura anche se lo stato è `approvato`.
- Modificare `public.save_rapportino_bolla` per chiamare `_rap_bolla_guard` al posto di `_rap_extra_guard`.
- Lasciare invariata `public.save_rapportino_subappalto` (che continua a usare `_rap_extra_guard` e quindi blocca post-approvazione).

### 2. Logica client — distinzione bolle/subappalti
- In `src/lib/rapportini-extra.ts` creare `bolleModificabili(r, ruoli)` che:
  - restituisca `false` per rapportino assente, archiviato o annullato;
  - restituisca `true` per stato `bozza` o `inviato`;
  - per stato `approvato` richieda almeno uno dei ruoli operativi elencati sopra.
- Mantenere `rapportinoModificabile()` invariata per uso generale (subappaltatori e altre sezioni).

### 3. UI dettaglio rapportino
- In `src/routes/_authenticated/rapportini.$rapportinoId.tsx`:
  - calcolare `readOnlyBolle` usando `bolleModificabili(r, user.roles)`;
  - calcolare `readOnlySubappalti` usando `rapportinoModificabile(r)` come ora;
  - passare le due prop separate a `BolleSection` e `SubappaltatoriSection`.
- Aggiungere un breve messaggio informativo nel tab “Bolle e materiali” quando il rapportino è approvato, per indicare che si tratta di registrazione post-approvazione.

### 4. Componenti
- `src/components/rapportini/bolle-section.tsx`: usare la nuova prop `readOnlyBolle` al posto di `readOnly`.
- `src/components/rapportini/subappaltatori-section.tsx`: continuare a usare `readOnly` (già mappata su `readOnlySubappalti` dalla rotta).

### 5. Test
- Aggiornare `src/lib/__tests__/rapportini-extra.test.ts` con casi per `bolleModificabili`:
  - bozza/inviato: modificabile per tutti i ruoli edit-extra;
  - approvato: modificabile solo per ruoli operativi;
  - annullato/archiviato: non modificabile per nessuno.
- Eseguire test esistenti per confermare nessuna regressione su subappaltatori.

### 6. QA runtime
- Verificare che su un rapportino approvato appaia il pulsante “Nuova bolla” per un utente con ruolo operativo.
- Verificare che la bolla venga salvata senza errore e che il riepilogo costi si aggiorni.
- Verificare che la sezione Subappaltatori continui a non mostrare il pulsante su rapportino approvato.

## Criterio di accettazione
- Un utente con ruolo Proprietario, Amministratore, Amministrazione, Ufficio Tecnico, Responsabile Commessa o Capocantiere può aprire un rapportino approvato, entrare nel tab “Bolle e materiali”, cliccare “Nuova bolla”, compilare i dati e salvare.
- Gli utenti senza quei ruoli non vedono il pulsante su rapportino approvato.
- Rapportino annullato o archiviato: nessuno può aggiungere bolle.
- Subappaltatori su rapportino approvato: rimane bloccato per tutti.
