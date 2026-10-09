/** Execution layer: the bot is MANUAL only. Locks form and grade; no orders ever fire. */
export function ExecutionBanner() {
  return (
    <div className="border-t border-gold/40 bg-gold/10">
      <div className="mx-auto max-w-[1180px] px-4 py-1.5 text-[9px] font-bold tracking-widest text-gold">
        MANUAL MODE — locks form and grade, setups appear as trade alerts, no orders will fire.
      </div>
    </div>
  );
}
