
## Obiettivo

Risolvere sei problemi rilevati nel modulo Preventivi (Sprint 3).

## Interventi

### 1) "Nuova versione" apre sempre la vecchia versione
Sintomo: dopo `Nuova versione`, cliccando la nuova riga in lista si apre il preventivo vecchio.
- In `src/routes/_authenticated/preventivi.$id.tsx` il bottone "Nuova versione" naviga con `params.id = r.id` ma NON invalida `["preventivi"]` né il vecchio `["preventivo", oldId]`, e la lista mostra spesso due righe (stessa `numero`) perché il filtro "Solo versioni correnti" applica su `is_current_version` che può risultare stale.
- Fix client: dopo `newVersioneFn`, invalidare `["preventivi"]` e `["preventivo", id]`, poi navigare al nuovo id.
- Fix lista `preventivi.index.tsx`: quando `soloCorrenti` è true, deduplicare per `root_preventivo_id ?? id` tenendo la versione più alta / `is_current_version=true`, così l'utente vede una riga unica che porta sempre alla versione corrente.
- Verifica RPC `create_preventivo_nuova_versione`: già marca la vecchia come `is_current_version=false` e `superseded_by`. Se dopo il fix il problema persiste, aggiungere una piccola migrazione difensiva che ri-marca coerentemente il flag (nessuna modifica di schema attesa).

### 2) Il PDF si apre direttamente in una nuova scheda
- In `src/lib/preventivi.functions.ts`, dopo l'upload in Storage, generare una `createSignedUrl` (bucket `documenti`, TTL 5 min) e restituire `{ signed_url, documento_id, filename }`.
- In `preventivi.$id.tsx`, al successo del pulsante PDF: `window.open(signed_url, "_blank", "noopener")` invece del toast di "PDF generato in Documenti". Il documento resta comunque archiviato.

### 3) Simbolo € mostrato come "?" nel PDF
Causa: in `src/lib/preventivi-pdf.server.ts` la funzione `s()` sanitizza a Latin-1 stretto (0x20–0xFF) e scarta `€` (U+20AC). Helvetica standard di pdf-lib usa però WinAnsi che supporta `€` al byte 0x80.
- Aggiornare `s()` per preservare `€` (e altri caratteri WinAnsi come `‚ƒ„…†‡ˆ‰Š‹ŒŽ '"•–—˜™š›œžŸ`) sostituendo solo i caratteri realmente fuori dalla mappa WinAnsi.
- In pratica: whitelist esplicita per `€` (U+20AC) → mantenuto; qualsiasi altro non-Latin1 → `?`.

### 4) Testi e linee separatrici del PDF disallineate
- In `preventivi-pdf.server.ts` rivedere la tabella voci: colonne definite come X assoluti (`colX`) ma le celle numeriche non sono allineate a destra e alcune si sovrappongono su descrizioni lunghe.
- Correzioni:
  - Allineare `Q.tà`, `Prezzo`, `Sc.%`, `Netto` a destra calcolando `x = colRight - textWidth(font, size)`.
  - Aumentare la spaziatura tra colonne (nuovi X: desc 40 / qty 315 / um 355 / prezzo 400 / sconto 455 / netto 500 con margine destro 555).
  - Le linee `hr()` partono da `margin` e finiscono a `A4.w - margin`: allinearle anche sotto l'header voci ed estenderle alla stessa larghezza del blocco totali (già ok).
  - Blocco totali: allineare label a destra della colonna label e valore a destra della colonna valore con `text-width` reale.

### 5) Cambio stato libero (non gerarchico)
- Modificare la SQL function `change_preventivo_stato` per rimuovere la matrice di transizioni consentite: ammettere qualsiasi passaggio tra i 9 stati, mantenendo solo:
  - autorizzazione ruolo (`has_any_role` invariata);
  - aggiornamento timestamp corrispondenti (`data_invio`, `data_accettazione`, `data_rifiuto`, `annullato_at`) solo se non già valorizzati;
  - inserimento in `preventivo_storico_stati` e `audit_log`.
- La UI espone già la Select con tutti gli stati, non serve altro.

### 6) Auto-conversione in Commessa al passaggio ad "accettato"
- Nella stessa migrazione, quando `_nuovo_stato = 'accettato'` e non esiste già una commessa per il preventivo (`SELECT ... FROM commesse WHERE preventivo_id = _preventivo_id`), chiamare `convert_preventivo_to_commessa(_preventivo_id, NULL, NULL, NULL, NULL, NULL)` all'interno di `change_preventivo_stato`.
- La RPC esistente richiede `stato IN ('accettato')`: dato che stiamo appena impostando `accettato` prima della chiamata (`UPDATE ... stato = _nuovo_stato` avviene prima), la guardia passa. Verranno usati valori di default (data_inizio = oggi).
- Nota UI: il pulsante "Converti in commessa" nel builder resta come conversione manuale con parametri custom (data inizio, indirizzo cantiere, responsabile). Se già esiste, l'RPC lancia errore 23505 che la state-machine intercetta e ignora (auto-conversione idempotente).
- Non si tocca il flusso `convertito` (rimane possibile ma non più automatico).

## File toccati

- `src/lib/preventivi.functions.ts` — PDF signed URL, ritorno esteso.
- `src/lib/preventivi-pdf.server.ts` — sanitizer € + allineamenti colonne/totali.
- `src/routes/_authenticated/preventivi.$id.tsx` — PDF apri in nuova scheda, invalidazioni post-nuova-versione.
- `src/routes/_authenticated/preventivi.index.tsx` — dedup versioni quando "Solo correnti".
- Migrazione DB: aggiorna `change_preventivo_stato` (stato libero + auto-convert su `accettato`).

## Fuori scope

- Modifiche alla UI Commesse (la commessa creata sarà già visibile nella pagina Commesse).
- Redesign completo del PDF (interveniamo solo su valuta e allineamenti).
