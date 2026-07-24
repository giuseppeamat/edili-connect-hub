
## Interventi

### 1) KPI della Dashboard cliccabili
- In `src/routes/_authenticated/index.tsx`, estendere `KpiCard` con una prop opzionale `to` (rotta TanStack) + eventuali `search` per pre-filtrare la pagina destinazione.
- Quando `to` è presente, il contenuto viene renderizzato dentro un `<Link>` (con hover ring + `aria-label`) mantenendo lo stesso layout visivo.
- Mappa destinazioni:
  - Preventivi aperti → `/preventivi`
  - Valore commesse / Cantieri attivi / Costi sostenuti / Margine previsto / SAL da emettere → `/commesse`
  - Documenti in scadenza (30gg) → `/scadenziario`
  - Ore lavorate (mese) → `/rapportini`

### 2) Errore `column reference "codice" is ambiguous` in "Converti in commessa"
Causa: nella SQL function `public.assign_commessa_codice` la variabile locale `codice TEXT` collide con la colonna `commesse.codice` usata nella subquery (`CASE WHEN codice ~ ...`).
- Migrazione: `CREATE OR REPLACE FUNCTION public.assign_commessa_codice` rinominando la variabile in `v_codice` e qualificando la colonna come `c.codice` con alias tabella.
- Nessuna modifica di firma o comportamento.

## File toccati

- `src/routes/_authenticated/index.tsx` — KPI cliccabili.
- Migrazione DB: fix ambiguità in `assign_commessa_codice`.

## Fuori scope

- Ridisegno della Dashboard o nuovi KPI.
