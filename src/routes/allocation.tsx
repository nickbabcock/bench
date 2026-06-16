import { createFileRoute } from "@tanstack/react-router";
import { BenchmarkLayout } from "@/components/navigation/BenchmarkLayout";
import { Allocation } from "@/features/allocation";

export const Route = createFileRoute("/allocation")({
  head: () => ({
    meta: [{ title: "Allocation Benchmarks | WASM Benchmarks" }],
  }),
  component: AllocationPage,
});

function AllocationPage() {
  return (
    <BenchmarkLayout title="Allocation Benchmarks">
      <Allocation />
    </BenchmarkLayout>
  );
}
