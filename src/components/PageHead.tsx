import Head from "next/head";

interface PageHeadProps {
  children?: React.ReactNode;
}

export const PageHead = ({ children }: PageHeadProps) => {
  return (
    <Head>
      <title>Benchmarks</title>
      <meta
        name="Description"
        content="Run benchmarks locally with Wasm. Benchmark zstd, brotli, deflate, and lz4"
      />
      <meta name="color-scheme" content="dark light" />
      {children}
    </Head>
  );
};
