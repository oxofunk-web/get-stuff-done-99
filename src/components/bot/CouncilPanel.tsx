import { useEffect, useState } from "react";

import { getCouncil, setCouncilHalt } from "@/lib/council.functions";

type State = Awaited<ReturnType<typeof getCouncil>>;
type Vote = { agent: string; vote: string };

/** Council live queue: proposals, squad votes, Bank decision, fills, P&L. */
export function CouncilPanel() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => getCouncil().then(setS).catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const toggle = async () => {
    const halt = !s?.halted;
    if (!halt && !window.confirm("Resume council trading with REAL money?")) return;
    setBusy(true);
    try {
      setS(await setCouncilHalt({ data: { halted: halt } }));
    } catch {
      window.alert("Couldn't save — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel mt-3">
      <div className="panel-head">
        <span>Council · live</span>
        <button
          type="button"
          disabled={busy || !s}
          onClick={() => void toggle()}
          className={`rounded border px-2 py-px text-[9px] font-bold tracking-widest ${
            s?.halted ? "border-gold/50 bg-gold/15 text-gold" : "border-no/50 bg-no/15 text-no"
          }`}
        >
          {s?.halted ? "RESUME COUNCIL" : "HALT COUNCIL"}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-3 px-3 py-2 text-[9px] tracking-widest text-muted-foreground">
        <span>
          SPENT <b className="text-foreground">${(s?.spent ?? 0).toFixed(2)}</b> / ${s?.budget ?? 10}
        </span>
        <span>
          P&L{" "}
          <b style={{ color: (s?.pnl ?? 0) >= 0 ? "var(--yes)" : "var(--no)" }}>
            {(s?.pnl ?? 0) >= 0 ? "+" : "−"}${Math.abs(s?.pnl ?? 0).toFixed(2)}
          </b>
        </span>
        <span>
          OPEN <b className="text-foreground">{s?.open ?? 0}</b>/3
        </span>
        {s?.halted ? <span className="text-gold">HALTED</span> : null}
        {s?.lossHalted ? <span className="text-no">LOSS HALT · until next UTC day</span> : null}
      </div>
      <div className="max-h-80 divide-y divide-wire overflow-y-auto border-t border-wire">
        {!s?.proposals.length ? (
          <div className="px-3 py-2 text-[9px] text-dim">No proposals yet.</div>
        ) : null}
        {(s?.proposals ?? []).map((p) => {
          const votes = (Array.isArray(p.votes) ? p.votes : []) as Vote[];
          const bank = p.bank_decision as { approve?: boolean; reason?: string } | null;
          return (
            <div key={p.id} className="space-y-0.5 px-3 py-1.5 text-[10px]">
              <div className="flex items-center gap-2">
                <b className="font-sans text-foreground">{p.market}</b>
                <span className={p.side === "yes" ? "text-yes" : "text-no"}>{p.side.toUpperCase()} ≤{p.entry_target}¢</span>
                <span className="text-dim">{p.proposing_agent} · {Math.round(Number(p.confidence) * 100)}%</span>
                <span className="ml-auto text-[8px] font-bold tracking-widest text-gold">{p.status.toUpperCase()}</span>
              </div>
              <div className="text-muted-foreground">{p.thesis}</div>
              {votes.length ? (
                <div className="text-[9px] text-dim">
                  Votes: {votes.map((v) => `${v.agent} ${v.vote}`).join(" · ")}
                </div>
              ) : null}
              {bank ? (
                <div className={`text-[9px] ${bank.approve ? "text-yes" : "text-no"}`}>Bank: {bank.reason}</div>
              ) : null}
              {p.contracts ? (
                <div className="text-[9px] text-foreground">
                  Filled {p.contracts} @ {Math.round(Number(p.fill_price) * 100)}¢ · ${Number(p.stake).toFixed(2)}
                  {p.pnl != null ? ` · ${p.outcome?.toUpperCase()} ${Number(p.pnl) >= 0 ? "+" : "−"}$${Math.abs(Number(p.pnl)).toFixed(2)}` : ""}
                </div>
              ) : p.order_error ? (
                <div className="text-[9px] text-gold">Skipped: {p.order_error}</div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="border-t border-wire px-3 py-2 text-[8px] leading-relaxed text-dim">
        Separate from the main bot: $5 per trade, $10/day budget, max 3 open, halts for the day at −$10. Real money.
      </div>
    </section>
  );
}
