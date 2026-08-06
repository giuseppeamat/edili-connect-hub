# Evoluzione Rapportini — fasi restanti

Sì: il modello dati, le RPC e il dettaglio rapportino a tab sono già a posto.
Restano cinque blocchi, verificati sul codice attuale.

## Blocco A — Mansione nel personale del rapportino

Il campo `mansione` esiste già sulla tabella del personale rapportino ma non è
esposto nell'interfaccia. Va aggiunto al dialog di inserimento/modifica riga
personale (campo libero opzionale con suggerimenti dalla qualifica del membro)
e mostrato in tabella accanto al nominativo.

## Blocco B — Apertura rapportino dalla lista

Oggi si apre il dettaglio solo cliccando su data/autore/descrizione. Va aggiunta
un'azione primaria "Apri rapportino" in ogni riga: icona dedicata con tooltip,
raggiungibile da tastiera e visibile anche su mobile, che porta a `/rapportini/:id`.

## Blocco C — Sezione Subappaltatori dedicata

Nuova voce di menu separata da Fornitori, con:
- elenco ditte subappaltatrici (filtrate per tipologia soggetto);
- contratti di subappalto per commessa/cantiere (creazione, modifica, chiusura);
- documenti della ditta (DURC, visura, assicurazione) con scadenze, riusando il
  modulo documenti esistente;
- storico presenze e costi della ditta sui rapportini;
- indicatore documenti scaduti/in scadenza.

Gli importi restano visibili solo ai ruoli economici, con filtro lato server.

## Blocco D — Propagazione costi materiali e subappalti

La card costi extra è già nel dettaglio commessa. Mancano:
- KPI dashboard: costi materiali e subappalti del periodo, con drill-down;
- riepilogo costi nel dettaglio cantiere;
- alimentazione del budget analitico: i costi consuntivi di bolle e subappalti
  confluiscono nelle voci di categoria "materiali" e "subappalti" come importo
  sostenuto, senza doppio conteggio con la manodopera.

## Blocco E — Fornitori: bolle e prezzi

Nella scheda fornitore: elenco bolle emesse, materiali forniti e storico prezzi
con confronto rispetto agli altri fornitori (la pagina "Materiali e prezzi"
esiste già e verrà collegata per fornitore).

## Verifica finale

Test unitari sui nuovi calcoli aggregati, QA runtime autenticato dello scenario
completo (rapportino con personale, bolla e subappalto → costi visibili in
commessa, cantiere, dashboard e budget), poi typecheck, suite test e build.

## Note tecniche

- Blocco D richiede almeno una migrazione (RPC di aggregazione costi extra per
  commessa/cantiere/periodo e aggancio alle voci di budget).
- Blocchi A, B, C, E sono prevalentemente frontend più server function già
  disponibili; il Blocco C può richiedere una piccola RPC per i contratti.
- Nessuna modifica ai costi già congelati.
