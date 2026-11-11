import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/navigation/SiteShell";
import { Memory64 } from "@/features/memory64";

export const Route = createFileRoute("/memory64")({
  head: () => ({
    meta: [{ title: "Memory64 · WASM Bench" }],
  }),
  component: Memory64Page,
});

function Memory64Page() {
  return (
    <SiteShell>
      <Memory64 />
    </SiteShell>
  );
}
