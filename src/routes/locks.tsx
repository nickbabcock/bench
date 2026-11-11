import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/navigation/SiteShell";
import { Locks } from "@/features/locks";

export const Route = createFileRoute("/locks")({
  head: () => ({
    meta: [{ title: "RefCell vs Mutex · WASM Bench" }],
  }),
  component: LocksPage,
});

function LocksPage() {
  return (
    <SiteShell>
      <Locks />
    </SiteShell>
  );
}
