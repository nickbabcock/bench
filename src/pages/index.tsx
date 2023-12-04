import { GithubIcon } from "@/components/icons";
import { PageHead } from "@/components/PageHead";
import { Compression } from "@/features/compression";
import { Allocation } from "@/features/allocation";
import type { NextPage } from "next";
import Link from "next/link";

const Home: NextPage = () => {
  return (
    <main className="p-4">
      <div className="space-y-16">
        <PageHead />
        <div className="mx-auto grid max-w-prose grid-cols-[1fr_32px] gap-2 md:gap-6">
          <h1 className="text-2xl font-bold">Benchmarks</h1>
          <div>
            <Link target="_blank" href="https://github.com/nickbabcock/bench">
              <GithubIcon alt="Benchmarks website Github Repo" />
            </Link>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="mx-auto max-w-prose">
            <h2 className="mb-2 text-lg font-bold">Compression</h2>
            <p className="text-lg">
              The compression benchmark allows one to locally run round-trip
              compression statistics on a given file. All libraries are either
              native Browser APIs, a Javascript library, or a Rust library
              compiled to Wasm. Runtime performance will differ from native
              execution, the length of input, and the{" "}
              <Link
                href="https://00f.net/2023/01/04/webassembly-benchmark-2023/"
                target="_blank"
              >
                Wasm runtime
              </Link>
              . See{" "}
              <Link
                href="https://nickb.dev/blog/wasm-compression-benchmarks-and-the-cost-of-missing-compression-apis/"
                target="_blank"
              >
                blog post
              </Link>{" "}
              for more info.
            </p>
          </div>
          <Compression />
        </div>
        <div>
          <div className="mx-auto max-w-prose">
            <h2 className="mb-2 text-lg font-bold">Allocation</h2>
            <p className="text-lg">
              The allocation benchmark measures how long it takes to allocate a
              given number of vectors with 5 strings of input. Stresses the
              malloc implementation in browsers and dlmalloc in Rust.
            </p>
            <Allocation />
          </div>
        </div>
      </div>
    </main>
  );
};

export default Home;
