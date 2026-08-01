# Correzione definitiva apertura CantiereOS

## Problema verificato
- La rotta `/auth` è configurata con `ssr: false` e un controllo sessione in `beforeLoad`.
- Il runtime registra un hydration mismatch su questa rotta: il server restituisce un fallback `Suspense`, mentre il client monta direttamente `AuthPage`.
- Il backend e il server di anteprima risultano avviati; gli ultimi log non mostrano più variabili backend mancanti.

## Intervento
1. Rendere `/auth` una normale rotta pubblica compatibile con SSR, così server e browser producono lo stesso markup iniziale.
2. Spostare il controllo dell’utente già autenticato nel solo client dopo l’idratazione, mantenendo il redirect sicuro alla destinazione richiesta.
3. Ripulire il parametro `redirect` dai parametri tecnici dell’anteprima prima di riutilizzarlo, senza alterare i parametri applicativi validi.
4. Mantenere invariati login, registrazione, recupero password e gate delle pagine protette.

## Verifica
- Aprire direttamente `/auth` da sessione anonima e confermare che il form venga mostrato senza error boundary o hydration mismatch.
- Aprire `/` da sessione anonima e verificare il redirect stabile verso `/auth`.
- Verificare il flusso con sessione autenticata e il ritorno alla pagina richiesta.
- Controllare console, richieste di rete e resa mobile nel viewport attuale.

## Ambito tecnico
- Modifica mirata principalmente a `src/routes/auth.tsx`.
- Nessuna migrazione database, modifica RLS o variazione dei moduli ERP.