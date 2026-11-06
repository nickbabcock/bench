import { createFileRoute } from "@tanstack/react-router";
import { BenchmarkLayout } from "@/components/navigation/BenchmarkLayout";
import { Memory64 } from "@/features/memory64";

export const Route = createFileRoute("/memory64")({
  head: () => ({
    meta: [{ title: "Memory64 Benchmarks | WASM Benchmarks" }],
  }),
  component: Memory64Page,
});

function Memory64Page() {
  return (
    <BenchmarkLayout title="Memory64 Benchmarks">
      <Memory64 />
    </BenchmarkLayout>
  );
}
