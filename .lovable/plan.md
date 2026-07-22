# Piano: SaaS multi-tenant per imprese edili italiane

Progetto molto ampio. Propongo un MVP in **Fase 1** solido e navigabile, poi iterazioni successive per completare logiche avanzate (versioning preventivi, SAL, calcoli margini complessi, permessi granulari per ruolo).

## Stack

- Frontend: TanStack Start (già presente) + Tailwind + shadcn/ui
- Backend: Lovable Cloud (Postgres + Auth + Storage) con Row Level Security
- Lingua UI: **Italiano**
- Design: pulito, professionale, palette blu/grigio "cantiere", responsive mobile-first

## Fase 1 – MVP (questa iterazione)

### 1. Database (schema + RLS + seed)

Tabelle principali, tutte con `organization_id` e RLS per isolare i tenant:

- `organizations` – tenant (nome, P.IVA, indirizzo)
- `profiles` – dati utente (nome, cognome, telefono) legato a `auth.users`
- `organization_members` – utente ↔ organizzazione (per supporto multi-org futuro)
- `app_role` enum + `user_roles` (user_id, organization_id, role) – **tabella separata**, funzione `has_role()` SECURITY DEFINER
- `clienti` – anagrafica clienti
- `fornitori` – anagrafica fornitori + categoria
- `preventivi` + `preventivo_voci` (con capitolo, categoria, descrizione, UM, qta, costo, prezzo, ricarico, sconto, IVA)
- `commesse` (cliente, importo, date, responsabile, budget, stato, % avanzamento)
- `rapportini` (utente, cantiere, data, ore, lavorazione, note)
- `documenti` (categoria, entità collegata polimorfa, scadenza, stato, visibilità, tags, storage_path)
- `audit_log` (user_id, action, entity, entity_id, metadata, created_at)

Trigger:
- auto-creazione `profile` + `organization` + ruolo `proprietario` al signup
- audit trigger su insert/update/delete delle tabelle chiave
- ricalcolo totali preventivo su modifica voci

Storage: bucket privato `documenti` con policy per organization_id nel path.

### 2. Autenticazione

- Signup email/password (crea nuova organizzazione + assegna ruolo Proprietario)
- Login / Logout
- Route protette sotto `_authenticated/`
- Redirect intelligente post-login

### 3. Navigazione & layout

Sidebar responsive (collapsible su mobile) con voci:
Dashboard, Clienti, Fornitori, Preventivi, Commesse, Rapportini, Documenti, Scadenziario, Audit, Impostazioni.

Header con nome organizzazione, utente, logout.

### 4. Pagine CRUD (list + detail + form)

- **Dashboard** con KPI card (preventivi aperti, valore commesse, cantieri attivi, costi, margine, documenti in scadenza, ore lavorate, SAL da emettere) – calcolati da query aggregate
- **Clienti**: lista + dettaglio con tab (anagrafica, documenti, preventivi, commesse)
- **Fornitori**: lista + dettaglio con tab
- **Preventivi**: lista + editor con capitoli/voci, calcolo live costo/ricavo/margine, azione "Trasforma in commessa"
- **Commesse/cantieri**: lista + dettaglio con tab (info, costi, attività, documenti, foto)
- **Rapportini**: lista + form rapido (ottimizzato mobile per capocantiere/operaio)
- **Documenti**: upload + lista filtrabile per categoria/entità/scadenza
- **Scadenziario**: vista raggruppata (scaduti / 7 / 15 / 30 / 60 giorni)
- **Audit**: tabella read-only ultime operazioni

### 5. Dati demo

Al signup del primo utente, seed automatico opzionale di:
- 1 organizzazione "Edilizia Rossi S.r.l."
- 5 clienti, 5 fornitori italiani realistici
- 3 preventivi (uno accettato → commessa collegata)
- 2 commesse attive
- 10 rapportini
- alcuni documenti con scadenze varie

## Fase 2 – iterazioni successive (fuori scope questa iterazione)

- Versioning preventivi multiplo con confronto
- Gestione SAL (Stato Avanzamento Lavori) con emissione
- Permessi granulari per ruolo (matrice completa azioni × ruoli)
- Upload multi-foto cantiere con galleria
- Opportunità commerciali (pipeline)
- Notifiche scadenze via email
- Export PDF preventivi/SAL
- Import anagrafiche da CSV/Excel

## Note tecniche

- Multi-tenant: RLS su ogni tabella filtra per `organization_id IN (SELECT organization_id FROM user_roles WHERE user_id = auth.uid())`
- Ruoli in tabella dedicata `user_roles` con enum `app_role` – MAI su `profiles` (evita privilege escalation)
- Funzione `current_organization_id()` SECURITY DEFINER per policy
- Tutti gli importi in `numeric(14,2)`, quantità `numeric(14,3)`
- Server functions TanStack (`createServerFn` + `requireSupabaseAuth`) per operazioni sensibili come "trasforma preventivo in commessa" e seed demo

Confermi che posso procedere con la Fase 1 così descritta? Se preferisci restringere ulteriormente (es. partire solo con Dashboard + Clienti + Preventivi), dimmelo.
