"use client";

import { BenchmarkLayout } from "@/components/navigation/BenchmarkLayout";
import { Compression } from "@/features/compression/Compression";

export default function CompressionPage() {
  return (
    <BenchmarkLayout title="Compression Benchmarks">
      <Compression />
    </BenchmarkLayout>
  );
}
