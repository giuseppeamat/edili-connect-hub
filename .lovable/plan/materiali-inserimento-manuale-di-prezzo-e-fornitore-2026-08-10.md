# Materiali — inserimento manuale di prezzo e fornitore

## Situazione attuale (verificata)

- La pagina "Materiali e prezzi" permette solo di creare/modificare l'anagrafica materiale (nome, codice, categoria, unità di misura, descrizione).
- Lo storico prezzi (`materiali_prezzi_fornitori`) oggi si popola **solo** registrando le righe delle bolle nei rapportini: a livello database gli utenti hanno il permesso di sola lettura, nessun inserimento manuale è possibile.
- Per questo nel form "Nuovo materiale" non ci sono i campi prezzo e fornitore.

## Cosa aggiungere

1. **Prezzo e fornitore direttamente nel form materiale**
   Nella finestra "Nuovo materiale" / "Modifica materiale" una sezione opzionale "Prezzo di riferimento":
   - Fornitore (scelta dall'anagrafica fornitori esistente)
   - Prezzo unitario, unità di misura, data del prezzo (default oggi), nota
   Se compilata, al salvataggio viene registrata una rilevazione di prezzo collegata al materiale.
   La sezione è visibile solo ai ruoli con visibilità economica (Proprietario, Amministratore, Amministrazione).

2. **Nuova rilevazione prezzo dallo storico**
   Nel tab "Storico prezzi" un pulsante "Nuova rilevazione" con lo stesso form (materiale, fornitore, prezzo, U.M., data, nota), per aggiornare i listini senza passare da una bolla.

3. **Ultimo prezzo in anagrafica**
   Nella tabella materiali una colonna "Ultimo prezzo" (prezzo + fornitore + data), visibile solo ai ruoli economici.

4. **Tracciabilità**
   Le rilevazioni manuali restano append-only come quelle da bolla, con indicazione dell'origine (manuale / da bolla) nello storico, così il confronto fornitori resta coerente e nulla viene sovrascritto.

## Dettagli tecnici

- Migrazione: colonna `origine` ('bolla' | 'manuale') e `note` su `materiali_prezzi_fornitori`; nuova RPC `SECURITY DEFINER` `save_prezzo_materiale` che verifica organizzazione e ruolo economico, valida prezzo >= 0 e inserisce la rilevazione (nessun GRANT INSERT diretto alla tabella).
- `get_materiali_prezzi` estesa per restituire `origine` e `note`.
- `src/lib/materiali.functions.ts`: nuova server function `savePrezzoMateriale`; `saveMateriale` accetta un blocco prezzo opzionale e chiama la stessa RPC dopo la creazione.
- `src/routes/_authenticated/materiali.tsx`: campi prezzo nel dialog, dialog "Nuova rilevazione", colonna ultimo prezzo, invalidazione di `extraKeys.materiali()` e `extraKeys.prezzi()`.
- Test unitari sulla derivazione dell'ultimo prezzo per materiale; poi typecheck, vitest e build.
