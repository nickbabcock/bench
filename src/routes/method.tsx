import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/navigation/SiteShell";
import { Method } from "@/features/method/Method";

export const Route = createFileRoute("/method")({
  head: () => ({
    meta: [{ title: "Quality and methodology · WASM Bench" }],
  }),
  component: MethodPage,
});

function MethodPage() {
  return (
    <SiteShell>
      <Method />
    </SiteShell>
  );
}
