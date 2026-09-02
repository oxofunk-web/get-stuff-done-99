import { AccuracyPanel } from "./AccuracyPanel";
import { BrtiPanel } from "./BrtiPanel";
import { ClockPanel } from "./ClockPanel";
import { EnginePanel } from "./EnginePanel";
import { LogPanel } from "./LogPanel";
import { MarketsPanel } from "./MarketsPanel";
import { PnlPanel } from "./PnlPanel";
import { ServerBotPanel } from "./ServerBotPanel";
import { SignalsPanel } from "./SignalsPanel";
import { useBot } from "@/hooks/useBot";

export function Dashboard() {
  const bot = useBot();
  const ticker = bot.markets.BTC?.ticker ?? null;

  return (
    <div className="relative z-1 min-h-screen">
      {bot.toast ? (
        <div
          className={`animate-slide-down fixed inset-x-0 top-0 z-50 px-4 py-2.5 text-center font-sans text-[12px] font-extrabold ${
            bot.toast.tone === "yes"
              ? "bg-yes text-background"
              : bot.toast.tone === "no"
                ? "bg-no text-hi"
                : "bg-gold text-background"
          }`}
        >
          {bot.toast.msg}
        </div>
      ) : null}

      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-wire bg-background/95 px-3.5 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${bot.botOn ? "animate-blink bg-yes" : "bg-dim"}`}
          />
          <div>
            <h1 className="font-sans text-[14px] font-extrabold text-hi">KALSHI AUTO · 15M BOT</h1>
            <p className="text-[7px] tracking-[0.25em] text-muted-foreground">
              BRTI LAG ENGINE · {bot.mode === "live" ? "LIVE MONEY" : "PAPER"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
          {[
            { v: String(bot.sigCount), l: "SIGNALS" },
            { v: String(bot.placedCount), l: "PLACED" },
            { v: `$${bot.exposure}`, l: "EXPOSURE" },
            {
              v: `${bot.realized + bot.unrealized < 0 ? "-" : "+"}$${Math.abs(bot.realized + bot.unrealized).toFixed(2)}`,
              l: "P&L",
            },
            {
              v: bot.walletBalance !== null ? `$${bot.walletBalance.toFixed(2)}` : "—",
              l: "WALLET",
            },
          ].map((s) => (
            <div key={s.l} className="text-center">
              <div className="font-sans text-[15px] font-extrabold leading-none text-hi">{s.v}</div>
              <div className="mt-0.5 text-[7px] tracking-[0.2em] text-dim">{s.l}</div>
            </div>
          ))}
        </div>
      </header>

      <main className="mx-auto grid max-w-[960px] gap-3 p-3 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <BrtiPanel
            spot={bot.spot}
            markets={bot.markets}
            history={bot.history}
            status={bot.feedStatus}
            source={bot.feedSource}
          />
          <ClockPanel candle={bot.candle} ticker={ticker} />
          <PnlPanel
            mode={bot.mode}
            portfolio={bot.portfolio}
            balance={bot.walletBalance}
            realized={bot.realized}
            unrealized={bot.unrealized}
            dayPnl={bot.dayPnl}
            dailyLossCap={bot.dailyLossCap}
            onDailyLossCap={bot.setDailyLossCap}
            capHit={bot.capHit}
            open={bot.open}
            wins={bot.wins}
            losses={bot.losses}
            onRefresh={() => void bot.refreshPortfolio()}
          />
          <MarketsPanel markets={bot.markets} ok={bot.marketsOk} mode={bot.mode} />
        </div>

        <div className="flex flex-col gap-3">
          <EnginePanel
            candle={bot.candle}
            mode={bot.mode}
            onModeChange={(m) => void bot.switchMode(m)}
            botOn={bot.botOn}
            onToggle={bot.toggleBot}
            betSize={bot.betSize}
            onBetSize={bot.setBetSize}
            placedCount={bot.placedCount}
            exposure={bot.exposure}
            lastTrade={bot.lastTrade}
            tradedThisCandle={bot.tradedThisCandle}
            live={bot.live}
            evMargin={bot.evMargin}
            onEvMargin={bot.setEvMargin}
          />
          <ServerBotPanel />
          <SignalsPanel signals={bot.signals} candle={bot.candle} tradeStatus={bot.tradeStatus} />
          <AccuracyPanel
            accuracy={bot.accuracy}
            rejections={bot.rejections}
            onRefresh={() => void bot.refreshAccuracy()}
          />

          <LogPanel log={bot.log} />
        </div>
      </main>

      <footer className="mx-auto max-w-[960px] px-3 pb-6">
        <p className="rounded-md border border-wire bg-surface p-3 text-[9px] leading-relaxed text-muted-foreground">
          ⚠️ <strong className="text-foreground">AUTO-TRADING:</strong> real-time BRTI proxy via
          Binance WebSocket (a constituent exchange), Kalshi REST for the YES/NO orderbook. Trades
          fire automatically after the 10:00 mark at ≥86% confidence, up to one per pair (4 max) per 15-minute candle. Lag
          detection compares BRTI spot momentum against Kalshi price direction — divergence is the
          edge. Paper mode simulates fills on live books; live mode submits real fill-or-kill orders
          signed server-side. Not financial advice. Kalshi is CFTC-regulated.
        </p>
      </footer>
    </div>
  );
}