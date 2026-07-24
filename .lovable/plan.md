## Problema
La lista `/commesse` è vuota perché la query fallisce con HTTP 300 (`PGRST201`): la relazione tra `commesse` e `clienti` è ambigua — esistono due foreign key (`commesse_cliente_id_fkey` e la composite `commesse_cliente_org_fkey` introdotta nello Sprint 0 per l'isolamento tenant).

## Fix
In `src/routes/_authenticated/commesse.tsx`, disambiguare il join specificando il vincolo:

```
.select("*, clienti!commesse_cliente_id_fkey(ragione_sociale)")
```

Stesso pattern già usato in `preventivi.index.tsx` e nel dettaglio preventivo.

## Verifica
Ricaricare `/commesse`: la commessa appena creata dalla conversione deve comparire in lista con il nome del cliente.