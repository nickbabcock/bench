import { createFileRoute } from "@tanstack/react-router";
import { BenchmarkLayout } from "@/components/navigation/BenchmarkLayout";
import { Compression } from "@/features/compression/Compression";

export const Route = createFileRoute("/compression")({
  head: () => ({
    meta: [{ title: "Compression Benchmarks | WASM Benchmarks" }],
  }),
  component: CompressionPage,
});

function CompressionPage() {
  return (
    <BenchmarkLayout title="Compression Benchmarks">
      <Compression />
    </BenchmarkLayout>
  );
}
