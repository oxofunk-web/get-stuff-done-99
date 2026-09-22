import { createFileRoute, ClientOnly } from "@tanstack/react-router";

import { Dashboard } from "@/components/bot/Dashboard";

const title = "BOTTE-BY-OXOFUNK";
const description =
  "Live 15-minute direction reader for Bitcoin, Ethereum, Solana and XRP: each coin's own candlestick chart plus a plain call on whether the candle is finishing up or down, and the chance of it.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly
      fallback={
        <div className="flex min-h-screen items-center justify-center text-[11px] tracking-widest text-dim">
          BOOTING TERMINAL…
        </div>
      }
    >
      <Dashboard />
    </ClientOnly>
  );
}
