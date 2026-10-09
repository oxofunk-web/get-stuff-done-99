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
      ai_notes: {
        Row: {
          candle_id: number | null
          created_at: string
          data: Json | null
          id: string
          kind: string
          label: string | null
          note: string | null
          pair: string | null
          ts: string
        }
        Insert: {
          candle_id?: number | null
          created_at?: string
          data?: Json | null
          id?: string
          kind: string
          label?: string | null
          note?: string | null
          pair?: string | null
          ts?: string
        }
        Update: {
          candle_id?: number | null
          created_at?: string
          data?: Json | null
          id?: string
          kind?: string
          label?: string | null
          note?: string | null
          pair?: string | null
          ts?: string
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          auto_trade_enabled: boolean
          auto_trade_last_msg: string | null
          auto_trade_paper: boolean
          auto_trade_size: number
          bet_size: number
          bootstrap_enabled: boolean
          bootstrap_max_daily: number
          bootstrap_max_entry: number
          bootstrap_stake: number
          daily_loss_cap: number
          enabled: boolean
          ev_margin: number
          first_enabled_at: string | null
          gate_preset: string
          gate_secs: number
          id: boolean
          last_tick_at: string | null
          last_tick_msg: string | null
          live_confirmed_at: string | null
          max_spread: number
          max_trades: number
          max_yes_mid: number
          min_sigma_dist: number
          min_skew: number
          min_yes_mid: number
          mode: string
          paper_bank_reset_at: string | null
          paper_bankroll: number
          run_lease_id: string | null
          run_lease_until: string | null
          scalp_enabled: boolean
          scalp_last_msg: string | null
          stop_loss_cents: number
          take_profit_cents: number
          threshold: number
          updated_at: string
        }
        Insert: {
          auto_trade_enabled?: boolean
          auto_trade_last_msg?: string | null
          auto_trade_paper?: boolean
          auto_trade_size?: number
          bet_size?: number
          bootstrap_enabled?: boolean
          bootstrap_max_daily?: number
          bootstrap_max_entry?: number
          bootstrap_stake?: number
          daily_loss_cap?: number
          enabled?: boolean
          ev_margin?: number
          first_enabled_at?: string | null
          gate_preset?: string
          gate_secs?: number
          id?: boolean
          last_tick_at?: string | null
          last_tick_msg?: string | null
          live_confirmed_at?: string | null
          max_spread?: number
          max_trades?: number
          max_yes_mid?: number
          min_sigma_dist?: number
          min_skew?: number
          min_yes_mid?: number
          mode?: string
          paper_bank_reset_at?: string | null
          paper_bankroll?: number
          run_lease_id?: string | null
          run_lease_until?: string | null
          scalp_enabled?: boolean
          scalp_last_msg?: string | null
          stop_loss_cents?: number
          take_profit_cents?: number
          threshold?: number
          updated_at?: string
        }
        Update: {
          auto_trade_enabled?: boolean
          auto_trade_last_msg?: string | null
          auto_trade_paper?: boolean
          auto_trade_size?: number
          bet_size?: number
          bootstrap_enabled?: boolean
          bootstrap_max_daily?: number
          bootstrap_max_entry?: number
          bootstrap_stake?: number
          daily_loss_cap?: number
          enabled?: boolean
          ev_margin?: number
          first_enabled_at?: string | null
          gate_preset?: string
          gate_secs?: number
          id?: boolean
          last_tick_at?: string | null
          last_tick_msg?: string | null
          live_confirmed_at?: string | null
          max_spread?: number
          max_trades?: number
          max_yes_mid?: number
          min_sigma_dist?: number
          min_skew?: number
          min_yes_mid?: number
          mode?: string
          paper_bank_reset_at?: string | null
          paper_bankroll?: number
          run_lease_id?: string | null
          run_lease_until?: string | null
          scalp_enabled?: boolean
          scalp_last_msg?: string | null
          stop_loss_cents?: number
          take_profit_cents?: number
          threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      council_proposals: {
        Row: {
          bank_decision: Json | null
          candle_id: number | null
          confidence: number
          contracts: number | null
          created_at: string
          entry_target: number
          expires_at: string
          fill_price: number | null
          filled_at: string | null
          graded_at: string | null
          id: string
          market: string
          order_error: string | null
          order_id: string | null
          outcome: string | null
          pnl: number | null
          proposing_agent: string
          side: string
          size: number
          stake: number | null
          status: string
          thesis: string
          trade_id: string | null
          updated_at: string
          votes: Json
        }
        Insert: {
          bank_decision?: Json | null
          candle_id?: number | null
          confidence: number
          contracts?: number | null
          created_at?: string
          entry_target: number
          expires_at: string
          fill_price?: number | null
          filled_at?: string | null
          graded_at?: string | null
          id?: string
          market: string
          order_error?: string | null
          order_id?: string | null
          outcome?: string | null
          pnl?: number | null
          proposing_agent: string
          side: string
          size: number
          stake?: number | null
          status?: string
          thesis: string
          trade_id?: string | null
          updated_at?: string
          votes?: Json
        }
        Update: {
          bank_decision?: Json | null
          candle_id?: number | null
          confidence?: number
          contracts?: number | null
          created_at?: string
          entry_target?: number
          expires_at?: string
          fill_price?: number | null
          filled_at?: string | null
          graded_at?: string | null
          id?: string
          market?: string
          order_error?: string | null
          order_id?: string | null
          outcome?: string | null
          pnl?: number | null
          proposing_agent?: string
          side?: string
          size?: number
          stake?: number | null
          status?: string
          thesis?: string
          trade_id?: string | null
          updated_at?: string
          votes?: Json
        }
        Relationships: []
      }
      council_settings: {
        Row: {
          api_token: string
          halted: boolean
          halted_at: string | null
          id: boolean
          updated_at: string
        }
        Insert: {
          api_token?: string
          halted?: boolean
          halted_at?: string | null
          id?: boolean
          updated_at?: string
        }
        Update: {
          api_token?: string
          halted?: boolean
          halted_at?: string | null
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      cron_token: {
        Row: {
          created_at: string
          id: boolean
          token: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          token: string
        }
        Update: {
          created_at?: string
          id?: boolean
          token?: string
        }
        Relationships: []
      }
      direction_calls: {
        Row: {
          candle_start: number
          close_price: number | null
          dir: string
          graded_at: string | null
          id: string
          lock_price: number
          lock_sec: number
          locked_at: string
          open_price: number
          pair: string
          prob: number
          result: string | null
        }
        Insert: {
          candle_start: number
          close_price?: number | null
          dir: string
          graded_at?: string | null
          id?: string
          lock_price: number
          lock_sec: number
          locked_at?: string
          open_price: number
          pair: string
          prob: number
          result?: string | null
        }
        Update: {
          candle_start?: number
          close_price?: number | null
          dir?: string
          graded_at?: string | null
          id?: string
          lock_price?: number
          lock_sec?: number
          locked_at?: string
          open_price?: number
          pair?: string
          prob?: number
          result?: string | null
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          candle_id: number
          id: number
          pair: string
          quote_observed_at: string | null
          seconds_in: number
          spot: number
          spread: number | null
          strike: number | null
          strike_type: string | null
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
          quote_observed_at?: string | null
          seconds_in: number
          spot: number
          spread?: number | null
          strike?: number | null
          strike_type?: string | null
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
          quote_observed_at?: string | null
          seconds_in?: number
          spot?: number
          spread?: number | null
          strike?: number | null
          strike_type?: string | null
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
          cushion_score: number | null
          depth: number | null
          dir: string | null
          entry_price: number | null
          ev: number | null
          id: string
          k_mom: number | null
          minute_in: number | null
          mom_z: number | null
          outcome: string | null
          pair: string
          raw_score: number | null
          reason: string | null
          seconds_in: number
          settled_at: string | null
          settled_spot: number | null
          sigma_dist: number | null
          skew: number | null
          source: string
          spot: number | null
          spot_mom: number | null
          spread: number | null
          strategy_version: string
          strike: number | null
          strike_type: string | null
          ts: string
          verdict: string
          yes_mid: number | null
        }
        Insert: {
          calibrated?: number | null
          candle_id: number
          conf?: number | null
          cushion_score?: number | null
          depth?: number | null
          dir?: string | null
          entry_price?: number | null
          ev?: number | null
          id?: string
          k_mom?: number | null
          minute_in?: number | null
          mom_z?: number | null
          outcome?: string | null
          pair: string
          raw_score?: number | null
          reason?: string | null
          seconds_in: number
          settled_at?: string | null
          settled_spot?: number | null
          sigma_dist?: number | null
          skew?: number | null
          source?: string
          spot?: number | null
          spot_mom?: number | null
          spread?: number | null
          strategy_version?: string
          strike?: number | null
          strike_type?: string | null
          ts?: string
          verdict: string
          yes_mid?: number | null
        }
        Update: {
          calibrated?: number | null
          candle_id?: number
          conf?: number | null
          cushion_score?: number | null
          depth?: number | null
          dir?: string | null
          entry_price?: number | null
          ev?: number | null
          id?: string
          k_mom?: number | null
          minute_in?: number | null
          mom_z?: number | null
          outcome?: string | null
          pair?: string
          raw_score?: number | null
          reason?: string | null
          seconds_in?: number
          settled_at?: string | null
          settled_spot?: number | null
          sigma_dist?: number | null
          skew?: number | null
          source?: string
          spot?: number | null
          spot_mom?: number | null
          spread?: number | null
          strategy_version?: string
          strike?: number | null
          strike_type?: string | null
          ts?: string
          verdict?: string
          yes_mid?: number | null
        }
        Relationships: []
      }
      trade_log: {
        Row: {
          agent: string | null
          bankroll_applied_at: string | null
          calibrated: number | null
          candle_id: number
          conf: number | null
          contracts: number | null
          council: boolean
          dir: string
          entry_price: number | null
          exit_at: string | null
          exit_contracts: number | null
          exit_order_id: string | null
          exit_price: number | null
          exit_reason: string | null
          id: string
          lock_id: string | null
          mode: string
          msg: string | null
          order_id: string | null
          outcome: string | null
          pair: string
          pnl: number | null
          proposal_id: string | null
          quote_age_ms: number | null
          requested_contracts: number | null
          settle_attempts: number
          settle_checked_at: string | null
          settled_at: string | null
          source: string
          stake: number | null
          status: string
          strategy_version: string
          strike: number | null
          strike_type: string | null
          ticker: string | null
          tp_trigger: number | null
          ts: string
          visible_depth: number | null
        }
        Insert: {
          agent?: string | null
          bankroll_applied_at?: string | null
          calibrated?: number | null
          candle_id: number
          conf?: number | null
          contracts?: number | null
          council?: boolean
          dir: string
          entry_price?: number | null
          exit_at?: string | null
          exit_contracts?: number | null
          exit_order_id?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          lock_id?: string | null
          mode: string
          msg?: string | null
          order_id?: string | null
          outcome?: string | null
          pair: string
          pnl?: number | null
          proposal_id?: string | null
          quote_age_ms?: number | null
          requested_contracts?: number | null
          settle_attempts?: number
          settle_checked_at?: string | null
          settled_at?: string | null
          source?: string
          stake?: number | null
          status: string
          strategy_version?: string
          strike?: number | null
          strike_type?: string | null
          ticker?: string | null
          tp_trigger?: number | null
          ts?: string
          visible_depth?: number | null
        }
        Update: {
          agent?: string | null
          bankroll_applied_at?: string | null
          calibrated?: number | null
          candle_id?: number
          conf?: number | null
          contracts?: number | null
          council?: boolean
          dir?: string
          entry_price?: number | null
          exit_at?: string | null
          exit_contracts?: number | null
          exit_order_id?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          lock_id?: string | null
          mode?: string
          msg?: string | null
          order_id?: string | null
          outcome?: string | null
          pair?: string
          pnl?: number | null
          proposal_id?: string | null
          quote_age_ms?: number | null
          requested_contracts?: number | null
          settle_attempts?: number
          settle_checked_at?: string | null
          settled_at?: string | null
          source?: string
          stake?: number | null
          status?: string
          strategy_version?: string
          strike?: number | null
          strike_type?: string | null
          ticker?: string | null
          tp_trigger?: number | null
          ts?: string
          visible_depth?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_bot_run_lease: {
        Args: { p_lease_id: string; p_lease_seconds?: number }
        Returns: boolean
      }
      apply_paper_bankroll: {
        Args: { p_fee_per_contract?: number }
        Returns: {
          applied: number
          bankroll: number
          delta: number
        }[]
      }
      apply_paper_bankroll_v2: {
        Args: { p_fee_per_contract: number }
        Returns: {
          applied: number
          bankroll: number
          delta: number
        }[]
      }
      bot_risk_snapshot: {
        Args: { p_day_start: string }
        Returns: {
          open_risk: number
          settled_pnl: number
        }[]
      }
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
