# Invio in approvazione bloccato sui rapportini di squadra

## Cosa succede

Nel cantiere Milena Prati ci sono due rapportini in bozza (3 e 4 settembre), ciascuno con 4 persone e 32 ore totali di squadra.

Il controllo eseguito al momento dell'invio accetta al massimo 24 ore per rapportino, come se ci fosse una sola persona. Con 4 operai da 8 ore il totale è 32, quindi l'invio viene rifiutato. Il messaggio mostrato è generico ("Dati non validi per completare l'operazione") e non spiega il motivo reale.

La creazione e la modifica del rapportino usano invece già la regola corretta per le squadre, quindi il rapportino si salva ma poi non si riesce a inviarlo.

## Regola sulle ore (confermata dall'utente)

Un rapportino con più dipendenti può avere un monte ore maggiore: il limite è di 24 ore per persona, con un tetto complessivo di 240 ore. Esempio: 4 operai = fino a 96 ore, 5 operai = fino a 120 ore.

## Cosa faccio

1. Allineo il controllo dell'invio a questa regola: il massimo consentito diventa 24 ore moltiplicate per il numero di persone inserite nel rapportino (tetto 240), invece del limite fisso di 24.
2. Faccio arrivare all'utente il motivo preciso quando un invio viene rifiutato (ore oltre il massimo per la squadra, descrizione mancante, data mancante, commessa chiusa), invece del messaggio generico attuale.

Dopo la modifica i due rapportini da 32 ore di Milena Prati si potranno inviare e approvare normalmente.

## Dettagli tecnici

- Migrazione su `public.submit_rapportino`: sostituire `_row.ore > 24` con il tetto dinamico `24 * GREATEST(1, (SELECT COUNT(*) FROM public.rapportini_personale rp WHERE rp.rapportino_id = _id))`, limitato a 240, come in `update_rapportino`. Aggiornare il testo dell'eccezione in modo che riporti ore inserite e massimo consentito.
- `src/lib/server-error-mapper.ts`: per lo SQLSTATE `22023` non applicare più il messaggio generico a tappeto; usare prima i pattern testuali e aggiungere voci per "ore non valide", "descrizione lavori obbligatoria", "data obbligatoria", "rapportino archiviato", "operazione non disponibile nello stato attuale". Il fallback generico resta per messaggi non riconosciuti o palesemente tecnici.
- Nessuna modifica alle regole di permesso o al workflow degli stati.
