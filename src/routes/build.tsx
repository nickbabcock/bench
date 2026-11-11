import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/navigation/SiteShell";
import { Build } from "@/features/build";

export const Route = createFileRoute("/build")({
  head: () => ({
    meta: [{ title: "Build settings · WASM Bench" }],
  }),
  component: BuildPage,
});

function BuildPage() {
  return (
    <SiteShell>
      <Build />
    </SiteShell>
  );
}
