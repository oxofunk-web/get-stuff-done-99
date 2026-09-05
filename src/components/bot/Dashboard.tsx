import { useState } from "react";
import { AccuracyPanel } from "./AccuracyPanel";
import { BrtiPanel } from "./BrtiPanel";
import { ClockPanel } from "./ClockPanel";
import { EnginePanel } from "./EnginePanel";
import { LogPanel } from "./LogPanel";
import { MarketsPanel } from "./MarketsPanel";
import { PairEdgePanel } from "./PairEdgePanel";
import { PnlPanel } from "./PnlPanel";
import { ServerBotPanel } from "./ServerBotPanel";
import { SignalsPanel } from "./SignalsPanel";
import { useBot } from "@/hooks/useBot";

type Workspace = "overview" | "control" | "trades" | "analytics";

const WORKSPACES: { id: Workspace; label: string; short: string }[] = [
  { id: "overview", label: "Overview", short: "Home" },
  { id: "control", label: "Bot Control", short: "Control" },
  { id: "trades", label: "Trades & P&L", short: "Trades" },
  { id: "analytics", label: "Analytics", short: "Analytics" },
];

export function Dashboard() {
  const bot = useBot();
  const ticker = bot.markets.BTC?.ticker ?? null;
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  const pnl = bot.realized + bot.unrealized;

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

      {bot.capHit ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-no/40 bg-no/15 px-3.5 py-2.5">
          <div>
            <div className="font-sans text-[12px] font-extrabold text-no">
              DAY STOPPED — loss cap -${bot.dailyLossCap} reached
            </div>
            <div className="text-[9px] text-muted-foreground">
              Today {bot.dayPnl < 0 ? "-" : "+"}${Math.abs(bot.dayPnl).toFixed(2)} · auto-trading is
              off until you reset the day or it rolls over at midnight.
            </div>
          </div>
          <button
            type="button"
            onClick={bot.resetDay}
            className="rounded-md border border-no/60 bg-no/20 px-3 py-1.5 font-sans text-[10px] font-bold tracking-widest text-no"
          >
            RESET DAY
          </button>
        </div>
      ) : null}

      <header className="sticky top-0 z-40 border-b border-wire bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`size-1.5 rounded-full ${bot.botOn ? "animate-blink bg-yes" : "bg-dim"}`}
          />
          <div>
            <h1 className="truncate font-sans text-[15px] font-extrabold text-hi">KALSHI AUTO</h1>
            <p className="text-[7px] tracking-[0.25em] text-muted-foreground">
              15M EXECUTION DESK · LIVE MONEY
            </p>
          </div>
        </div>
        <div className={`shrink-0 rounded-md border px-2.5 py-1 font-sans text-[9px] font-extrabold tracking-wider ${bot.botOn ? "border-yes/40 bg-yes/10 text-yes" : "border-wire bg-surface-2 text-dim"}`}>
          {bot.botOn ? "BOT ACTIVE" : "BOT OFF"}
        </div>
        </div>
        <div className="border-t border-wire/70 bg-surface/70">
          <div className="mx-auto grid max-w-[1180px] grid-cols-5">
            <div className="border-r border-wire px-3 py-2.5"><div className="font-sans text-[16px] font-extrabold leading-none text-hi">{bot.walletBalance !== null ? `$${bot.walletBalance.toFixed(2)}` : "—"}</div><div className="mt-1 text-[7px] font-bold tracking-[.18em] text-dim">WALLET</div></div>
            <div className="border-r border-wire px-3 py-2.5"><div className={`font-sans text-[16px] font-extrabold leading-none ${pnl < 0 ? "text-no" : "text-yes"}`}>{pnl < 0 ? "−" : "+"}${Math.abs(pnl).toFixed(2)}</div><div className="mt-1 text-[7px] font-bold tracking-[.18em] text-dim">TOTAL P&amp;L</div></div>
            <div className="border-r border-wire px-3 py-2.5"><div className="font-sans text-[16px] font-extrabold leading-none text-hi">{bot.sigCount}</div><div className="mt-1 text-[7px] font-bold tracking-[.18em] text-dim">SIGNALS</div></div>
            <div className="border-r border-wire px-3 py-2.5"><div className="font-sans text-[16px] font-extrabold leading-none text-hi">{bot.placedCount}</div><div className="mt-1 text-[7px] font-bold tracking-[.18em] text-dim">PLACED</div></div>
            <div className="px-3 py-2.5"><div className="font-sans text-[16px] font-extrabold leading-none text-gold">${bot.exposure}</div><div className="mt-1 text-[7px] font-bold tracking-[.18em] text-dim">EXPOSURE</div></div>
          </div>
        </div>
      </header>

      <nav className="mx-auto hidden max-w-[1180px] gap-1 px-4 pt-4 sm:flex" aria-label="Dashboard workspaces">
        {WORKSPACES.map((item) => <button key={item.id} type="button" onClick={() => setWorkspace(item.id)} className={`rounded-md px-4 py-2 font-sans text-[10px] font-bold tracking-wider transition-colors ${workspace === item.id ? "bg-hi text-background" : "border border-wire bg-surface text-dim hover:text-hi"}`}>{item.label}</button>)}
      </nav>

      <main className="mx-auto max-w-[1180px] p-3 pb-24 sm:p-4 sm:pb-8">
        {workspace === "overview" ? <div className="grid gap-3 lg:grid-cols-12">
          <div className="flex flex-col gap-3 lg:col-span-7">
          <BrtiPanel
            spot={bot.spot}
            markets={bot.markets}
            history={bot.history}
            status={bot.feedStatus}
            source={bot.feedSource}
          />
          <ClockPanel candle={bot.candle} ticker={ticker} />
          <MarketsPanel
            markets={bot.markets}
            ok={bot.marketsOk}
            health={bot.marketsHealth}
            onRetry={bot.retryMarkets}
          />

          </div>
          <div className="flex flex-col gap-3 lg:col-span-5">
            <ServerBotPanel />
            <SignalsPanel signals={bot.signals} candle={bot.candle} pairStatus={bot.pairStatus} />
          </div>
        </div> : null}

        {workspace === "control" ? <div className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-7"><EnginePanel
            candle={bot.candle} botOn={bot.botOn}
            onToggle={bot.toggleBot} betSize={bot.betSize} onBetSize={bot.setBetSize} maxTrades={bot.maxTrades}
            onMaxTrades={bot.setMaxTrades} placedCount={bot.placedCount} exposure={bot.exposure} lastTrade={bot.lastTrade}
            tradedThisCandle={bot.tradedThisCandle} live={bot.live} evMargin={bot.evMargin} onEvMargin={bot.setEvMargin}
            gates={bot.gates} gatePreset={bot.gatePreset} onGatePreset={bot.setGatePreset} onGate={bot.setGate}
            blocks={bot.server?.blocks ?? []}
            dayPnl={bot.dayPnl} dailyLossCap={bot.dailyLossCap} capHit={bot.capHit} onResetDay={bot.resetDay}
          /></div>
          <div className="flex flex-col gap-3 lg:col-span-5"><ServerBotPanel /><ClockPanel candle={bot.candle} ticker={ticker} /></div>
        </div> : null}

        {workspace === "trades" ? <div className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-7"><PnlPanel
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
          /></div>
          <div className="flex flex-col gap-3 lg:col-span-5"><LogPanel log={bot.log} /><ServerBotPanel /></div>
        </div> : null}

        {workspace === "analytics" ? <div className="grid gap-3 lg:grid-cols-12">
          <div className="flex flex-col gap-3 lg:col-span-7">
          <SignalsPanel
            signals={bot.signals}
            candle={bot.candle}
            pairStatus={bot.pairStatus}
          />
          <PairEdgePanel accuracy={bot.accuracy} betSize={bot.betSize} />
          </div>
          <div className="flex flex-col gap-3 lg:col-span-5">
          <AccuracyPanel
            accuracy={bot.accuracy}
            rejections={bot.rejections}
            onRefresh={() => void bot.refreshAccuracy()}
          />
          <LogPanel log={bot.log} />
          </div>
        </div> : null}
      </main>

      <footer className="mx-auto max-w-[1180px] px-3 pb-24 sm:pb-6">
        <p className="rounded-md border border-wire bg-surface p-3 text-[9px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">AUTO-TRADING:</strong> real-time spot via Coinbase
          Exchange with Binance fallback, plus Kalshi REST for the YES/NO orderbook. One
          engine places trades: the server bot, which keeps running even with this app closed. It
          fires after the 10:00 mark at ≥86% confidence, up to one per pair (4 max) per 15-minute
          candle. Lag detection compares BRTI spot momentum against Kalshi price direction —
          divergence is the edge. Live mode submits real immediate-or-cancel limit orders signed
          server-side. Not financial advice. Kalshi is CFTC-regulated.
        </p>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-wire bg-background/98 px-1 pb-[max(.35rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur sm:hidden" aria-label="Dashboard workspaces">
        {WORKSPACES.map((item) => <button key={item.id} type="button" onClick={() => setWorkspace(item.id)} className={`rounded-md px-1 py-2.5 font-sans text-[8px] font-bold tracking-wide ${workspace === item.id ? "bg-hi text-background" : "text-dim"}`}>{item.short}</button>)}
      </nav>
    </div>
  );
}