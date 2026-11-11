import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { SiteShell } from "@/components/navigation/SiteShell";

/**
 * Unlinked gallery of the release components and chart primitives, with
 * fixture data. Dev builds only: in production `import.meta.env.DEV` is
 * false, so the gallery and its fixtures are dropped from the bundle, the
 * route is a 404, and nothing links to it for the prerender to find.
 */
const DevKit = import.meta.env.DEV ? lazy(() => import("@/features/devkit/DevKit").then((m) => ({ default: m.DevKit }))) : null;

export const Route = createFileRoute("/dev-kit")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound();
    }
  },
  head: () => ({
    meta: [{ title: "Component kit · WASM Bench" }, { name: "robots", content: "noindex" }],
  }),
  component: DevKitPage,
});

function DevKitPage() {
  return (
    <SiteShell>
      {DevKit ? (
        <Suspense fallback={null}>
          <DevKit />
        </Suspense>
      ) : null}
    </SiteShell>
  );
}
