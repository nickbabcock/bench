import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/navigation/SiteShell";
import { Compression } from "@/features/compression/Compression";

export const Route = createFileRoute("/compression")({
  head: () => ({
    meta: [{ title: "Compression codecs in WebAssembly · WASM Bench" }],
  }),
  component: CompressionPage,
});

function CompressionPage() {
  return (
    <SiteShell>
      <Compression />
    </SiteShell>
  );
}
