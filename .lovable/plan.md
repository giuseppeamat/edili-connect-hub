## Obiettivo

Correggere la generazione del link di invito: oggi usa `window.location.origin`, che nell'anteprima dell'editor produce un URL `id-preview--…lovable.app` (apre l'editor Lovable). Il link deve invece puntare sempre all'app pubblicata `https://edili-connect-hub.lovable.app`.

L'invio email resta manuale per ora (copia link e condividilo via canale esterno). Nessun invio email verrà attivato in questo intervento.

## Modifiche

1. **`src/lib/app-url.ts` (nuovo)** — piccola utility `getPublicAppUrl()` che restituisce l'URL pubblico di base:
   - legge `import.meta.env.VITE_PUBLIC_APP_URL` se impostato (per flessibilità futura, es. dominio custom);
   - altrimenti ritorna la costante `https://edili-connect-hub.lovable.app`.

2. **`src/routes/_authenticated/organizzazione.tsx`** — sostituire `window.location.origin` con `getPublicAppUrl()` nella riga che compone il link invito. Il link diventerà `https://edili-connect-hub.lovable.app/accetta-invito?token=…`.

3. **UI Inviti — piccolo miglioramento di chiarezza**: sotto il link mostrato dopo la creazione, aggiungere una nota breve tipo _"Copia e invia questo link al destinatario (WhatsApp, email, ecc.). L'invio automatico via email non è ancora attivo."_ così l'aspettativa è chiara.

## Note

- Nessuna modifica al database, alle policy o alle Server Functions.
- La route `/accetta-invito` esiste già e funziona identicamente sull'app pubblicata.
- Se in futuro colleghi un dominio personalizzato, basterà impostare `VITE_PUBLIC_APP_URL` per farlo puntare lì senza toccare codice.
