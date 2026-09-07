import { useCallback, useEffect, useState } from "react";

import { getCoachNote, runCoach, type CoachNote } from "@/lib/bot/coach.functions";

/**
 * The bot's own review of its recorded day: what most likely cost money, the
 * numbers behind it, and one change to make. Advice only — nothing here changes
 * a setting or places a trade.
 */
export function AiCoachPanel() {
  const [note, setNote] = useState<CoachNote | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    void getCoachNote()
      .then((n) => {
        if (!stop) setNote(n);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  const review = useCallback(async () => {
    setBusy(true);
    try {
      setNote(await runCoach());
    } catch (e) {
      setNote({ ok: false, error: e instanceof Error ? e.message : "Review failed" });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <span>AI Review — what the numbers say</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void review()}
          className="rounded border border-wire px-1.5 py-px text-[7px] tracking-widest text-dim hover:border-dim hover:text-muted-foreground disabled:opacity-50"
        >
          {busy ? "READING…" : "REVIEW NOW"}
        </button>
      </div>

      <div className="p-2.5">
        {!note?.ok ? (
          <p className="text-[9px] leading-relaxed text-dim">
            {note?.error ?? "No review yet."} Press REVIEW NOW and the bot reads its last day of
            decisions and outcomes, then reports what cost money.
          </p>
        ) : (
          <>
            {note.ts ? (
              <div className="text-[7px] tracking-[0.2em] text-dim">
                {new Date(note.ts).toLocaleString()}
              </div>
            ) : null}
            <p className="mt-1 text-[11px] font-bold leading-snug text-hi">{note.headline}</p>
            <div className="mt-2 space-y-2">
              {(note.findings ?? []).map((f, i) => (
                <div key={i} className="rounded-md border border-wire bg-surface-2 p-2">
                  <p className="text-[9px] font-bold text-foreground">{f.claim}</p>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
                    {f.evidence}
                  </p>
                  <p className="mt-1 text-[9px] leading-relaxed text-gold">→ {f.action}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
