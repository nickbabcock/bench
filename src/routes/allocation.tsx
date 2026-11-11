import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/navigation/SiteShell";
import { Allocation } from "@/features/allocation";

export const Route = createFileRoute("/allocation")({
  head: () => ({
    meta: [{ title: "Rust allocators · WASM Bench" }],
  }),
  component: AllocationPage,
});

function AllocationPage() {
  return (
    <SiteShell>
      <Allocation />
    </SiteShell>
  );
}
