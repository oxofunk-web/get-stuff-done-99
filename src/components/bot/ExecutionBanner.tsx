/** Paper execution with real market data, never real-money orders. */
export function ExecutionBanner() {
  return (
    <div className="border-t border-gold/40 bg-gold/10">
      <div className="mx-auto max-w-[1180px] px-4 py-1.5 text-[9px] font-bold tracking-widest text-gold">
        PAPER MODE · REAL MARKET — simulated trades only, no real-money orders.
      </div>
    </div>
  );
}
