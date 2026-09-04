export function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "yes" | "no" | "gold";
}) {
  const color = tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : tone === "gold" ? "text-gold" : "text-hi";
  return (
    <div className="min-w-0 border-r border-wire px-3 py-2.5 last:border-r-0">
      <div className={`truncate font-sans text-[16px] font-extrabold leading-none ${color}`}>{value}</div>
      <div className="mt-1 text-[7px] font-bold tracking-[0.18em] text-dim">{label}</div>
    </div>
  );
}