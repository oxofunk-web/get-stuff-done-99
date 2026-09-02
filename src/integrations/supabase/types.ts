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
      bot_settings: {
        Row: {
          bet_size: number
          enabled: boolean
          ev_margin: number
          first_enabled_at: string | null
          id: boolean
          last_tick_at: string | null
          last_tick_msg: string | null
          live_confirmed_at: string | null
          max_trades: number
          mode: string
          updated_at: string
        }
        Insert: {
          bet_size?: number
          enabled?: boolean
          ev_margin?: number
          first_enabled_at?: string | null
          id?: boolean
          last_tick_at?: string | null
          last_tick_msg?: string | null
          live_confirmed_at?: string | null
          max_trades?: number
          mode?: string
          updated_at?: string
        }
        Update: {
          bet_size?: number
          enabled?: boolean
          ev_margin?: number
          first_enabled_at?: string | null
          id?: boolean
          last_tick_at?: string | null
          last_tick_msg?: string | null
          live_confirmed_at?: string | null
          max_trades?: number
          mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          candle_id: number
          id: number
          pair: string
          seconds_in: number
          spot: number
          spread: number | null
          strike: number | null
          ticker: string | null
          ts: string
          vol: number | null
          yes_ask: number | null
          yes_bid: number | null
          yes_mid: number | null
        }
        Insert: {
          candle_id: number
          id?: number
          pair: string
          seconds_in: number
          spot: number
          spread?: number | null
          strike?: number | null
          ticker?: string | null
          ts?: string
          vol?: number | null
          yes_ask?: number | null
          yes_bid?: number | null
          yes_mid?: number | null
        }
        Update: {
          candle_id?: number
          id?: number
          pair?: string
          seconds_in?: number
          spot?: number
          spread?: number | null
          strike?: number | null
          ticker?: string | null
          ts?: string
          vol?: number | null
          yes_ask?: number | null
          yes_bid?: number | null
          yes_mid?: number | null
        }
        Relationships: []
      }
      signal_log: {
        Row: {
          calibrated: number | null
          candle_id: number
          conf: number | null
          dir: string | null
          entry_price: number | null
          ev: number | null
          id: string
          k_mom: number | null
          outcome: string | null
          pair: string
          reason: string | null
          seconds_in: number
          settled_at: string | null
          settled_spot: number | null
          sigma_dist: number | null
          skew: number | null
          spot: number | null
          spot_mom: number | null
          spread: number | null
          strike: number | null
          ts: string
          verdict: string
          yes_mid: number | null
        }
        Insert: {
          calibrated?: number | null
          candle_id: number
          conf?: number | null
          dir?: string | null
          entry_price?: number | null
          ev?: number | null
          id?: string
          k_mom?: number | null
          outcome?: string | null
          pair: string
          reason?: string | null
          seconds_in: number
          settled_at?: string | null
          settled_spot?: number | null
          sigma_dist?: number | null
          skew?: number | null
          spot?: number | null
          spot_mom?: number | null
          spread?: number | null
          strike?: number | null
          ts?: string
          verdict: string
          yes_mid?: number | null
        }
        Update: {
          calibrated?: number | null
          candle_id?: number
          conf?: number | null
          dir?: string | null
          entry_price?: number | null
          ev?: number | null
          id?: string
          k_mom?: number | null
          outcome?: string | null
          pair?: string
          reason?: string | null
          seconds_in?: number
          settled_at?: string | null
          settled_spot?: number | null
          sigma_dist?: number | null
          skew?: number | null
          spot?: number | null
          spot_mom?: number | null
          spread?: number | null
          strike?: number | null
          ts?: string
          verdict?: string
          yes_mid?: number | null
        }
        Relationships: []
      }
      trade_log: {
        Row: {
          calibrated: number | null
          candle_id: number
          conf: number | null
          contracts: number | null
          dir: string
          entry_price: number | null
          id: string
          mode: string
          msg: string | null
          order_id: string | null
          outcome: string | null
          pair: string
          pnl: number | null
          settled_at: string | null
          source: string
          stake: number | null
          status: string
          ts: string
        }
        Insert: {
          calibrated?: number | null
          candle_id: number
          conf?: number | null
          contracts?: number | null
          dir: string
          entry_price?: number | null
          id?: string
          mode: string
          msg?: string | null
          order_id?: string | null
          outcome?: string | null
          pair: string
          pnl?: number | null
          settled_at?: string | null
          source?: string
          stake?: number | null
          status: string
          ts?: string
        }
        Update: {
          calibrated?: number | null
          candle_id?: number
          conf?: number | null
          contracts?: number | null
          dir?: string
          entry_price?: number | null
          id?: string
          mode?: string
          msg?: string | null
          order_id?: string | null
          outcome?: string | null
          pair?: string
          pnl?: number | null
          settled_at?: string | null
          source?: string
          stake?: number | null
          status?: string
          ts?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
