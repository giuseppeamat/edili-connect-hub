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
      clienti: {
        Row: {
          cap: string | null
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
            foreignKeyName: "clienti_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commesse: {
        Row: {
          avanzamento_pct: number
          budget_costi: number
          cliente_id: string | null
          codice: string
          costi_sostenuti: number
          created_at: string
          data_fine_effettiva: string | null
          data_fine_prevista: string | null
          data_inizio: string | null
          denominazione: string
          id: string
          importo: number
          indirizzo_cantiere: string | null
          note: string | null
          organization_id: string
          preventivo_id: string | null
          responsabile_id: string | null
          stato: Database["public"]["Enums"]["commessa_stato"]
          updated_at: string
        }
        Insert: {
          avanzamento_pct?: number
          budget_costi?: number
          cliente_id?: string | null
          codice: string
          costi_sostenuti?: number
          created_at?: string
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio?: string | null
          denominazione: string
          id?: string
          importo?: number
          indirizzo_cantiere?: string | null
          note?: string | null
          organization_id: string
          preventivo_id?: string | null
          responsabile_id?: string | null
          stato?: Database["public"]["Enums"]["commessa_stato"]
          updated_at?: string
        }
        Update: {
          avanzamento_pct?: number
          budget_costi?: number
          cliente_id?: string | null
          codice?: string
          costi_sostenuti?: number
          created_at?: string
          data_fine_effettiva?: string | null
          data_fine_prevista?: string | null
          data_inizio?: string | null
          denominazione?: string
          id?: string
          importo?: number
          indirizzo_cantiere?: string | null
          note?: string | null
          organization_id?: string
          preventivo_id?: string | null
          responsabile_id?: string | null
          stato?: Database["public"]["Enums"]["commessa_stato"]
          updated_at?: string
        }
        Relationships: [
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
      documenti: {
        Row: {
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
          size_bytes: number | null
          stato: Database["public"]["Enums"]["documento_stato"]
          storage_path: string | null
          tags: string[] | null
          updated_at: string
          uploaded_by: string | null
          visibilita: Database["public"]["Enums"]["documento_visibilita"]
        }
        Insert: {
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
          size_bytes?: number | null
          stato?: Database["public"]["Enums"]["documento_stato"]
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string
          uploaded_by?: string | null
          visibilita?: Database["public"]["Enums"]["documento_visibilita"]
        }
        Update: {
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
          partita_iva: string | null
          provincia: string | null
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
          partita_iva?: string | null
          provincia?: string | null
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
          partita_iva?: string | null
          provincia?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      preventivi: {
        Row: {
          cliente_id: string | null
          created_at: string
          data_preventivo: string
          data_validita: string | null
          id: string
          margine: number
          note: string | null
          numero: string
          oggetto: string
          organization_id: string
          stato: Database["public"]["Enums"]["preventivo_stato"]
          totale: number
          totale_costo: number
          totale_iva: number
          totale_ricavo: number
          updated_at: string
          versione: number
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          data_preventivo?: string
          data_validita?: string | null
          id?: string
          margine?: number
          note?: string | null
          numero: string
          oggetto: string
          organization_id: string
          stato?: Database["public"]["Enums"]["preventivo_stato"]
          totale?: number
          totale_costo?: number
          totale_iva?: number
          totale_ricavo?: number
          updated_at?: string
          versione?: number
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          data_preventivo?: string
          data_validita?: string | null
          id?: string
          margine?: number
          note?: string | null
          numero?: string
          oggetto?: string
          organization_id?: string
          stato?: Database["public"]["Enums"]["preventivo_stato"]
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
        ]
      }
      preventivo_voci: {
        Row: {
          capitolo: string | null
          categoria: string | null
          costo_unitario: number
          created_at: string
          descrizione: string
          id: string
          iva_pct: number
          ordine: number
          organization_id: string
          preventivo_id: string
          prezzo_unitario: number
          quantita: number
          ricarico_pct: number
          sconto_pct: number
          totale: number
          unita_misura: string | null
        }
        Insert: {
          capitolo?: string | null
          categoria?: string | null
          costo_unitario?: number
          created_at?: string
          descrizione: string
          id?: string
          iva_pct?: number
          ordine?: number
          organization_id: string
          preventivo_id: string
          prezzo_unitario?: number
          quantita?: number
          ricarico_pct?: number
          sconto_pct?: number
          totale?: number
          unita_misura?: string | null
        }
        Update: {
          capitolo?: string | null
          categoria?: string | null
          costo_unitario?: number
          created_at?: string
          descrizione?: string
          id?: string
          iva_pct?: number
          ordine?: number
          organization_id?: string
          preventivo_id?: string
          prezzo_unitario?: number
          quantita?: number
          ricarico_pct?: number
          sconto_pct?: number
          totale?: number
          unita_misura?: string | null
        }
        Relationships: [
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
          email: string | null
          id: string
          nome: string | null
          organization_id: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          cognome?: string | null
          created_at?: string
          email?: string | null
          id: string
          nome?: string | null
          organization_id?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          cognome?: string | null
          created_at?: string
          email?: string | null
          id?: string
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
      [_ in never]: never
    }
    Functions: {
      current_organization_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _org: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
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
      commessa_stato:
        | "pianificata"
        | "in_corso"
        | "sospesa"
        | "completata"
        | "annullata"
      documento_stato: "valido" | "in_scadenza" | "scaduto" | "archiviato"
      documento_visibilita: "privato" | "organizzazione" | "pubblico"
      preventivo_stato:
        | "bozza"
        | "inviato"
        | "accettato"
        | "rifiutato"
        | "scaduto"
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
      commessa_stato: [
        "pianificata",
        "in_corso",
        "sospesa",
        "completata",
        "annullata",
      ],
      documento_stato: ["valido", "in_scadenza", "scaduto", "archiviato"],
      documento_visibilita: ["privato", "organizzazione", "pubblico"],
      preventivo_stato: [
        "bozza",
        "inviato",
        "accettato",
        "rifiutato",
        "scaduto",
      ],
    },
  },
} as const
