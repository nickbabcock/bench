"use client";

import { BenchmarkLayout } from "@/components/navigation/BenchmarkLayout";
import { Allocation } from "@/features/allocation";

export default function AllocationPage() {
  return (
    <BenchmarkLayout title="Allocation Benchmarks">
      <Allocation />
    </BenchmarkLayout>
  );
}
