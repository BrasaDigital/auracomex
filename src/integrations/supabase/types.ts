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
      access_logs: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          id: string
          ip: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      accountability: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          diferenca_brl: number | null
          estimate_id: string
          id: string
          quote_id: string
          status: string
          total_orcado_brl: number | null
          total_pago_brl: number | null
          updated_at: string
          usd_brl: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          diferenca_brl?: number | null
          estimate_id: string
          id?: string
          quote_id: string
          status?: string
          total_orcado_brl?: number | null
          total_pago_brl?: number | null
          updated_at?: string
          usd_brl?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          diferenca_brl?: number | null
          estimate_id?: string
          id?: string
          quote_id?: string
          status?: string
          total_orcado_brl?: number | null
          total_pago_brl?: number | null
          updated_at?: string
          usd_brl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accountability_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "cost_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      accountability_items: {
        Row: {
          accountability_id: string
          categoria: string
          company_id: string
          comprovante_document_id: string | null
          comprovante_name: string | null
          comprovante_url: string | null
          confirmado: boolean
          created_at: string
          descricao: string
          id: string
          observacao: string | null
          ordem: number
          source_expense_id: string | null
          updated_at: string
          valor_orcado_brl: number
          valor_pago_brl: number | null
        }
        Insert: {
          accountability_id: string
          categoria?: string
          company_id: string
          comprovante_document_id?: string | null
          comprovante_name?: string | null
          comprovante_url?: string | null
          confirmado?: boolean
          created_at?: string
          descricao: string
          id?: string
          observacao?: string | null
          ordem?: number
          source_expense_id?: string | null
          updated_at?: string
          valor_orcado_brl?: number
          valor_pago_brl?: number | null
        }
        Update: {
          accountability_id?: string
          categoria?: string
          company_id?: string
          comprovante_document_id?: string | null
          comprovante_name?: string | null
          comprovante_url?: string | null
          confirmado?: boolean
          created_at?: string
          descricao?: string
          id?: string
          observacao?: string | null
          ordem?: number
          source_expense_id?: string | null
          updated_at?: string
          valor_orcado_brl?: number
          valor_pago_brl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accountability_items_accountability_id_fkey"
            columns: ["accountability_id"]
            isOneToOne: false
            referencedRelation: "accountability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountability_items_comprovante_document_id_fkey"
            columns: ["comprovante_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountability_items_source_expense_id_fkey"
            columns: ["source_expense_id"]
            isOneToOne: false
            referencedRelation: "cost_estimate_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts_payable: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          debit_note_id: string | null
          description: string
          due_date: string
          id: string
          notes: string | null
          paid_at: string | null
          partner_id: string | null
          payment_method: string | null
          quote_id: string | null
          receipt_url: string | null
          shipment_id: string | null
          source: Database["public"]["Enums"]["accounts_payable_source"]
          status: Database["public"]["Enums"]["accounts_payable_status"]
          updated_at: string
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          debit_note_id?: string | null
          description: string
          due_date: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          partner_id?: string | null
          payment_method?: string | null
          quote_id?: string | null
          receipt_url?: string | null
          shipment_id?: string | null
          source?: Database["public"]["Enums"]["accounts_payable_source"]
          status?: Database["public"]["Enums"]["accounts_payable_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          debit_note_id?: string | null
          description?: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          partner_id?: string | null
          payment_method?: string | null
          quote_id?: string | null
          receipt_url?: string | null
          shipment_id?: string | null
          source?: Database["public"]["Enums"]["accounts_payable_source"]
          status?: Database["public"]["Enums"]["accounts_payable_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_debit_note_id_fkey"
            columns: ["debit_note_id"]
            isOneToOne: false
            referencedRelation: "debit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts_receivable: {
        Row: {
          amount: number
          bank_account_id: string | null
          client_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          debit_note_id: string | null
          description: string
          due_date: string | null
          id: string
          notes: string | null
          quote_id: string | null
          receipt_reference: string | null
          receipt_url: string | null
          received_amount: number | null
          received_at: string | null
          shipment_id: string | null
          source: Database["public"]["Enums"]["accounts_receivable_source"]
          status: Database["public"]["Enums"]["accounts_receivable_status"]
          updated_at: string
        }
        Insert: {
          amount?: number
          bank_account_id?: string | null
          client_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          debit_note_id?: string | null
          description: string
          due_date?: string | null
          id?: string
          notes?: string | null
          quote_id?: string | null
          receipt_reference?: string | null
          receipt_url?: string | null
          received_amount?: number | null
          received_at?: string | null
          shipment_id?: string | null
          source?: Database["public"]["Enums"]["accounts_receivable_source"]
          status?: Database["public"]["Enums"]["accounts_receivable_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          client_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          debit_note_id?: string | null
          description?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          quote_id?: string | null
          receipt_reference?: string | null
          receipt_url?: string | null
          received_amount?: number | null
          received_at?: string | null
          shipment_id?: string | null
          source?: Database["public"]["Enums"]["accounts_receivable_source"]
          status?: Database["public"]["Enums"]["accounts_receivable_status"]
          updated_at?: string
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          action: string
          company_id: string
          created_at: string
          details: string | null
          id: string
          shipment_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          details?: string | null
          id?: string
          shipment_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          details?: string | null
          id?: string
          shipment_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      app_build_version: {
        Row: {
          id: number
          updated_at: string
          version: string
        }
        Insert: {
          id?: number
          updated_at?: string
          version: string
        }
        Update: {
          id?: number
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      app_releases: {
        Row: {
          created_at: string
          created_by: string | null
          highlights: Json
          id: string
          is_major: boolean
          published_at: string
          summary: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          highlights?: Json
          id?: string
          is_major?: boolean
          published_at?: string
          summary?: string | null
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          highlights?: Json
          id?: string
          is_major?: boolean
          published_at?: string
          summary?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      charge_catalog: {
        Row: {
          charge_type: string
          company_id: string
          created_at: string
          id: string
          legs: string[]
          name: string
        }
        Insert: {
          charge_type?: string
          company_id: string
          created_at?: string
          id?: string
          legs?: string[]
          name: string
        }
        Update: {
          charge_type?: string
          company_id?: string
          created_at?: string
          id?: string
          legs?: string[]
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "charge_catalog_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_lines: {
        Row: {
          amount: number
          buy_actual_confirmed_at: string | null
          buy_actual_confirmed_by: string | null
          buy_amount_actual: number | null
          buy_variance_note: string | null
          buy_variance_reason: string | null
          charge_type: Database["public"]["Enums"]["charge_type"]
          company_id: string
          created_at: string
          currency: string
          description: string
          direction: Database["public"]["Enums"]["charge_direction"]
          exchange_rate: number
          id: string
          invoice_number: string | null
          invoice_status: Database["public"]["Enums"]["invoice_status_type"]
          partner_id: string | null
          shipment_id: string
          supplier_amount: number | null
          tax_rate: number
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount?: number
          buy_actual_confirmed_at?: string | null
          buy_actual_confirmed_by?: string | null
          buy_amount_actual?: number | null
          buy_variance_note?: string | null
          buy_variance_reason?: string | null
          charge_type?: Database["public"]["Enums"]["charge_type"]
          company_id: string
          created_at?: string
          currency?: string
          description: string
          direction: Database["public"]["Enums"]["charge_direction"]
          exchange_rate?: number
          id?: string
          invoice_number?: string | null
          invoice_status?: Database["public"]["Enums"]["invoice_status_type"]
          partner_id?: string | null
          shipment_id: string
          supplier_amount?: number | null
          tax_rate?: number
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          buy_actual_confirmed_at?: string | null
          buy_actual_confirmed_by?: string | null
          buy_amount_actual?: number | null
          buy_variance_note?: string | null
          buy_variance_reason?: string | null
          charge_type?: Database["public"]["Enums"]["charge_type"]
          company_id?: string
          created_at?: string
          currency?: string
          description?: string
          direction?: Database["public"]["Enums"]["charge_direction"]
          exchange_rate?: number
          id?: string
          invoice_number?: string | null
          invoice_status?: Database["public"]["Enums"]["invoice_status_type"]
          partner_id?: string | null
          shipment_id?: string
          supplier_amount?: number | null
          tax_rate?: number
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charge_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_lines_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_lines_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      charges: {
        Row: {
          buy_amount: number
          buy_currency: string
          charge_type: Database["public"]["Enums"]["charge_type"]
          company_id: string
          created_at: string
          description: string
          exchange_rate: number | null
          id: string
          sell_amount: number
          sell_currency: string
          shipment_id: string
          tax_rate: number | null
        }
        Insert: {
          buy_amount?: number
          buy_currency?: string
          charge_type?: Database["public"]["Enums"]["charge_type"]
          company_id: string
          created_at?: string
          description: string
          exchange_rate?: number | null
          id?: string
          sell_amount?: number
          sell_currency?: string
          shipment_id: string
          tax_rate?: number | null
        }
        Update: {
          buy_amount?: number
          buy_currency?: string
          charge_type?: Database["public"]["Enums"]["charge_type"]
          company_id?: string
          created_at?: string
          description?: string
          exchange_rate?: number | null
          id?: string
          sell_amount?: number
          sell_currency?: string
          shipment_id?: string
          tax_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          commission_rate: number | null
          company_id: string
          contact_person: string | null
          created_at: string
          email: string | null
          exchange_spread_pct: number | null
          id: string
          inactivated_at: string | null
          inactivated_by: string | null
          is_active: boolean
          insurance_rate_pct: number | null
          is_foreign: boolean | null
          name: string
          partner_category: string | null
          phone: string | null
          salesperson_id: string | null
          storage_fixed_value: number | null
          storage_rebate_percent: number | null
          tax_id: string | null
          tax_id_type: string | null
          tracking_field_visibility: Json
          type: Database["public"]["Enums"]["client_type"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          commission_rate?: number | null
          company_id: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          exchange_spread_pct?: number | null
          id?: string
          inactivated_at?: string | null
          inactivated_by?: string | null
          is_active?: boolean
          insurance_rate_pct?: number | null
          is_foreign?: boolean | null
          name: string
          partner_category?: string | null
          phone?: string | null
          salesperson_id?: string | null
          storage_fixed_value?: number | null
          storage_rebate_percent?: number | null
          tax_id?: string | null
          tax_id_type?: string | null
          tracking_field_visibility?: Json
          type?: Database["public"]["Enums"]["client_type"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          commission_rate?: number | null
          company_id?: string
          contact_person?: string | null
          created_at?: string
          email?: string | null
          exchange_spread_pct?: number | null
          id?: string
          inactivated_at?: string | null
          inactivated_by?: string | null
          is_active?: boolean
          insurance_rate_pct?: number | null
          is_foreign?: boolean | null
          name?: string
          partner_category?: string | null
          phone?: string | null
          salesperson_id?: string | null
          storage_fixed_value?: number | null
          storage_rebate_percent?: number | null
          tax_id?: string | null
          tax_id_type?: string | null
          tracking_field_visibility?: Json
          type?: Database["public"]["Enums"]["client_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      coleta_carretas: {
        Row: {
          active: boolean
          client_id: string
          company_id: string
          created_at: string
          id: string
          placa: string
          tipo: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id: string
          company_id: string
          created_at?: string
          id?: string
          placa: string
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string
          company_id?: string
          created_at?: string
          id?: string
          placa?: string
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coleta_carretas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_carretas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      coleta_cavalos: {
        Row: {
          active: boolean
          client_id: string
          company_id: string
          cor: string | null
          created_at: string
          id: string
          modelo: string | null
          placa: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id: string
          company_id: string
          cor?: string | null
          created_at?: string
          id?: string
          modelo?: string | null
          placa: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string
          company_id?: string
          cor?: string | null
          created_at?: string
          id?: string
          modelo?: string | null
          placa?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coleta_cavalos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_cavalos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      coleta_motoristas: {
        Row: {
          active: boolean
          client_id: string
          cnh: string | null
          cnh_emissao: string | null
          company_id: string
          cpf: string | null
          created_at: string
          id: string
          nextel: string | null
          nome: string
          orgao_emissor: string | null
          rg: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id: string
          cnh?: string | null
          cnh_emissao?: string | null
          company_id: string
          cpf?: string | null
          created_at?: string
          id?: string
          nextel?: string | null
          nome: string
          orgao_emissor?: string | null
          rg?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string
          cnh?: string | null
          cnh_emissao?: string | null
          company_id?: string
          cpf?: string | null
          created_at?: string
          id?: string
          nextel?: string | null
          nome?: string
          orgao_emissor?: string | null
          rg?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coleta_motoristas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_motoristas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      coleta_ordem_notas_fiscais: {
        Row: {
          created_at: string
          emissao: string | null
          id: string
          lote: string | null
          numero: string
          ordem_coleta_id: string
          serie: string | null
        }
        Insert: {
          created_at?: string
          emissao?: string | null
          id?: string
          lote?: string | null
          numero: string
          ordem_coleta_id: string
          serie?: string | null
        }
        Update: {
          created_at?: string
          emissao?: string | null
          id?: string
          lote?: string | null
          numero?: string
          ordem_coleta_id?: string
          serie?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coleta_ordem_notas_fiscais_ordem_coleta_id_fkey"
            columns: ["ordem_coleta_id"]
            isOneToOne: false
            referencedRelation: "coleta_ordens_coleta"
            referencedColumns: ["id"]
          },
        ]
      }
      coleta_ordens_coleta: {
        Row: {
          carreta_id: string | null
          cavalo_id: string | null
          company_id: string
          container_number: string | null
          created_at: string
          created_by: string | null
          data_agendada: string | null
          document_id: string | null
          id: string
          lacre_adicional: string | null
          lacre_encontrado: string | null
          lacre_ipa: string | null
          motorista_id: string | null
          numero_documento: string | null
          patio: string | null
          peso_bruto_apurado: number | null
          peso_liquido_apurado: number | null
          shipment_id: string
          status: string
          terminal: string | null
          termo_avaria: string | null
          updated_at: string
        }
        Insert: {
          carreta_id?: string | null
          cavalo_id?: string | null
          company_id: string
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          data_agendada?: string | null
          document_id?: string | null
          id?: string
          lacre_adicional?: string | null
          lacre_encontrado?: string | null
          lacre_ipa?: string | null
          motorista_id?: string | null
          numero_documento?: string | null
          patio?: string | null
          peso_bruto_apurado?: number | null
          peso_liquido_apurado?: number | null
          shipment_id: string
          status?: string
          terminal?: string | null
          termo_avaria?: string | null
          updated_at?: string
        }
        Update: {
          carreta_id?: string | null
          cavalo_id?: string | null
          company_id?: string
          container_number?: string | null
          created_at?: string
          created_by?: string | null
          data_agendada?: string | null
          document_id?: string | null
          id?: string
          lacre_adicional?: string | null
          lacre_encontrado?: string | null
          lacre_ipa?: string | null
          motorista_id?: string | null
          numero_documento?: string | null
          patio?: string | null
          peso_bruto_apurado?: number | null
          peso_liquido_apurado?: number | null
          shipment_id?: string
          status?: string
          terminal?: string | null
          termo_avaria?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coleta_ordens_coleta_carreta_id_fkey"
            columns: ["carreta_id"]
            isOneToOne: false
            referencedRelation: "coleta_carretas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_ordens_coleta_cavalo_id_fkey"
            columns: ["cavalo_id"]
            isOneToOne: false
            referencedRelation: "coleta_cavalos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_ordens_coleta_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_ordens_coleta_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_ordens_coleta_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "coleta_motoristas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coleta_ordens_coleta_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          access_expires_at: string | null
          address: string | null
          brand_primary_color: string | null
          brand_secondary_color: string | null
          cnpj: string | null
          created_at: string
          document_alert_email: string | null
          email: string | null
          estimate_enabled: boolean
          id: string
          is_foreign: boolean | null
          logo_url: string | null
          name: string
          phone: string | null
          quick_notes: string | null
          quote_include_mode: boolean
          quote_number_width: number
          quote_prefix: string
          quote_start_number: number
          seguro_taxa_pct_default: number
          updated_at: string
        }
        Insert: {
          access_expires_at?: string | null
          address?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          cnpj?: string | null
          created_at?: string
          document_alert_email?: string | null
          email?: string | null
          estimate_enabled?: boolean
          id?: string
          is_foreign?: boolean | null
          logo_url?: string | null
          name: string
          phone?: string | null
          quick_notes?: string | null
          quote_include_mode?: boolean
          quote_number_width?: number
          quote_prefix?: string
          quote_start_number?: number
          seguro_taxa_pct_default?: number
          updated_at?: string
        }
        Update: {
          access_expires_at?: string | null
          address?: string | null
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          cnpj?: string | null
          created_at?: string
          document_alert_email?: string | null
          email?: string | null
          estimate_enabled?: boolean
          id?: string
          is_foreign?: boolean | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          quick_notes?: string | null
          quote_include_mode?: boolean
          quote_number_width?: number
          quote_prefix?: string
          quote_start_number?: number
          seguro_taxa_pct_default?: number
          updated_at?: string
        }
        Relationships: []
      }
      company_addons: {
        Row: {
          activated_at: string
          active: boolean
          addon_key: Database["public"]["Enums"]["addon_key"]
          company_id: string
          created_at: string
          deactivated_at: string | null
          environment: string
          id: string
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string
          active?: boolean
          addon_key: Database["public"]["Enums"]["addon_key"]
          company_id: string
          created_at?: string
          deactivated_at?: string | null
          environment?: string
          id?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string
          active?: boolean
          addon_key?: Database["public"]["Enums"]["addon_key"]
          company_id?: string
          created_at?: string
          deactivated_at?: string | null
          environment?: string
          id?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_addons_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_bank_accounts: {
        Row: {
          account_holder: string
          account_number: string | null
          active: boolean
          bank_name: string
          branch: string | null
          company_id: string
          created_at: string
          currency: string
          iban: string | null
          id: string
          is_default: boolean
          pix_key: string | null
          swift: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          account_holder: string
          account_number?: string | null
          active?: boolean
          bank_name: string
          branch?: string | null
          company_id: string
          created_at?: string
          currency?: string
          iban?: string | null
          id?: string
          is_default?: boolean
          pix_key?: string | null
          swift?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          account_holder?: string
          account_number?: string | null
          active?: boolean
          bank_name?: string
          branch?: string | null
          company_id?: string
          created_at?: string
          currency?: string
          iban?: string | null
          id?: string
          is_default?: boolean
          pix_key?: string | null
          swift?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_portalunico_configs: {
        Row: {
          certificate_password: string | null
          certificate_path: string | null
          certificate_pem_path: string | null
          client_id: string
          client_secret: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_test_success: boolean | null
          last_tested_at: string | null
          role_type: string
          updated_at: string
          webhook_active: boolean
          webhook_auth_key: string | null
          webhook_last_event_at: string | null
          webhook_secret: string | null
          webhook_subscription_ids: Json | null
        }
        Insert: {
          certificate_password?: string | null
          certificate_path?: string | null
          certificate_pem_path?: string | null
          client_id: string
          client_secret: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_test_success?: boolean | null
          last_tested_at?: string | null
          role_type?: string
          updated_at?: string
          webhook_active?: boolean
          webhook_auth_key?: string | null
          webhook_last_event_at?: string | null
          webhook_secret?: string | null
          webhook_subscription_ids?: Json | null
        }
        Update: {
          certificate_password?: string | null
          certificate_path?: string | null
          certificate_pem_path?: string | null
          client_id?: string
          client_secret?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_test_success?: boolean | null
          last_tested_at?: string | null
          role_type?: string
          updated_at?: string
          webhook_active?: boolean
          webhook_auth_key?: string | null
          webhook_last_event_at?: string | null
          webhook_secret?: string | null
          webhook_subscription_ids?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "company_portalunico_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_siscomex_configs: {
        Row: {
          certificate_password: string | null
          certificate_path: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean | null
          serpro_consumer_key: string | null
          serpro_consumer_secret: string | null
          updated_at: string
        }
        Insert: {
          certificate_password?: string | null
          certificate_path?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          serpro_consumer_key?: string | null
          serpro_consumer_secret?: string | null
          updated_at?: string
        }
        Update: {
          certificate_password?: string | null
          certificate_path?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          serpro_consumer_key?: string | null
          serpro_consumer_secret?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_siscomex_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_subscriptions: {
        Row: {
          bonus_shipments: number
          company_id: string
          created_at: string
          current_period_end: string | null
          environment: string
          mrr_cents: number
          plan: Database["public"]["Enums"]["subscription_plan"]
          seats_active: number | null
          seats_limit: number | null
          shipments_limit: number | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          bonus_shipments?: number
          company_id: string
          created_at?: string
          current_period_end?: string | null
          environment?: string
          mrr_cents?: number
          plan?: Database["public"]["Enums"]["subscription_plan"]
          seats_active?: number | null
          seats_limit?: number | null
          shipments_limit?: number | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          bonus_shipments?: number
          company_id?: string
          created_at?: string
          current_period_end?: string | null
          environment?: string
          mrr_cents?: number
          plan?: Database["public"]["Enums"]["subscription_plan"]
          seats_active?: number | null
          seats_limit?: number | null
          shipments_limit?: number | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_estimate_expenses: {
        Row: {
          aduaneira: boolean | null
          category: string | null
          company_id: string
          created_at: string
          descricao: string
          estimate_id: string
          id: string
          is_prepaid: boolean | null
          moeda_original: string | null
          ordem: number
          source_charge_id: string | null
          valor_brl: number
          valor_original: number | null
        }
        Insert: {
          aduaneira?: boolean | null
          category?: string | null
          company_id: string
          created_at?: string
          descricao: string
          estimate_id: string
          id?: string
          is_prepaid?: boolean | null
          moeda_original?: string | null
          ordem?: number
          source_charge_id?: string | null
          valor_brl?: number
          valor_original?: number | null
        }
        Update: {
          aduaneira?: boolean | null
          category?: string | null
          company_id?: string
          created_at?: string
          descricao?: string
          estimate_id?: string
          id?: string
          is_prepaid?: boolean | null
          moeda_original?: string | null
          ordem?: number
          source_charge_id?: string | null
          valor_brl?: number
          valor_original?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_estimate_expenses_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "cost_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_estimate_items: {
        Row: {
          aliq_cofins: number | null
          aliq_icms: number | null
          aliq_ii: number | null
          aliq_ipi: number | null
          aliq_pis: number | null
          cofins_adicional: boolean
          cofins_usd: number | null
          company_id: string
          created_at: string
          despesas_usd: number | null
          destinacao: string
          estimate_id: string
          frete_usd: number | null
          icms_usd: number | null
          id: string
          ii_usd: number | null
          ipi_na_base_icms: boolean
          ipi_usd: number | null
          ncm: string | null
          nome: string
          ordem: number
          peso: number | null
          pis_usd: number | null
          quantidade: number | null
          quote_item_id: string | null
          seguro_usd: number | null
          total_usd: number | null
          vmcv_unit_usd: number | null
          vmcv_usd: number | null
          vmld_usd: number | null
          vmle_usd: number | null
        }
        Insert: {
          aliq_cofins?: number | null
          aliq_icms?: number | null
          aliq_ii?: number | null
          aliq_ipi?: number | null
          aliq_pis?: number | null
          cofins_adicional?: boolean
          cofins_usd?: number | null
          company_id: string
          created_at?: string
          despesas_usd?: number | null
          destinacao?: string
          estimate_id: string
          frete_usd?: number | null
          icms_usd?: number | null
          id?: string
          ii_usd?: number | null
          ipi_na_base_icms?: boolean
          ipi_usd?: number | null
          ncm?: string | null
          nome?: string
          ordem?: number
          peso?: number | null
          pis_usd?: number | null
          quantidade?: number | null
          quote_item_id?: string | null
          seguro_usd?: number | null
          total_usd?: number | null
          vmcv_unit_usd?: number | null
          vmcv_usd?: number | null
          vmld_usd?: number | null
          vmle_usd?: number | null
        }
        Update: {
          aliq_cofins?: number | null
          aliq_icms?: number | null
          aliq_ii?: number | null
          aliq_ipi?: number | null
          aliq_pis?: number | null
          cofins_adicional?: boolean
          cofins_usd?: number | null
          company_id?: string
          created_at?: string
          despesas_usd?: number | null
          destinacao?: string
          estimate_id?: string
          frete_usd?: number | null
          icms_usd?: number | null
          id?: string
          ii_usd?: number | null
          ipi_na_base_icms?: boolean
          ipi_usd?: number | null
          ncm?: string | null
          nome?: string
          ordem?: number
          peso?: number | null
          pis_usd?: number | null
          quantidade?: number | null
          quote_item_id?: string | null
          seguro_usd?: number | null
          total_usd?: number | null
          vmcv_unit_usd?: number | null
          vmcv_usd?: number | null
          vmld_usd?: number | null
          vmle_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_estimate_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "cost_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_estimates: {
        Row: {
          acrescimos_usd: number | null
          afrmm_auto: boolean
          afrmm_brl: number
          armazem: string | null
          carrier: string | null
          cbm_total: number | null
          cofins_usd: number | null
          company_id: string
          created_at: string
          data_fiscal: string
          deducoes_usd: number | null
          despesas_nac_brl: number | null
          eur_brl: number | null
          frequencia: string | null
          frete_intl_usd: number | null
          icms_usd: number | null
          id: string
          ii_usd: number | null
          incoterm: string | null
          ipi_usd: number | null
          numerario_total_brl: number
          numerario_total_usd: number
          pais_origem: string | null
          peso_liquido_kg: number | null
          pis_usd: number | null
          quote_id: string
          rateio_metodo: string
          rota_destino: string | null
          rota_origem: string | null
          seguro_intl_usd: number | null
          status: string
          subtotal_usd: number | null
          taxa_siscomex_auto: boolean
          taxa_siscomex_brl: number
          total_brl: number | null
          total_usd: number | null
          transito: string | null
          updated_at: string
          usd_brl: number | null
          usd_brl_agencia: number | null
          usd_brl_agencia_auto: boolean | null
          vmcv_brl: number | null
          vmcv_usd: number | null
          vmld_usd: number | null
          vmle_usd: number | null
        }
        Insert: {
          acrescimos_usd?: number | null
          afrmm_auto?: boolean
          afrmm_brl?: number
          armazem?: string | null
          carrier?: string | null
          cbm_total?: number | null
          cofins_usd?: number | null
          company_id: string
          created_at?: string
          data_fiscal?: string
          deducoes_usd?: number | null
          despesas_nac_brl?: number | null
          eur_brl?: number | null
          frequencia?: string | null
          frete_intl_usd?: number | null
          icms_usd?: number | null
          id?: string
          ii_usd?: number | null
          incoterm?: string | null
          ipi_usd?: number | null
          numerario_total_brl?: number
          numerario_total_usd?: number
          pais_origem?: string | null
          peso_liquido_kg?: number | null
          pis_usd?: number | null
          quote_id: string
          rateio_metodo?: string
          rota_destino?: string | null
          rota_origem?: string | null
          seguro_intl_usd?: number | null
          status?: string
          subtotal_usd?: number | null
          taxa_siscomex_auto?: boolean
          taxa_siscomex_brl?: number
          total_brl?: number | null
          total_usd?: number | null
          transito?: string | null
          updated_at?: string
          usd_brl?: number | null
          usd_brl_agencia?: number | null
          usd_brl_agencia_auto?: boolean | null
          vmcv_brl?: number | null
          vmcv_usd?: number | null
          vmld_usd?: number | null
          vmle_usd?: number | null
        }
        Update: {
          acrescimos_usd?: number | null
          afrmm_auto?: boolean
          afrmm_brl?: number
          armazem?: string | null
          carrier?: string | null
          cbm_total?: number | null
          cofins_usd?: number | null
          company_id?: string
          created_at?: string
          data_fiscal?: string
          deducoes_usd?: number | null
          despesas_nac_brl?: number | null
          eur_brl?: number | null
          frequencia?: string | null
          frete_intl_usd?: number | null
          icms_usd?: number | null
          id?: string
          ii_usd?: number | null
          incoterm?: string | null
          ipi_usd?: number | null
          numerario_total_brl?: number
          numerario_total_usd?: number
          pais_origem?: string | null
          peso_liquido_kg?: number | null
          pis_usd?: number | null
          quote_id?: string
          rateio_metodo?: string
          rota_destino?: string | null
          rota_origem?: string | null
          seguro_intl_usd?: number | null
          status?: string
          subtotal_usd?: number | null
          taxa_siscomex_auto?: boolean
          taxa_siscomex_brl?: number
          total_brl?: number | null
          total_usd?: number | null
          transito?: string | null
          updated_at?: string
          usd_brl?: number | null
          usd_brl_agencia?: number | null
          usd_brl_agencia_auto?: boolean | null
          vmcv_brl?: number | null
          vmcv_usd?: number | null
          vmld_usd?: number | null
          vmle_usd?: number | null
        }
        Relationships: []
      }
      debit_note_items: {
        Row: {
          charged_amount: number
          created_at: string
          currency: string
          debit_note_id: string
          description: string
          exchange_rate: number
          id: string
          quote_charge_id: string | null
          quoted_amount: number | null
          reason: string | null
          reconciled: boolean
          updated_at: string
          variance: number | null
        }
        Insert: {
          charged_amount?: number
          created_at?: string
          currency?: string
          debit_note_id: string
          description: string
          exchange_rate?: number
          id?: string
          quote_charge_id?: string | null
          quoted_amount?: number | null
          reason?: string | null
          reconciled?: boolean
          updated_at?: string
          variance?: number | null
        }
        Update: {
          charged_amount?: number
          created_at?: string
          currency?: string
          debit_note_id?: string
          description?: string
          exchange_rate?: number
          id?: string
          quote_charge_id?: string | null
          quoted_amount?: number | null
          reason?: string | null
          reconciled?: boolean
          updated_at?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "debit_note_items_debit_note_id_fkey"
            columns: ["debit_note_id"]
            isOneToOne: false
            referencedRelation: "debit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_note_items_quote_charge_id_fkey"
            columns: ["quote_charge_id"]
            isOneToOne: false
            referencedRelation: "quote_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      debit_notes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bank_account_id: string | null
          client_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          dn_number: string
          due_date: string | null
          exchange_rate: number | null
          file_url: string | null
          id: string
          issue_date: string
          kind: Database["public"]["Enums"]["debit_note_kind"]
          notes: string | null
          paid_amount: number | null
          paid_at: string | null
          partner_id: string | null
          payment_reference: string | null
          public_token: string | null
          quote_id: string | null
          shipment_id: string | null
          status: Database["public"]["Enums"]["debit_note_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          client_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          dn_number: string
          due_date?: string | null
          exchange_rate?: number | null
          file_url?: string | null
          id?: string
          issue_date?: string
          kind?: Database["public"]["Enums"]["debit_note_kind"]
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          partner_id?: string | null
          payment_reference?: string | null
          public_token?: string | null
          quote_id?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["debit_note_status"]
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          client_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          dn_number?: string
          due_date?: string | null
          exchange_rate?: number | null
          file_url?: string | null
          id?: string
          issue_date?: string
          kind?: Database["public"]["Enums"]["debit_note_kind"]
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          partner_id?: string | null
          payment_reference?: string | null
          public_token?: string | null
          quote_id?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["debit_note_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debit_notes_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "company_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      document_custom_categories: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_custom_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          client_id: string | null
          company_id: string
          created_at: string
          custom_category: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          expires_at: string | null
          file_size: number | null
          file_url: string | null
          id: string
          name: string
          notify_email: string | null
          quote_id: string | null
          reminder_sent_at: string | null
          shipment_id: string | null
          uploaded_by: string | null
          visible_tracking: boolean
        }
        Insert: {
          client_id?: string | null
          company_id: string
          created_at?: string
          custom_category?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          expires_at?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          name: string
          notify_email?: string | null
          quote_id?: string | null
          reminder_sent_at?: string | null
          shipment_id?: string | null
          uploaded_by?: string | null
          visible_tracking?: boolean
        }
        Update: {
          client_id?: string | null
          company_id?: string
          created_at?: string
          custom_category?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          expires_at?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          name?: string
          notify_email?: string | null
          quote_id?: string | null
          reminder_sent_at?: string | null
          shipment_id?: string | null
          uploaded_by?: string | null
          visible_tracking?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      ncm_taxes_reference: {
        Row: {
          aliq_cofins: number | null
          aliq_ii: number | null
          aliq_ipi: number | null
          aliq_pis: number | null
          description: string | null
          id: string
          last_updated: string
          ncm_code: string
        }
        Insert: {
          aliq_cofins?: number | null
          aliq_ii?: number | null
          aliq_ipi?: number | null
          aliq_pis?: number | null
          description?: string | null
          id?: string
          last_updated?: string
          ncm_code: string
        }
        Update: {
          aliq_cofins?: number | null
          aliq_ii?: number | null
          aliq_ipi?: number | null
          aliq_pis?: number | null
          description?: string | null
          id?: string
          last_updated?: string
          ncm_code?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          company_id: string
          created_at: string
          id: string
          link: string | null
          message: string | null
          read: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          link?: string | null
          message?: string | null
          read?: boolean
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          link?: string | null
          message?: string | null
          read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      overhead_categories: {
        Row: {
          active: boolean
          color: string | null
          company_id: string
          created_at: string
          id: string
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          company_id: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          company_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      overhead_entries: {
        Row: {
          amount: number
          amount_brl: number | null
          company_id: string
          created_at: string
          currency: string
          due_date: string
          id: string
          kind: string
          notes: string | null
          overhead_expense_id: string
          paid_at: string | null
          payment_proof_url: string | null
          reference_month: string
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          amount_brl?: number | null
          company_id: string
          created_at?: string
          currency?: string
          due_date: string
          id?: string
          kind?: string
          notes?: string | null
          overhead_expense_id: string
          paid_at?: string | null
          payment_proof_url?: string | null
          reference_month: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_brl?: number | null
          company_id?: string
          created_at?: string
          currency?: string
          due_date?: string
          id?: string
          kind?: string
          notes?: string | null
          overhead_expense_id?: string
          paid_at?: string | null
          payment_proof_url?: string | null
          reference_month?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "overhead_entries_overhead_expense_id_fkey"
            columns: ["overhead_expense_id"]
            isOneToOne: false
            referencedRelation: "overhead_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      overhead_expenses: {
        Row: {
          active: boolean
          amount_default: number
          category_id: string | null
          company_id: string
          cost_center: string | null
          created_at: string
          currency: string
          due_day: number
          end_date: string | null
          id: string
          kind: string
          name: string
          notes: string | null
          payment_method: string | null
          recurrence: string
          start_date: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_default?: number
          category_id?: string | null
          company_id: string
          cost_center?: string | null
          created_at?: string
          currency?: string
          due_day?: number
          end_date?: string | null
          id?: string
          kind?: string
          name: string
          notes?: string | null
          payment_method?: string | null
          recurrence?: string
          start_date?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_default?: number
          category_id?: string | null
          company_id?: string
          cost_center?: string | null
          created_at?: string
          currency?: string
          due_day?: number
          end_date?: string | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          payment_method?: string | null
          recurrence?: string
          start_date?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "overhead_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "overhead_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overhead_expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_expenses: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          created_by: string | null
          currency: string
          description: string
          expense_date: string
          id: string
          is_recurring: boolean
          notes: string | null
          recurring_frequency: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          expense_date?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          recurring_frequency?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          expense_date?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          recurring_frequency?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          id: string
          logo_dark_url: string | null
          logo_url: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          logo_dark_url?: string | null
          logo_url?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          logo_dark_url?: string | null
          logo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      portalunico_webhook_events: {
        Row: {
          canal: string | null
          company_id: string | null
          created_at: string
          data_evento: string | null
          event_type: string | null
          id: string
          matched: boolean
          message: string | null
          numero: string | null
          raw_body: Json | null
          shipment_ids: string[]
          situacao_duimp: string | null
          versao: number | null
        }
        Insert: {
          canal?: string | null
          company_id?: string | null
          created_at?: string
          data_evento?: string | null
          event_type?: string | null
          id?: string
          matched?: boolean
          message?: string | null
          numero?: string | null
          raw_body?: Json | null
          shipment_ids?: string[]
          situacao_duimp?: string | null
          versao?: number | null
        }
        Update: {
          canal?: string | null
          company_id?: string | null
          created_at?: string
          data_evento?: string | null
          event_type?: string | null
          id?: string
          matched?: boolean
          message?: string | null
          numero?: string | null
          raw_body?: Json | null
          shipment_ids?: string[]
          situacao_duimp?: string | null
          versao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portalunico_webhook_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ports: {
        Row: {
          city: string | null
          code: string
          country_code: string
          country_name: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          type: string
        }
        Insert: {
          city?: string | null
          code: string
          country_code: string
          country_name?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          type?: string
        }
        Update: {
          city?: string | null
          code?: string
          country_code?: string
          country_name?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          type?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_session_id: string | null
          avatar_url: string | null
          company_id: string
          created_at: string
          department: string | null
          email: string
          full_name: string
          id: string
          language: string
          must_change_password: boolean
          onboarding_dismissed_at: string | null
          onboarding_tour_seen_at: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_session_id?: string | null
          avatar_url?: string | null
          company_id: string
          created_at?: string
          department?: string | null
          email: string
          full_name: string
          id?: string
          language?: string
          must_change_password?: boolean
          onboarding_dismissed_at?: string | null
          onboarding_tour_seen_at?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_session_id?: string | null
          avatar_url?: string | null
          company_id?: string
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          language?: string
          must_change_password?: boolean
          onboarding_dismissed_at?: string | null
          onboarding_tour_seen_at?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_charges: {
        Row: {
          aduaneira: boolean | null
          billing_unit: string
          buy_actual_confirmed_at: string | null
          buy_actual_confirmed_by: string | null
          buy_amount: number | null
          buy_amount_actual: number | null
          buy_paid_at: string | null
          buy_variance_note: string | null
          buy_variance_reason: string | null
          charge_catalog_id: string | null
          charge_type: string
          company_id: string
          computed_buy_amount: number | null
          computed_sell_amount: number | null
          created_at: string
          currency: string | null
          description: string
          exchange_rate: number | null
          id: string
          is_auto_insurance: boolean
          leg: string
          partner_id: string | null
          payment_term: string | null
          percent_base_charge_ids: string[] | null
          quote_id: string
          sell_amount: number | null
          sent_in_debit_note_id: string | null
        }
        Insert: {
          aduaneira?: boolean | null
          billing_unit?: string
          buy_actual_confirmed_at?: string | null
          buy_actual_confirmed_by?: string | null
          buy_amount?: number | null
          buy_amount_actual?: number | null
          buy_paid_at?: string | null
          buy_variance_note?: string | null
          buy_variance_reason?: string | null
          charge_catalog_id?: string | null
          charge_type?: string
          company_id: string
          computed_buy_amount?: number | null
          computed_sell_amount?: number | null
          created_at?: string
          currency?: string | null
          description: string
          exchange_rate?: number | null
          id?: string
          is_auto_insurance?: boolean
          leg?: string
          partner_id?: string | null
          payment_term?: string | null
          percent_base_charge_ids?: string[] | null
          quote_id: string
          sell_amount?: number | null
          sent_in_debit_note_id?: string | null
        }
        Update: {
          aduaneira?: boolean | null
          billing_unit?: string
          buy_actual_confirmed_at?: string | null
          buy_actual_confirmed_by?: string | null
          buy_amount?: number | null
          buy_amount_actual?: number | null
          buy_paid_at?: string | null
          buy_variance_note?: string | null
          buy_variance_reason?: string | null
          charge_catalog_id?: string | null
          charge_type?: string
          company_id?: string
          computed_buy_amount?: number | null
          computed_sell_amount?: number | null
          created_at?: string
          currency?: string | null
          description?: string
          exchange_rate?: number | null
          id?: string
          is_auto_insurance?: boolean
          leg?: string
          partner_id?: string | null
          payment_term?: string | null
          percent_base_charge_ids?: string[] | null
          quote_id?: string
          sell_amount?: number | null
          sent_in_debit_note_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_charges_charge_catalog_id_fkey"
            columns: ["charge_catalog_id"]
            isOneToOne: false
            referencedRelation: "charge_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_charges_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_charges_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_charges_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_charges_sent_in_debit_note_id_fkey"
            columns: ["sent_in_debit_note_id"]
            isOneToOne: false
            referencedRelation: "debit_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_comments: {
        Row: {
          company_id: string
          content: string
          created_at: string
          id: string
          quote_id: string
          user_id: string
        }
        Insert: {
          company_id: string
          content: string
          created_at?: string
          id?: string
          quote_id: string
          user_id: string
        }
        Update: {
          company_id?: string
          content?: string
          created_at?: string
          id?: string
          quote_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_comments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_comments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          cargo_value: number | null
          cargo_value_currency: string | null
          chargeable_weight: number | null
          commodity: string | null
          company_id: string
          container_number: string | null
          container_qty: number | null
          container_type: string | null
          created_at: string
          dangerous_goods: boolean | null
          height_cm: number | null
          id: string
          length_cm: number | null
          ncm_code: string | null
          notes: string | null
          packages: number | null
          quote_id: string
          vehicle_type: string | null
          volume_cbm: number | null
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          cargo_value?: number | null
          cargo_value_currency?: string | null
          chargeable_weight?: number | null
          commodity?: string | null
          company_id: string
          container_number?: string | null
          container_qty?: number | null
          container_type?: string | null
          created_at?: string
          dangerous_goods?: boolean | null
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          ncm_code?: string | null
          notes?: string | null
          packages?: number | null
          quote_id: string
          vehicle_type?: string | null
          volume_cbm?: number | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          cargo_value?: number | null
          cargo_value_currency?: string | null
          chargeable_weight?: number | null
          commodity?: string | null
          company_id?: string
          container_number?: string | null
          container_qty?: number | null
          container_type?: string | null
          created_at?: string
          dangerous_goods?: boolean | null
          height_cm?: number | null
          id?: string
          length_cm?: number | null
          ncm_code?: string | null
          notes?: string | null
          packages?: number | null
          quote_id?: string
          vehicle_type?: string | null
          volume_cbm?: number | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_partners: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          id: string
          quote_id: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          id?: string
          quote_id: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          id?: string
          quote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_partners_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_partners_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_partners_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          base_reference: string | null
          client_id: string | null
          client_reference: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string | null
          delivery_address: string | null
          destination: string | null
          direction: string | null
          free_time: number | null
          id: string
          incoterm: string | null
          notes: string | null
          origin: string | null
          payment_terms: string | null
          pickup_address: string | null
          proposal_notes: string | null
          quote_number: string
          rejection_reason: string | null
          seguro_auto: boolean
          seguro_taxa_pct: number | null
          sent_at: string | null
          shipment_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          storage_fee_amount: number | null
          storage_fee_currency: string | null
          storage_fee_note: string | null
          total_buy: number | null
          total_sell: number | null
          transit_time: number | null
          transport_mode: Database["public"]["Enums"]["transport_mode"]
          transshipment: string | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          base_reference?: string | null
          client_id?: string | null
          client_reference?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          delivery_address?: string | null
          destination?: string | null
          direction?: string | null
          free_time?: number | null
          id?: string
          incoterm?: string | null
          notes?: string | null
          origin?: string | null
          payment_terms?: string | null
          pickup_address?: string | null
          proposal_notes?: string | null
          quote_number: string
          rejection_reason?: string | null
          seguro_auto?: boolean
          seguro_taxa_pct?: number | null
          sent_at?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          storage_fee_amount?: number | null
          storage_fee_currency?: string | null
          storage_fee_note?: string | null
          total_buy?: number | null
          total_sell?: number | null
          transit_time?: number | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"]
          transshipment?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          base_reference?: string | null
          client_id?: string | null
          client_reference?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          delivery_address?: string | null
          destination?: string | null
          direction?: string | null
          free_time?: number | null
          id?: string
          incoterm?: string | null
          notes?: string | null
          origin?: string | null
          payment_terms?: string | null
          pickup_address?: string | null
          proposal_notes?: string | null
          quote_number?: string
          rejection_reason?: string | null
          seguro_auto?: boolean
          seguro_taxa_pct?: number | null
          sent_at?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          storage_fee_amount?: number | null
          storage_fee_currency?: string | null
          storage_fee_note?: string | null
          total_buy?: number | null
          total_sell?: number | null
          transit_time?: number | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"]
          transshipment?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_counters: {
        Row: {
          company_id: string
          last_number: number
        }
        Insert: {
          company_id: string
          last_number?: number
        }
        Update: {
          company_id?: string
          last_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "reference_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_audit_log: {
        Row: {
          changed_at: string
          company_id: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          quote_id: string | null
          shipment_id: string | null
          user_id: string | null
        }
        Insert: {
          changed_at?: string
          company_id: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          quote_id?: string | null
          shipment_id?: string | null
          user_id?: string | null
        }
        Update: {
          changed_at?: string
          company_id?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          quote_id?: string | null
          shipment_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_audit_log_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_audit_log_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          event_date: string
          id: string
          note: string
          shipment_id: string
          visible_tracking: boolean
        }
        Insert: {
          category?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          event_date?: string
          id?: string
          note: string
          shipment_id: string
          visible_tracking?: boolean
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          event_date?: string
          id?: string
          note?: string
          shipment_id?: string
          visible_tracking?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_partners: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          id: string
          shipment_id: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          id?: string
          shipment_id: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          id?: string
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_partners_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_partners_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_partners_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_status_options: {
        Row: {
          category: string
          company_id: string
          created_at: string
          id: string
          label: string
          position: number
          value: string
        }
        Insert: {
          category?: string
          company_id: string
          created_at?: string
          id?: string
          label: string
          position?: number
          value: string
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          id?: string
          label?: string
          position?: number
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_status_options_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          ata: string | null
          atd: string | null
          booking_number: string | null
          cargo_delivered_at: string | null
          cargo_description: string | null
          carrier: string | null
          ce_mercante_house: string | null
          ce_mercante_manifest: string | null
          ce_mercante_master: string | null
          charges_verified: boolean
          client_id: string | null
          client_reference: string | null
          company_id: string
          consignee_id: string | null
          container_demurrage_deadlines: string | null
          container_number: string | null
          container_quantity: number | null
          container_return_dates: string | null
          container_seals: string | null
          container_terminal_entry_dates: string | null
          courier_provider: string | null
          courier_tracking_number: string | null
          created_at: string
          created_by: string | null
          customs_channel: string | null
          customs_registration_date: string | null
          demurrage_deadline: string | null
          destination_city: string | null
          destination_country: string | null
          destination_port: string | null
          dta_number: string | null
          duimp_number: string | null
          duimp_version: number | null
          eta: string | null
          etd: string | null
          financial_released: boolean
          free_time: number | null
          house_bl: string | null
          id: string
          incoterm: string | null
          invoice_number: string | null
          invoice_sent_at: string | null
          is_finalized: boolean
          last_accessed_at: string | null
          master_bl: string | null
          next_update: string | null
          notes: string | null
          notify_id: string | null
          origin_city: string | null
          origin_country: string | null
          origin_port: string | null
          other_info: string | null
          packages: number | null
          physical_location: string | null
          reference_number: string
          shipper_id: string | null
          status: string
          storage_deadline: string | null
          terminal_entry_date: string | null
          transport_mode: Database["public"]["Enums"]["transport_mode"]
          transshipment: string | null
          updated_at: string
          vessel_flight: string | null
          volume_cbm: number | null
          weight_kg: number | null
        }
        Insert: {
          ata?: string | null
          atd?: string | null
          booking_number?: string | null
          cargo_delivered_at?: string | null
          cargo_description?: string | null
          carrier?: string | null
          ce_mercante_house?: string | null
          ce_mercante_manifest?: string | null
          ce_mercante_master?: string | null
          charges_verified?: boolean
          client_id?: string | null
          client_reference?: string | null
          company_id: string
          consignee_id?: string | null
          container_demurrage_deadlines?: string | null
          container_number?: string | null
          container_quantity?: number | null
          container_return_dates?: string | null
          container_seals?: string | null
          container_terminal_entry_dates?: string | null
          courier_provider?: string | null
          courier_tracking_number?: string | null
          created_at?: string
          created_by?: string | null
          customs_channel?: string | null
          customs_registration_date?: string | null
          demurrage_deadline?: string | null
          destination_city?: string | null
          destination_country?: string | null
          destination_port?: string | null
          dta_number?: string | null
          duimp_number?: string | null
          duimp_version?: number | null
          eta?: string | null
          etd?: string | null
          financial_released?: boolean
          free_time?: number | null
          house_bl?: string | null
          id?: string
          incoterm?: string | null
          invoice_number?: string | null
          invoice_sent_at?: string | null
          is_finalized?: boolean
          last_accessed_at?: string | null
          master_bl?: string | null
          next_update?: string | null
          notes?: string | null
          notify_id?: string | null
          origin_city?: string | null
          origin_country?: string | null
          origin_port?: string | null
          other_info?: string | null
          packages?: number | null
          physical_location?: string | null
          reference_number: string
          shipper_id?: string | null
          status?: string
          storage_deadline?: string | null
          terminal_entry_date?: string | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"]
          transshipment?: string | null
          updated_at?: string
          vessel_flight?: string | null
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Update: {
          ata?: string | null
          atd?: string | null
          booking_number?: string | null
          cargo_delivered_at?: string | null
          cargo_description?: string | null
          carrier?: string | null
          ce_mercante_house?: string | null
          ce_mercante_manifest?: string | null
          ce_mercante_master?: string | null
          charges_verified?: boolean
          client_id?: string | null
          client_reference?: string | null
          company_id?: string
          consignee_id?: string | null
          container_demurrage_deadlines?: string | null
          container_number?: string | null
          container_quantity?: number | null
          container_return_dates?: string | null
          container_seals?: string | null
          container_terminal_entry_dates?: string | null
          courier_provider?: string | null
          courier_tracking_number?: string | null
          created_at?: string
          created_by?: string | null
          customs_channel?: string | null
          customs_registration_date?: string | null
          demurrage_deadline?: string | null
          destination_city?: string | null
          destination_country?: string | null
          destination_port?: string | null
          dta_number?: string | null
          duimp_number?: string | null
          duimp_version?: number | null
          eta?: string | null
          etd?: string | null
          financial_released?: boolean
          free_time?: number | null
          house_bl?: string | null
          id?: string
          incoterm?: string | null
          invoice_number?: string | null
          invoice_sent_at?: string | null
          is_finalized?: boolean
          last_accessed_at?: string | null
          master_bl?: string | null
          next_update?: string | null
          notes?: string | null
          notify_id?: string | null
          origin_city?: string | null
          origin_country?: string | null
          origin_port?: string | null
          other_info?: string | null
          packages?: number | null
          physical_location?: string | null
          reference_number?: string
          shipper_id?: string | null
          status?: string
          storage_deadline?: string | null
          terminal_entry_date?: string | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"]
          transshipment?: string | null
          updated_at?: string
          vessel_flight?: string | null
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_attempts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip: string
          success: boolean
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip: string
          success?: boolean
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip?: string
          success?: boolean
        }
        Relationships: []
      }
      support_ticket_messages: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_staff: boolean
          ticket_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_staff?: boolean
          ticket_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_staff?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: Database["public"]["Enums"]["ticket_category"]
          company_id: string
          created_at: string
          created_by: string
          description: string
          id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          status: Database["public"]["Enums"]["ticket_status"]
          title: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["ticket_category"]
          company_id: string
          created_at?: string
          created_by: string
          description: string
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          status?: Database["public"]["Enums"]["ticket_status"]
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["ticket_category"]
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          status?: Database["public"]["Enums"]["ticket_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          shipment_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_release_reads: {
        Row: {
          read_at: string
          release_id: string
          user_id: string
        }
        Insert: {
          read_at?: string
          release_id: string
          user_id: string
        }
        Update: {
          read_at?: string
          release_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_release_reads_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "app_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_contacts: {
        Row: {
          company_ref_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          name: string | null
          notes: string | null
          phone: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_ref_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          name?: string | null
          notes?: string | null
          phone: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_ref_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          name?: string | null
          notes?: string | null
          phone?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_company_ref_id_fkey"
            columns: ["company_ref_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          contact_id: string
          created_at: string
          direction: string
          id: string
          message_type: string
          raw_payload: Json | null
          status: string
          template_name: string | null
          wa_message_id: string | null
        }
        Insert: {
          body?: string | null
          contact_id: string
          created_at?: string
          direction: string
          id?: string
          message_type?: string
          raw_payload?: Json | null
          status?: string
          template_name?: string | null
          wa_message_id?: string | null
        }
        Update: {
          body?: string | null
          contact_id?: string
          created_at?: string
          direction?: string
          id?: string
          message_type?: string
          raw_payload?: Json | null
          status?: string
          template_name?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_overhead_entries_for_month: {
        Args: { p_month?: string }
        Returns: number
      }
      is_superadmin: { Args: never; Returns: boolean }
      my_company_id: { Args: never; Returns: string }
      next_dn_number: { Args: { p_company_id: string }; Returns: string }
      next_oc_number: { Args: { p_company_id: string }; Returns: string }
      next_reference: { Args: { p_company_id: string }; Returns: string }
      reopen_shipment: { Args: { p_shipment_id: string }; Returns: undefined }
      reset_demo_data: { Args: never; Returns: undefined }
      shipment_status_is_finalized: {
        Args: { p_company_id: string; p_status: string }
        Returns: boolean
      }
    }
    Enums: {
      accounts_payable_source: "debit_note" | "overhead" | "manual"
      accounts_payable_status: "aberto" | "pago" | "atrasado" | "cancelado"
      accounts_receivable_source: "debit_note" | "manual" | "storage_fee"
      accounts_receivable_status:
        | "aberto"
        | "recebido"
        | "atrasado"
        | "cancelado"
      addon_key:
        | "cost_estimate_premium"
        | "tracking_portal"
        | "ai_import"
        | "multi_company"
      app_role:
        | "admin"
        | "operator"
        | "viewer"
        | "client"
        | "salesperson"
        | "diretor"
        | "gerente"
        | "coordenador_comercial"
        | "inside"
        | "coordenador_operacional"
        | "coordenador_financeiro"
        | "financeiro"
        | "superadmin"
      charge_direction: "payable" | "receivable"
      charge_type:
        | "freight"
        | "handling"
        | "customs"
        | "insurance"
        | "documentation"
        | "storage"
        | "other"
      client_type: "client" | "supplier" | "carrier" | "agent" | "shipper"
      debit_note_kind: "partner_incoming" | "client_outgoing"
      debit_note_status:
        | "pendente"
        | "em_conferencia"
        | "aprovada"
        | "rejeitada"
        | "paga"
        | "emitida"
        | "cancelada"
      document_type:
        | "bl"
        | "invoice"
        | "packing_list"
        | "certificate_origin"
        | "customs_declaration"
        | "insurance"
        | "other"
        | "debit_note_supplier"
        | "dta"
        | "outros"
        | "ordem_coleta"
      invoice_status_type: "pending" | "invoiced" | "paid"
      notification_type:
        | "deadline_warning"
        | "approval_needed"
        | "document_uploaded"
        | "status_change"
        | "general"
      quote_status:
        | "draft"
        | "sent"
        | "approved"
        | "rejected"
        | "converted"
        | "quoting"
      shipment_status:
        | "draft"
        | "quoted"
        | "approved"
        | "booked"
        | "collected_at_origin"
        | "docs_at_origin"
        | "in_transit"
        | "arrived"
        | "delivered"
        | "cancelled"
      subscription_plan: "starter" | "professional" | "business"
      subscription_status: "trial" | "active" | "past_due" | "canceled"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "pending" | "in_progress" | "completed" | "cancelled"
      ticket_category: "bug" | "sugestao" | "duvida" | "outro"
      ticket_priority: "baixa" | "media" | "alta"
      ticket_status: "aberto" | "em_andamento" | "resolvido" | "fechado"
      transport_mode: "ocean_fcl" | "ocean_lcl" | "air" | "road" | "multimodal"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      accounts_payable_source: ["debit_note", "overhead", "manual"],
      accounts_payable_status: ["aberto", "pago", "atrasado", "cancelado"],
      accounts_receivable_source: ["debit_note", "manual", "storage_fee"],
      accounts_receivable_status: [
        "aberto",
        "recebido",
        "atrasado",
        "cancelado",
      ],
      addon_key: [
        "cost_estimate_premium",
        "tracking_portal",
        "ai_import",
        "multi_company",
      ],
      app_role: [
        "admin",
        "operator",
        "viewer",
        "client",
        "salesperson",
        "diretor",
        "gerente",
        "coordenador_comercial",
        "inside",
        "coordenador_operacional",
        "coordenador_financeiro",
        "financeiro",
        "superadmin",
      ],
      charge_direction: ["payable", "receivable"],
      charge_type: [
        "freight",
        "handling",
        "customs",
        "insurance",
        "documentation",
        "storage",
        "other",
      ],
      client_type: ["client", "supplier", "carrier", "agent", "shipper"],
      debit_note_kind: ["partner_incoming", "client_outgoing"],
      debit_note_status: [
        "pendente",
        "em_conferencia",
        "aprovada",
        "rejeitada",
        "paga",
        "emitida",
        "cancelada",
      ],
      document_type: [
        "bl",
        "invoice",
        "packing_list",
        "certificate_origin",
        "customs_declaration",
        "insurance",
        "other",
        "debit_note_supplier",
        "dta",
        "outros",
        "ordem_coleta",
      ],
      invoice_status_type: ["pending", "invoiced", "paid"],
      notification_type: [
        "deadline_warning",
        "approval_needed",
        "document_uploaded",
        "status_change",
        "general",
      ],
      quote_status: [
        "draft",
        "sent",
        "approved",
        "rejected",
        "converted",
        "quoting",
      ],
      shipment_status: [
        "draft",
        "quoted",
        "approved",
        "booked",
        "collected_at_origin",
        "docs_at_origin",
        "in_transit",
        "arrived",
        "delivered",
        "cancelled",
      ],
      subscription_plan: ["starter", "professional", "business"],
      subscription_status: ["trial", "active", "past_due", "canceled"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["pending", "in_progress", "completed", "cancelled"],
      ticket_category: ["bug", "sugestao", "duvida", "outro"],
      ticket_priority: ["baixa", "media", "alta"],
      ticket_status: ["aberto", "em_andamento", "resolvido", "fechado"],
      transport_mode: ["ocean_fcl", "ocean_lcl", "air", "road", "multimodal"],
    },
  },
} as const
