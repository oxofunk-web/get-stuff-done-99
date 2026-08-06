import { createFileRoute, ClientOnly } from "@tanstack/react-router";

import { Dashboard } from "@/components/bot/Dashboard";

const title = "Kalshi Auto 15M Bot — BRTI Lag Engine";
const description =
  "Automated 15-minute Kalshi crypto trading console: real-time BRTI spot feed, live YES/NO orderbooks, 80%+ confidence signals, paper and live order execution.";

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
