export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cantieri: {
        Row: {
          archived_at: string | null
          cap: string | null
          capocantiere_id: string | null
          citta: string | null
          codice: string
          commessa_id: string
          created_at: string
          created_by: string | null
          data_fine_effettiva: string | null
          data_fine_prevista: string | null
          data_inizio_effettiva: string | null
          data_inizio_prevista: string | null
          descrizione: string | null
          id: string
          indirizzo: string | null
          is_principale: boolean
          latitudine: number | null
          longitudine: number | null
          nome: string
          note_operative: string | null
          numero_civico: string | null
          organization_id: string
          paese: string | null
          provincia: string | null
          referente_email: string | null
          referente_nome: string | null
          referente_telefono: string | null
          responsabile_id: string | null
          stato: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cap?: string | null
          capocantiere_id?: string | null
          citta?: string | null
          codice: string
          commessa_id: string
          created_at?: string
          created_by?: string | null
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio_effettiva?: string | null
          data_inizio_prevista?: string | null
          descrizione?: string | null
          id?: string
          indirizzo?: string | null
          is_principale?: boolean
          latitudine?: number | null
          longitudine?: number | null
          nome: string
          note_operative?: string | null
          numero_civico?: string | null
          organization_id: string
          paese?: string | null
          provincia?: string | null
          referente_email?: string | null
          referente_nome?: string | null
          referente_telefono?: string | null
          responsabile_id?: string | null
          stato?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cap?: string | null
          capocantiere_id?: string | null
          citta?: string | null
          codice?: string
          commessa_id?: string
          created_at?: string
          created_by?: string | null
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio_effettiva?: string | null
          data_inizio_prevista?: string | null
          descrizione?: string | null
          id?: string
          indirizzo?: string | null
          is_principale?: boolean
          latitudine?: number | null
          longitudine?: number | null
          nome?: string
          note_operative?: string | null
          numero_civico?: string | null
          organization_id?: string
          paese?: string | null
          provincia?: string | null
          referente_email?: string | null
          referente_nome?: string | null
          referente_telefono?: string | null
          responsabile_id?: string | null
          stato?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cantieri_commessa_fk"
            columns: ["commessa_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cantieri_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_contatti: {
        Row: {
          archived_at: string | null
          cellulare: string | null
          cliente_id: string
          cognome: string | null
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          nome: string
          note: string | null
          organization_id: string
          pec: string | null
          ruolo: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cellulare?: string | null
          cliente_id: string
          cognome?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          nome: string
          note?: string | null
          organization_id: string
          pec?: string | null
          ruolo?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cellulare?: string | null
          cliente_id?: string
          cognome?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          nome?: string
          note?: string | null
          organization_id?: string
          pec?: string | null
          ruolo?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_contatti_cliente_org_fkey"
            columns: ["cliente_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cliente_contatti_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clienti: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          cap: string | null
          cellulare: string | null
          citta: string | null
          codice_destinatario: string | null
          codice_fiscale: string | null
          cognome: string | null
          created_at: string
          created_by: string | null
          denominazione: string
          email: string | null
          fonte_acquisizione: string | null
          id: string
          indirizzo: string | null
          nome: string | null
          note: string | null
          note_interne: string | null
          numero_civico: string | null
          organization_id: string
          paese: string | null
          partita_iva: string | null
          pec: string | null
          provincia: string | null
          ragione_sociale: string | null
          referente: string | null
          responsabile_id: string | null
          sito_web: string | null
          stato_cliente: Database["public"]["Enums"]["cliente_stato"]
          telefono: string | null
          tipo: Database["public"]["Enums"]["cliente_tipo"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          cap?: string | null
          cellulare?: string | null
          citta?: string | null
          codice_destinatario?: string | null
          codice_fiscale?: string | null
          cognome?: string | null
          created_at?: string
          created_by?: string | null
          denominazione: string
          email?: string | null
          fonte_acquisizione?: string | null
          id?: string
          indirizzo?: string | null
          nome?: string | null
          note?: string | null
          note_interne?: string | null
          numero_civico?: string | null
          organization_id: string
          paese?: string | null
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale?: string | null
          referente?: string | null
          responsabile_id?: string | null
          sito_web?: string | null
          stato_cliente?: Database["public"]["Enums"]["cliente_stato"]
          telefono?: string | null
          tipo?: Database["public"]["Enums"]["cliente_tipo"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          cap?: string | null
          cellulare?: string | null
          citta?: string | null
          codice_destinatario?: string | null
          codice_fiscale?: string | null
          cognome?: string | null
          created_at?: string
          created_by?: string | null
          denominazione?: string
          email?: string | null
          fonte_acquisizione?: string | null
          id?: string
          indirizzo?: string | null
          nome?: string | null
          note?: string | null
          note_interne?: string | null
          numero_civico?: string | null
          organization_id?: string
          paese?: string | null
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale?: string | null
          referente?: string | null
          responsabile_id?: string | null
          sito_web?: string | null
          stato_cliente?: Database["public"]["Enums"]["cliente_stato"]
          telefono?: string | null
          tipo?: Database["public"]["Enums"]["cliente_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clienti_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clienti_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clienti_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clienti_responsabile_id_fkey"
            columns: ["responsabile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commessa_budget_voci: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          cantiere_id: string | null
          categoria: string
          codice: string | null
          commessa_id: string
          costo_residuo_stimato: number
          created_at: string
          created_by: string | null
          descrizione: string
          fase_id: string | null
          fonte: string
          fornitore_id: string | null
          id: string
          importo_impegnato: number
          importo_previsto: number
          importo_sostenuto: number
          is_locked: boolean
          note: string | null
          organization_id: string
          posizione: number
          preventivo_voce_id: string | null
          prezzo_unitario: number | null
          quantita: number | null
          sottocategoria: string | null
          tipo: string
          unita_misura: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          cantiere_id?: string | null
          categoria: string
          codice?: string | null
          commessa_id: string
          costo_residuo_stimato?: number
          created_at?: string
          created_by?: string | null
          descrizione: string
          fase_id?: string | null
          fonte?: string
          fornitore_id?: string | null
          id?: string
          importo_impegnato?: number
          importo_previsto?: number
          importo_sostenuto?: number
          is_locked?: boolean
          note?: string | null
          organization_id: string
          posizione?: number
          preventivo_voce_id?: string | null
          prezzo_unitario?: number | null
          quantita?: number | null
          sottocategoria?: string | null
          tipo: string
          unita_misura?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          cantiere_id?: string | null
          categoria?: string
          codice?: string | null
          commessa_id?: string
          costo_residuo_stimato?: number
          created_at?: string
          created_by?: string | null
          descrizione?: string
          fase_id?: string | null
          fonte?: string
          fornitore_id?: string | null
          id?: string
          importo_impegnato?: number
          importo_previsto?: number
          importo_sostenuto?: number
          is_locked?: boolean
          note?: string | null
          organization_id?: string
          posizione?: number
          preventivo_voce_id?: string | null
          prezzo_unitario?: number | null
          quantita?: number | null
          sottocategoria?: string | null
          tipo?: string
          unita_misura?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cbv_cantiere_fk"
            columns: ["cantiere_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cantieri"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cbv_commessa_fk"
            columns: ["commessa_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cbv_fase_fk"
            columns: ["fase_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commessa_fasi"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cbv_fase_fk"
            columns: ["fase_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commessa_fasi_ritardi"
            referencedColumns: ["fase_id", "organization_id"]
          },
          {
            foreignKeyName: "cbv_fornitore_fk"
            columns: ["fornitore_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "fornitori"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cbv_preventivo_voce_fk"
            columns: ["preventivo_voce_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivo_voci"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commessa_budget_voci_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commessa_fasi: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          avanzamento_percentuale: number
          cantiere_id: string | null
          commessa_id: string
          created_at: string
          created_by: string | null
          data_fine_effettiva: string | null
          data_fine_prevista: string | null
          data_inizio_effettiva: string | null
          data_inizio_prevista: string | null
          descrizione: string | null
          id: string
          note: string | null
          organization_id: string
          peso_percentuale: number
          posizione: number
          responsabile_id: string | null
          stato: string
          titolo: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          avanzamento_percentuale?: number
          cantiere_id?: string | null
          commessa_id: string
          created_at?: string
          created_by?: string | null
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio_effettiva?: string | null
          data_inizio_prevista?: string | null
          descrizione?: string | null
          id?: string
          note?: string | null
          organization_id: string
          peso_percentuale?: number
          posizione?: number
          responsabile_id?: string | null
          stato?: string
          titolo: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          avanzamento_percentuale?: number
          cantiere_id?: string | null
          commessa_id?: string
          created_at?: string
          created_by?: string | null
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio_effettiva?: string | null
          data_inizio_prevista?: string | null
          descrizione?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          peso_percentuale?: number
          posizione?: number
          responsabile_id?: string | null
          stato?: string
          titolo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commessa_fasi_cantiere_fk"
            columns: ["cantiere_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cantieri"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commessa_fasi_commessa_fk"
            columns: ["commessa_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commessa_fasi_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commessa_membri: {
        Row: {
          archived_at: string | null
          cantiere_id: string | null
          commessa_id: string
          created_at: string
          created_by: string | null
          data_fine: string | null
          data_inizio: string
          id: string
          is_active: boolean
          note: string | null
          organization_id: string
          ruolo_operativo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          cantiere_id?: string | null
          commessa_id: string
          created_at?: string
          created_by?: string | null
          data_fine?: string | null
          data_inizio?: string
          id?: string
          is_active?: boolean
          note?: string | null
          organization_id: string
          ruolo_operativo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          cantiere_id?: string | null
          commessa_id?: string
          created_at?: string
          created_by?: string | null
          data_fine?: string | null
          data_inizio?: string
          id?: string
          is_active?: boolean
          note?: string | null
          organization_id?: string
          ruolo_operativo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commessa_membri_cantiere_fk"
            columns: ["cantiere_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cantieri"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commessa_membri_commessa_fk"
            columns: ["commessa_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commessa_membri_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commesse: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          avanzamento_calcolato_at: string | null
          avanzamento_modalita: string
          avanzamento_pct: number
          baseline_costi: number | null
          baseline_created_at: string | null
          baseline_created_by: string | null
          baseline_margine: number | null
          baseline_preventivo_id: string | null
          baseline_ricavi: number | null
          budget_calcolato_at: string | null
          budget_costi: number
          budget_modalita: string
          cliente_id: string | null
          closed_at: string | null
          closed_by: string | null
          codice: string
          costi_impegnati: number
          costi_previsti: number | null
          costi_residui_stimati: number
          costi_sostenuti: number
          costo_aggiornato: number | null
          created_at: string
          created_by: string | null
          data_apertura: string | null
          data_fine_effettiva: string | null
          data_fine_prevista: string | null
          data_inizio: string | null
          data_inizio_effettiva: string | null
          data_inizio_prevista: string | null
          denominazione: string
          descrizione: string | null
          extra_approvati: number
          extra_non_approvati: number
          id: string
          importo: number
          importo_contratto: number | null
          indirizzo_cantiere: string | null
          margine_aggiornato: number | null
          margine_percentuale: number | null
          margine_percentuale_aggiornato: number | null
          margine_previsto: number | null
          note: string | null
          note_interne: string | null
          organization_id: string
          preventivo_id: string | null
          priorita: string | null
          responsabile_id: string | null
          ricavi_acquisiti: number | null
          ricavi_aggiornati: number | null
          ricavi_previsti: number | null
          scostamento_costi: number | null
          scostamento_margine: number | null
          scostamento_ricavi: number | null
          stato: Database["public"]["Enums"]["commessa_stato"]
          tipologia: string | null
          titolo: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          avanzamento_calcolato_at?: string | null
          avanzamento_modalita?: string
          avanzamento_pct?: number
          baseline_costi?: number | null
          baseline_created_at?: string | null
          baseline_created_by?: string | null
          baseline_margine?: number | null
          baseline_preventivo_id?: string | null
          baseline_ricavi?: number | null
          budget_calcolato_at?: string | null
          budget_costi?: number
          budget_modalita?: string
          cliente_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          codice: string
          costi_impegnati?: number
          costi_previsti?: number | null
          costi_residui_stimati?: number
          costi_sostenuti?: number
          costo_aggiornato?: number | null
          created_at?: string
          created_by?: string | null
          data_apertura?: string | null
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio?: string | null
          data_inizio_effettiva?: string | null
          data_inizio_prevista?: string | null
          denominazione: string
          descrizione?: string | null
          extra_approvati?: number
          extra_non_approvati?: number
          id?: string
          importo?: number
          importo_contratto?: number | null
          indirizzo_cantiere?: string | null
          margine_aggiornato?: number | null
          margine_percentuale?: number | null
          margine_percentuale_aggiornato?: number | null
          margine_previsto?: number | null
          note?: string | null
          note_interne?: string | null
          organization_id: string
          preventivo_id?: string | null
          priorita?: string | null
          responsabile_id?: string | null
          ricavi_acquisiti?: number | null
          ricavi_aggiornati?: number | null
          ricavi_previsti?: number | null
          scostamento_costi?: number | null
          scostamento_margine?: number | null
          scostamento_ricavi?: number | null
          stato?: Database["public"]["Enums"]["commessa_stato"]
          tipologia?: string | null
          titolo?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          avanzamento_calcolato_at?: string | null
          avanzamento_modalita?: string
          avanzamento_pct?: number
          baseline_costi?: number | null
          baseline_created_at?: string | null
          baseline_created_by?: string | null
          baseline_margine?: number | null
          baseline_preventivo_id?: string | null
          baseline_ricavi?: number | null
          budget_calcolato_at?: string | null
          budget_costi?: number
          budget_modalita?: string
          cliente_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          codice?: string
          costi_impegnati?: number
          costi_previsti?: number | null
          costi_residui_stimati?: number
          costi_sostenuti?: number
          costo_aggiornato?: number | null
          created_at?: string
          created_by?: string | null
          data_apertura?: string | null
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio?: string | null
          data_inizio_effettiva?: string | null
          data_inizio_prevista?: string | null
          denominazione?: string
          descrizione?: string | null
          extra_approvati?: number
          extra_non_approvati?: number
          id?: string
          importo?: number
          importo_contratto?: number | null
          indirizzo_cantiere?: string | null
          margine_aggiornato?: number | null
          margine_percentuale?: number | null
          margine_percentuale_aggiornato?: number | null
          margine_previsto?: number | null
          note?: string | null
          note_interne?: string | null
          organization_id?: string
          preventivo_id?: string | null
          priorita?: string | null
          responsabile_id?: string | null
          ricavi_acquisiti?: number | null
          ricavi_aggiornati?: number | null
          ricavi_previsti?: number | null
          scostamento_costi?: number | null
          scostamento_margine?: number | null
          scostamento_ricavi?: number | null
          stato?: Database["public"]["Enums"]["commessa_stato"]
          tipologia?: string | null
          titolo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commesse_baseline_preventivo_fk"
            columns: ["baseline_preventivo_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commesse_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commesse_cliente_org_fkey"
            columns: ["cliente_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commesse_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commesse_preventivo_id_fkey"
            columns: ["preventivo_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commesse_preventivo_org_fkey"
            columns: ["preventivo_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      crm_attivita: {
        Row: {
          archived_at: string | null
          assegnata_a: string | null
          cliente_id: string
          completata_at: string | null
          contatto_id: string | null
          created_at: string
          created_by: string
          data_attivita: string
          descrizione: string | null
          id: string
          organization_id: string
          priorita: Database["public"]["Enums"]["attivita_priorita"]
          scadenza: string | null
          stato: Database["public"]["Enums"]["attivita_stato"]
          tipo: Database["public"]["Enums"]["attivita_tipo"]
          titolo: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assegnata_a?: string | null
          cliente_id: string
          completata_at?: string | null
          contatto_id?: string | null
          created_at?: string
          created_by: string
          data_attivita?: string
          descrizione?: string | null
          id?: string
          organization_id: string
          priorita?: Database["public"]["Enums"]["attivita_priorita"]
          scadenza?: string | null
          stato?: Database["public"]["Enums"]["attivita_stato"]
          tipo?: Database["public"]["Enums"]["attivita_tipo"]
          titolo: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assegnata_a?: string | null
          cliente_id?: string
          completata_at?: string | null
          contatto_id?: string | null
          created_at?: string
          created_by?: string
          data_attivita?: string
          descrizione?: string | null
          id?: string
          organization_id?: string
          priorita?: Database["public"]["Enums"]["attivita_priorita"]
          scadenza?: string | null
          stato?: Database["public"]["Enums"]["attivita_stato"]
          tipo?: Database["public"]["Enums"]["attivita_tipo"]
          titolo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_attivita_assegnata_a_fkey"
            columns: ["assegnata_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_attivita_cliente_org_fkey"
            columns: ["cliente_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_attivita_contatto_org_fkey"
            columns: ["contatto_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatti"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_attivita_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_attivita_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documenti: {
        Row: {
          cantiere_id: string | null
          categoria: string | null
          cliente_id: string | null
          commessa_id: string | null
          created_at: string
          data_documento: string | null
          data_scadenza: string | null
          descrizione: string | null
          dipendente_id: string | null
          fornitore_id: string | null
          id: string
          mime_type: string | null
          nome: string
          organization_id: string
          preventivo_id: string | null
          size_bytes: number | null
          stato: Database["public"]["Enums"]["documento_stato"]
          storage_path: string | null
          tags: string[] | null
          updated_at: string
          uploaded_by: string | null
          visibilita: Database["public"]["Enums"]["documento_visibilita"]
        }
        Insert: {
          cantiere_id?: string | null
          categoria?: string | null
          cliente_id?: string | null
          commessa_id?: string | null
          created_at?: string
          data_documento?: string | null
          data_scadenza?: string | null
          descrizione?: string | null
          dipendente_id?: string | null
          fornitore_id?: string | null
          id?: string
          mime_type?: string | null
          nome: string
          organization_id: string
          preventivo_id?: string | null
          size_bytes?: number | null
          stato?: Database["public"]["Enums"]["documento_stato"]
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string
          uploaded_by?: string | null
          visibilita?: Database["public"]["Enums"]["documento_visibilita"]
        }
        Update: {
          cantiere_id?: string | null
          categoria?: string | null
          cliente_id?: string | null
          commessa_id?: string | null
          created_at?: string
          data_documento?: string | null
          data_scadenza?: string | null
          descrizione?: string | null
          dipendente_id?: string | null
          fornitore_id?: string | null
          id?: string
          mime_type?: string | null
          nome?: string
          organization_id?: string
          preventivo_id?: string | null
          size_bytes?: number | null
          stato?: Database["public"]["Enums"]["documento_stato"]
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string
          uploaded_by?: string | null
          visibilita?: Database["public"]["Enums"]["documento_visibilita"]
        }
        Relationships: [
          {
            foreignKeyName: "documenti_cantiere_fk"
            columns: ["cantiere_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cantieri"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "documenti_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documenti_cliente_org_fkey"
            columns: ["cliente_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "documenti_commessa_id_fkey"
            columns: ["commessa_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documenti_commessa_org_fkey"
            columns: ["commessa_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "documenti_fornitore_id_fkey"
            columns: ["fornitore_id"]
            isOneToOne: false
            referencedRelation: "fornitori"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documenti_fornitore_org_fkey"
            columns: ["fornitore_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "fornitori"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "documenti_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documenti_preventivo_id_fkey"
            columns: ["preventivo_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documenti_preventivo_org_fkey"
            columns: ["preventivo_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      fornitori: {
        Row: {
          cap: string | null
          categoria: string | null
          citta: string | null
          codice_fiscale: string | null
          created_at: string
          email: string | null
          id: string
          indirizzo: string | null
          note: string | null
          organization_id: string
          partita_iva: string | null
          pec: string | null
          provincia: string | null
          ragione_sociale: string
          referente: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          cap?: string | null
          categoria?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          created_at?: string
          email?: string | null
          id?: string
          indirizzo?: string | null
          note?: string | null
          organization_id: string
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale: string
          referente?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          cap?: string | null
          categoria?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          created_at?: string
          email?: string | null
          id?: string
          indirizzo?: string | null
          note?: string | null
          organization_id?: string
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale?: string
          referente?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fornitori_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by: string
          email: string
          expires_at: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          cap: string | null
          citta: string | null
          codice_fiscale: string | null
          created_at: string
          email: string | null
          id: string
          indirizzo: string | null
          nome: string
          nome_commerciale: string | null
          paese: string | null
          partita_iva: string | null
          pec: string | null
          provincia: string | null
          sito_web: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          cap?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          created_at?: string
          email?: string | null
          id?: string
          indirizzo?: string | null
          nome: string
          nome_commerciale?: string | null
          paese?: string | null
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          sito_web?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          cap?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          created_at?: string
          email?: string | null
          id?: string
          indirizzo?: string | null
          nome?: string
          nome_commerciale?: string | null
          paese?: string | null
          partita_iva?: string | null
          pec?: string | null
          provincia?: string | null
          sito_web?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      preventivi: {
        Row: {
          annullato_at: string | null
          cliente_id: string | null
          condizioni_generali: string | null
          condizioni_pagamento: string | null
          convertito_at: string | null
          created_at: string
          created_by: string | null
          data_accettazione: string | null
          data_invio: string | null
          data_preventivo: string
          data_rifiuto: string | null
          data_validita: string | null
          esclusioni: string | null
          firma_referente: string | null
          garanzie: string | null
          id: string
          is_current_version: boolean
          iva_default_pct: number
          maggiorazione_globale_pct: number
          margine: number
          motivo_nuova_versione: string | null
          motivo_rifiuto: string | null
          note: string | null
          numero: string
          oggetto: string
          organization_id: string
          parent_version_id: string | null
          responsabile_id: string | null
          root_preventivo_id: string | null
          sconto_globale_pct: number
          spese_accessorie: number
          stato: Database["public"]["Enums"]["preventivo_stato"]
          superseded_at: string | null
          superseded_by: string | null
          tempi_esecuzione: string | null
          tipo: Database["public"]["Enums"]["preventivo_tipo"] | null
          titolo: string | null
          totale: number
          totale_costo: number
          totale_iva: number
          totale_ricavo: number
          updated_at: string
          versione: number
        }
        Insert: {
          annullato_at?: string | null
          cliente_id?: string | null
          condizioni_generali?: string | null
          condizioni_pagamento?: string | null
          convertito_at?: string | null
          created_at?: string
          created_by?: string | null
          data_accettazione?: string | null
          data_invio?: string | null
          data_preventivo?: string
          data_rifiuto?: string | null
          data_validita?: string | null
          esclusioni?: string | null
          firma_referente?: string | null
          garanzie?: string | null
          id?: string
          is_current_version?: boolean
          iva_default_pct?: number
          maggiorazione_globale_pct?: number
          margine?: number
          motivo_nuova_versione?: string | null
          motivo_rifiuto?: string | null
          note?: string | null
          numero: string
          oggetto: string
          organization_id: string
          parent_version_id?: string | null
          responsabile_id?: string | null
          root_preventivo_id?: string | null
          sconto_globale_pct?: number
          spese_accessorie?: number
          stato?: Database["public"]["Enums"]["preventivo_stato"]
          superseded_at?: string | null
          superseded_by?: string | null
          tempi_esecuzione?: string | null
          tipo?: Database["public"]["Enums"]["preventivo_tipo"] | null
          titolo?: string | null
          totale?: number
          totale_costo?: number
          totale_iva?: number
          totale_ricavo?: number
          updated_at?: string
          versione?: number
        }
        Update: {
          annullato_at?: string | null
          cliente_id?: string | null
          condizioni_generali?: string | null
          condizioni_pagamento?: string | null
          convertito_at?: string | null
          created_at?: string
          created_by?: string | null
          data_accettazione?: string | null
          data_invio?: string | null
          data_preventivo?: string
          data_rifiuto?: string | null
          data_validita?: string | null
          esclusioni?: string | null
          firma_referente?: string | null
          garanzie?: string | null
          id?: string
          is_current_version?: boolean
          iva_default_pct?: number
          maggiorazione_globale_pct?: number
          margine?: number
          motivo_nuova_versione?: string | null
          motivo_rifiuto?: string | null
          note?: string | null
          numero?: string
          oggetto?: string
          organization_id?: string
          parent_version_id?: string | null
          responsabile_id?: string | null
          root_preventivo_id?: string | null
          sconto_globale_pct?: number
          spese_accessorie?: number
          stato?: Database["public"]["Enums"]["preventivo_stato"]
          superseded_at?: string | null
          superseded_by?: string | null
          tempi_esecuzione?: string | null
          tipo?: Database["public"]["Enums"]["preventivo_tipo"] | null
          titolo?: string | null
          totale?: number
          totale_costo?: number
          totale_iva?: number
          totale_ricavo?: number
          updated_at?: string
          versione?: number
        }
        Relationships: [
          {
            foreignKeyName: "preventivi_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventivi_cliente_org_fkey"
            columns: ["cliente_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "clienti"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "preventivi_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventivi_parent_org_fkey"
            columns: ["parent_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "preventivi_root_org_fkey"
            columns: ["root_preventivo_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "preventivi_superseded_by_org_fkey"
            columns: ["superseded_by", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      preventivo_categorie: {
        Row: {
          created_at: string
          descrizione: string | null
          id: string
          organization_id: string
          posizione: number
          preventivo_id: string
          subtotale_costo: number
          subtotale_ricavo: number
          titolo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          descrizione?: string | null
          id?: string
          organization_id: string
          posizione?: number
          preventivo_id: string
          subtotale_costo?: number
          subtotale_ricavo?: number
          titolo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          descrizione?: string | null
          id?: string
          organization_id?: string
          posizione?: number
          preventivo_id?: string
          subtotale_costo?: number
          subtotale_ricavo?: number
          titolo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preventivo_categorie_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventivo_categorie_prev_org_fkey"
            columns: ["preventivo_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      preventivo_storico_stati: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          metadata: Json
          note: string | null
          organization_id: string
          preventivo_id: string
          stato_nuovo: Database["public"]["Enums"]["preventivo_stato"]
          stato_precedente:
            | Database["public"]["Enums"]["preventivo_stato"]
            | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          organization_id: string
          preventivo_id: string
          stato_nuovo: Database["public"]["Enums"]["preventivo_stato"]
          stato_precedente?:
            | Database["public"]["Enums"]["preventivo_stato"]
            | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          organization_id?: string
          preventivo_id?: string
          stato_nuovo?: Database["public"]["Enums"]["preventivo_stato"]
          stato_precedente?:
            | Database["public"]["Enums"]["preventivo_stato"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "preventivo_storico_prev_org_fkey"
            columns: ["preventivo_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "preventivo_storico_stati_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      preventivo_templates: {
        Row: {
          attivo: boolean
          condizioni_generali: string | null
          condizioni_pagamento: string | null
          created_at: string
          descrizione: string | null
          esclusioni: string | null
          garanzie: string | null
          id: string
          iva_default_pct: number
          nome: string
          organization_id: string
          tempi_esecuzione: string | null
          updated_at: string
        }
        Insert: {
          attivo?: boolean
          condizioni_generali?: string | null
          condizioni_pagamento?: string | null
          created_at?: string
          descrizione?: string | null
          esclusioni?: string | null
          garanzie?: string | null
          id?: string
          iva_default_pct?: number
          nome: string
          organization_id: string
          tempi_esecuzione?: string | null
          updated_at?: string
        }
        Update: {
          attivo?: boolean
          condizioni_generali?: string | null
          condizioni_pagamento?: string | null
          created_at?: string
          descrizione?: string | null
          esclusioni?: string | null
          garanzie?: string | null
          id?: string
          iva_default_pct?: number
          nome?: string
          organization_id?: string
          tempi_esecuzione?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preventivo_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      preventivo_voci: {
        Row: {
          capitolo: string | null
          categoria: string | null
          categoria_id: string | null
          codice: string | null
          costo_totale: number
          costo_unitario: number
          created_at: string
          descrizione: string
          id: string
          importo_netto: number
          iva_pct: number
          maggiorazione_pct: number
          margine: number
          margine_pct: number
          note: string | null
          ordine: number
          organization_id: string
          preventivo_id: string
          prezzo_unitario: number
          quantita: number
          ricarico_pct: number
          sconto_pct: number
          totale: number
          unita_misura: string | null
          updated_at: string
        }
        Insert: {
          capitolo?: string | null
          categoria?: string | null
          categoria_id?: string | null
          codice?: string | null
          costo_totale?: number
          costo_unitario?: number
          created_at?: string
          descrizione: string
          id?: string
          importo_netto?: number
          iva_pct?: number
          maggiorazione_pct?: number
          margine?: number
          margine_pct?: number
          note?: string | null
          ordine?: number
          organization_id: string
          preventivo_id: string
          prezzo_unitario?: number
          quantita?: number
          ricarico_pct?: number
          sconto_pct?: number
          totale?: number
          unita_misura?: string | null
          updated_at?: string
        }
        Update: {
          capitolo?: string | null
          categoria?: string | null
          categoria_id?: string | null
          codice?: string | null
          costo_totale?: number
          costo_unitario?: number
          created_at?: string
          descrizione?: string
          id?: string
          importo_netto?: number
          iva_pct?: number
          maggiorazione_pct?: number
          margine?: number
          margine_pct?: number
          note?: string | null
          ordine?: number
          organization_id?: string
          preventivo_id?: string
          prezzo_unitario?: number
          quantita?: number
          ricarico_pct?: number
          sconto_pct?: number
          totale?: number
          unita_misura?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preventivo_voci_categoria_org_fkey"
            columns: ["categoria_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivo_categorie"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "preventivo_voci_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventivo_voci_preventivo_id_fkey"
            columns: ["preventivo_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventivo_voci_preventivo_org_fkey"
            columns: ["preventivo_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "preventivi"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      profiles: {
        Row: {
          cognome: string | null
          created_at: string
          disattivato_at: string | null
          disattivato_da: string | null
          email: string | null
          id: string
          is_active: boolean
          nome: string | null
          organization_id: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          cognome?: string | null
          created_at?: string
          disattivato_at?: string | null
          disattivato_da?: string | null
          email?: string | null
          id: string
          is_active?: boolean
          nome?: string | null
          organization_id?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          cognome?: string | null
          created_at?: string
          disattivato_at?: string | null
          disattivato_da?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          nome?: string | null
          organization_id?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rapportini: {
        Row: {
          cantiere_id: string | null
          commessa_id: string | null
          created_at: string
          data: string
          foto_urls: string[] | null
          id: string
          lavorazione: string | null
          note: string | null
          ora_fine: string | null
          ora_inizio: string | null
          ore: number
          organization_id: string
          user_id: string
        }
        Insert: {
          cantiere_id?: string | null
          commessa_id?: string | null
          created_at?: string
          data?: string
          foto_urls?: string[] | null
          id?: string
          lavorazione?: string | null
          note?: string | null
          ora_fine?: string | null
          ora_inizio?: string | null
          ore?: number
          organization_id: string
          user_id: string
        }
        Update: {
          cantiere_id?: string | null
          commessa_id?: string | null
          created_at?: string
          data?: string
          foto_urls?: string[] | null
          id?: string
          lavorazione?: string | null
          note?: string | null
          ora_fine?: string | null
          ora_inizio?: string | null
          ore?: number
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rapportini_cantiere_fk"
            columns: ["cantiere_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cantieri"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "rapportini_commessa_id_fkey"
            columns: ["commessa_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rapportini_commessa_org_fkey"
            columns: ["commessa_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "rapportini_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      commessa_fasi_ritardi: {
        Row: {
          commessa_id: string | null
          days_late: number | null
          fase_id: string | null
          is_late: boolean | null
          late_type: string | null
          organization_id: string | null
        }
        Insert: {
          commessa_id?: string | null
          days_late?: never
          fase_id?: string | null
          is_late?: never
          late_type?: never
          organization_id?: string | null
        }
        Update: {
          commessa_id?: string | null
          days_late?: never
          fase_id?: string | null
          is_late?: never
          late_type?: never
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commessa_fasi_commessa_fk"
            columns: ["commessa_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "commesse"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "commessa_fasi_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _assert_commessa_fase_editabile: {
        Args: { _commessa_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          avanzamento_calcolato_at: string | null
          avanzamento_modalita: string
          avanzamento_pct: number
          baseline_costi: number | null
          baseline_created_at: string | null
          baseline_created_by: string | null
          baseline_margine: number | null
          baseline_preventivo_id: string | null
          baseline_ricavi: number | null
          budget_calcolato_at: string | null
          budget_costi: number
          budget_modalita: string
          cliente_id: string | null
          closed_at: string | null
          closed_by: string | null
          codice: string
          costi_impegnati: number
          costi_previsti: number | null
          costi_residui_stimati: number
          costi_sostenuti: number
          costo_aggiornato: number | null
          created_at: string
          created_by: string | null
          data_apertura: string | null
          data_fine_effettiva: string | null
          data_fine_prevista: string | null
          data_inizio: string | null
          data_inizio_effettiva: string | null
          data_inizio_prevista: string | null
          denominazione: string
          descrizione: string | null
          extra_approvati: number
          extra_non_approvati: number
          id: string
          importo: number
          importo_contratto: number | null
          indirizzo_cantiere: string | null
          margine_aggiornato: number | null
          margine_percentuale: number | null
          margine_percentuale_aggiornato: number | null
          margine_previsto: number | null
          note: string | null
          note_interne: string | null
          organization_id: string
          preventivo_id: string | null
          priorita: string | null
          responsabile_id: string | null
          ricavi_acquisiti: number | null
          ricavi_aggiornati: number | null
          ricavi_previsti: number | null
          scostamento_costi: number | null
          scostamento_margine: number | null
          scostamento_ricavi: number | null
          stato: Database["public"]["Enums"]["commessa_stato"]
          tipologia: string | null
          titolo: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commesse"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _cbv_audit: {
        Args: { _action: string; _entity_id: string; _meta: Json; _org: string }
        Returns: undefined
      }
      _log_audit: {
        Args: {
          _action: string
          _entity: string
          _entity_id: string
          _meta: Json
          _org: string
        }
        Returns: undefined
      }
      admin_set_member_active: {
        Args: { _active: boolean; _actor: string; _org: string; _user: string }
        Returns: undefined
      }
      archive_commessa_budget_voce: {
        Args: {
          _expected_updated_at: string
          _motivazione?: string
          _voce_id: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          cantiere_id: string | null
          categoria: string
          codice: string | null
          commessa_id: string
          costo_residuo_stimato: number
          created_at: string
          created_by: string | null
          descrizione: string
          fase_id: string | null
          fonte: string
          fornitore_id: string | null
          id: string
          importo_impegnato: number
          importo_previsto: number
          importo_sostenuto: number
          is_locked: boolean
          note: string | null
          organization_id: string
          posizione: number
          preventivo_voce_id: string | null
          prezzo_unitario: number | null
          quantita: number | null
          sottocategoria: string | null
          tipo: string
          unita_misura: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commessa_budget_voci"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_commessa_fase: {
        Args: {
          _expected_updated_at: string
          _id: string
          _motivazione?: string
        }
        Returns: string
      }
      assign_commessa_codice: {
        Args: { _anno: number; _org: string }
        Returns: string
      }
      assign_preventivo_numero: {
        Args: { _anno: number; _org: string }
        Returns: string
      }
      can_access_cantiere: { Args: { _cantiere_id: string }; Returns: boolean }
      can_access_commessa: { Args: { _commessa_id: string }; Returns: boolean }
      can_manage_commessa_budget: {
        Args: { _commessa_id: string; _operation: string }
        Returns: boolean
      }
      change_commessa_stato: {
        Args: {
          _commessa_id: string
          _expected_updated_at: string
          _motivazione?: string
          _nuovo_stato: Database["public"]["Enums"]["commessa_stato"]
        }
        Returns: undefined
      }
      change_fase_stato: {
        Args: {
          _expected_updated_at: string
          _fase_id: string
          _motivazione?: string
          _nuovo_stato: string
        }
        Returns: string
      }
      change_preventivo_stato: {
        Args: {
          _motivo?: string
          _note?: string
          _nuovo_stato: Database["public"]["Enums"]["preventivo_stato"]
          _preventivo_id: string
        }
        Returns: undefined
      }
      convert_preventivo_to_commessa: {
        Args: {
          _data_fine_prevista?: string
          _data_inizio?: string
          _indirizzo_cantiere?: string
          _note?: string
          _preventivo_id: string
          _responsabile_id?: string
        }
        Returns: string
      }
      create_commessa_budget_voce: {
        Args: {
          _cantiere_id?: string
          _categoria: string
          _codice?: string
          _commessa_id: string
          _costo_residuo?: number
          _descrizione: string
          _expected_updated_at: string
          _fase_id?: string
          _fornitore_id?: string
          _importo_impegnato?: number
          _importo_previsto?: number
          _importo_sostenuto?: number
          _note?: string
          _prezzo_unitario?: number
          _quantita?: number
          _sottocategoria?: string
          _tipo: string
          _unita?: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          cantiere_id: string | null
          categoria: string
          codice: string | null
          commessa_id: string
          costo_residuo_stimato: number
          created_at: string
          created_by: string | null
          descrizione: string
          fase_id: string | null
          fonte: string
          fornitore_id: string | null
          id: string
          importo_impegnato: number
          importo_previsto: number
          importo_sostenuto: number
          is_locked: boolean
          note: string | null
          organization_id: string
          posizione: number
          preventivo_voce_id: string | null
          prezzo_unitario: number | null
          quantita: number | null
          sottocategoria: string | null
          tipo: string
          unita_misura: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commessa_budget_voci"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_commessa_fase: {
        Args: {
          _cantiere_id?: string
          _commessa_id: string
          _data_fine_prevista?: string
          _data_inizio_prevista?: string
          _descrizione?: string
          _note?: string
          _peso_percentuale?: number
          _responsabile_id?: string
          _titolo: string
        }
        Returns: {
          id: string
          updated_at: string
        }[]
      }
      create_preventivo_nuova_versione: {
        Args: { _motivo?: string; _preventivo_id: string }
        Returns: string
      }
      current_organization_id: { Args: never; Returns: string }
      distribuisci_pesi_equamente: {
        Args: { _commessa_id: string }
        Returns: number
      }
      has_any_role: {
        Args: {
          _org: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _org: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_budget_from_preventivo: {
        Args: {
          _commessa_id: string
          _expected_updated_at: string
          _strategy: string
        }
        Returns: Json
      }
      is_capocantiere_di: { Args: { _cantiere_id: string }; Returns: boolean }
      is_membro_cantiere: { Args: { _cantiere_id: string }; Returns: boolean }
      is_membro_commessa: { Args: { _commessa_id: string }; Returns: boolean }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      is_valid_responsabile: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      is_valid_responsabile_fase: {
        Args: {
          _cantiere_id: string
          _commessa_id: string
          _org: string
          _user: string
        }
        Returns: boolean
      }
      mark_expired_invites: { Args: never; Returns: undefined }
      recalculate_commessa_avanzamento: {
        Args: { _commessa_id: string }
        Returns: number
      }
      recalculate_commessa_budget: {
        Args: { _commessa_id: string }
        Returns: undefined
      }
      reorder_commessa_budget_voci: {
        Args: {
          _commessa_id: string
          _expected_updated_at: string
          _ordered_ids: string[]
        }
        Returns: undefined
      }
      reorder_commessa_fasi: {
        Args: { _commessa_id: string; _ordered_ids: string[] }
        Returns: undefined
      }
      restore_commessa_budget_voce: {
        Args: { _expected_updated_at: string; _voce_id: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          cantiere_id: string | null
          categoria: string
          codice: string | null
          commessa_id: string
          costo_residuo_stimato: number
          created_at: string
          created_by: string | null
          descrizione: string
          fase_id: string | null
          fonte: string
          fornitore_id: string | null
          id: string
          importo_impegnato: number
          importo_previsto: number
          importo_sostenuto: number
          is_locked: boolean
          note: string | null
          organization_id: string
          posizione: number
          preventivo_voce_id: string | null
          prezzo_unitario: number | null
          quantita: number | null
          sottocategoria: string | null
          tipo: string
          unita_misura: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commessa_budget_voci"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_commessa_fase: {
        Args: { _expected_updated_at: string; _id: string }
        Returns: string
      }
      set_commessa_baseline: {
        Args: {
          _commessa_id: string
          _expected_updated_at: string
          _motivazione?: string
          _replace?: boolean
        }
        Returns: string
      }
      set_commessa_budget_mode: {
        Args: {
          _commessa_id: string
          _confirm_empty?: boolean
          _expected_updated_at: string
          _mode: string
          _motivazione?: string
        }
        Returns: string
      }
      set_commessa_progress_mode: {
        Args: {
          _commessa_id: string
          _conferma_peso_zero?: boolean
          _expected_updated_at: string
          _modalita: string
          _motivazione?: string
        }
        Returns: string
      }
      update_commessa_budget_voce: {
        Args: {
          _cantiere_id?: string
          _categoria: string
          _codice?: string
          _costo_residuo?: number
          _descrizione: string
          _expected_updated_at: string
          _fase_id?: string
          _fornitore_id?: string
          _importo_impegnato?: number
          _importo_previsto?: number
          _importo_sostenuto?: number
          _note?: string
          _prezzo_unitario?: number
          _quantita?: number
          _sottocategoria?: string
          _unita?: string
          _voce_id: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          cantiere_id: string | null
          categoria: string
          codice: string | null
          commessa_id: string
          costo_residuo_stimato: number
          created_at: string
          created_by: string | null
          descrizione: string
          fase_id: string | null
          fonte: string
          fornitore_id: string | null
          id: string
          importo_impegnato: number
          importo_previsto: number
          importo_sostenuto: number
          is_locked: boolean
          note: string | null
          organization_id: string
          posizione: number
          preventivo_voce_id: string | null
          prezzo_unitario: number | null
          quantita: number | null
          sottocategoria: string | null
          tipo: string
          unita_misura: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "commessa_budget_voci"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_commessa_fase: {
        Args: {
          _cantiere_id?: string
          _clear_cantiere?: boolean
          _clear_data_fine_prevista?: boolean
          _clear_data_inizio_prevista?: boolean
          _clear_note?: boolean
          _clear_responsabile?: boolean
          _data_fine_prevista?: string
          _data_inizio_prevista?: string
          _descrizione?: string
          _expected_updated_at: string
          _id: string
          _note?: string
          _peso_percentuale?: number
          _responsabile_id?: string
          _titolo?: string
        }
        Returns: string
      }
      update_fase_avanzamento: {
        Args: {
          _expected_updated_at: string
          _fase_id: string
          _motivazione?: string
          _nuovo_avanzamento: number
        }
        Returns: string
      }
      update_manual_commessa_budget: {
        Args: {
          _commessa_id: string
          _costi_impegnati: number
          _costi_previsti: number
          _costi_residui_stimati: number
          _costi_sostenuti: number
          _expected_updated_at: string
          _extra_approvati: number
          _extra_non_approvati: number
          _motivazione?: string
          _ricavi_acquisiti: number
          _ricavi_previsti: number
        }
        Returns: string
      }
      update_manual_commessa_progress: {
        Args: {
          _commessa_id: string
          _expected_updated_at: string
          _motivazione?: string
          _nuovo_avanzamento: number
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "proprietario"
        | "amministratore"
        | "ufficio_tecnico"
        | "amministrazione"
        | "responsabile_commessa"
        | "capocantiere"
        | "operaio"
        | "cliente"
        | "fornitore"
      attivita_priorita: "bassa" | "normale" | "alta" | "urgente"
      attivita_stato: "pianificata" | "completata" | "annullata"
      attivita_tipo:
        | "telefonata"
        | "email"
        | "incontro"
        | "sopralluogo"
        | "nota"
        | "promemoria"
        | "altro"
      cliente_stato: "potenziale" | "attivo" | "inattivo" | "archiviato"
      cliente_tipo:
        | "persona_fisica"
        | "azienda"
        | "condominio"
        | "ente"
        | "altro"
      commessa_stato:
        | "bozza"
        | "pianificata"
        | "in_corso"
        | "sospesa"
        | "completata"
        | "annullata"
      documento_stato: "valido" | "in_scadenza" | "scaduto" | "archiviato"
      documento_visibilita: "privato" | "organizzazione" | "pubblico"
      invite_status: "pending" | "accepted" | "revoked" | "expired"
      preventivo_stato:
        | "bozza"
        | "inviato"
        | "accettato"
        | "rifiutato"
        | "scaduto"
        | "in_revisione"
        | "pronto"
        | "annullato"
        | "convertito"
      preventivo_tipo:
        | "lavori_edili"
        | "ristrutturazione"
        | "manutenzione"
        | "fornitura_posa"
        | "consulenza"
        | "altro"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "proprietario",
        "amministratore",
        "ufficio_tecnico",
        "amministrazione",
        "responsabile_commessa",
        "capocantiere",
        "operaio",
        "cliente",
        "fornitore",
      ],
      attivita_priorita: ["bassa", "normale", "alta", "urgente"],
      attivita_stato: ["pianificata", "completata", "annullata"],
      attivita_tipo: [
        "telefonata",
        "email",
        "incontro",
        "sopralluogo",
        "nota",
        "promemoria",
        "altro",
      ],
      cliente_stato: ["potenziale", "attivo", "inattivo", "archiviato"],
      cliente_tipo: [
        "persona_fisica",
        "azienda",
        "condominio",
        "ente",
        "altro",
      ],
      commessa_stato: [
        "bozza",
        "pianificata",
        "in_corso",
        "sospesa",
        "completata",
        "annullata",
      ],
      documento_stato: ["valido", "in_scadenza", "scaduto", "archiviato"],
      documento_visibilita: ["privato", "organizzazione", "pubblico"],
      invite_status: ["pending", "accepted", "revoked", "expired"],
      preventivo_stato: [
        "bozza",
        "inviato",
        "accettato",
        "rifiutato",
        "scaduto",
        "in_revisione",
        "pronto",
        "annullato",
        "convertito",
      ],
      preventivo_tipo: [
        "lavori_edili",
        "ristrutturazione",
        "manutenzione",
        "fornitura_posa",
        "consulenza",
        "altro",
      ],
    },
  },
} as const
