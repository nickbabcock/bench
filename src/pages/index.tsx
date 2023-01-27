import { GithubIcon } from "@/components/icons";
import { PageHead } from "@/components/PageHead";
import { Compression } from "@/features/compression";
import { Allocation } from "@/features/worker";
import type { NextPage } from "next";
import Link from "next/link";

const Home: NextPage = () => {
  return (
    <main className="p-4">
      <div className="mx-auto max-w-prose space-y-16 divide-y-8">
        <PageHead />
        <div className="grid grid-cols-[1fr_32px] gap-2 md:gap-6">
          <h1 className="text-2xl font-bold">Benchmarks</h1>
          <div>
            <Link
              target="_blank"
              href="https://github.com/nickbabcock/wasm-bench"
            >
              <GithubIcon alt="Benchmarks website Github Repo" />
            </Link>
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-bold">Compression</h2>
          <p className="text-lg">
            The compression benchmark allows one to locally run round-trip
            compression statistics of a given file using various libraries and
            codecs. All libraries are either native Browser APIs, a Javascript
            library, or a Rust library compiled to Wasm, and may exhibit
            differences in runtime depending on the platform or browser. See{" "}
            <Link href="https://nickb.dev" target="_blank">
              blog post
            </Link>{" "}
            for background.
          </p>
          <Compression />
        </div>
        <div>
          <h2 className="mb-2 text-lg font-bold">Allocation</h2>
          <p className="text-lg">
            The allocation benchmark measures how long it takes to allocate a
            given number of vectors with 5 strings of input. Stresses Browser's
            malloc implementation and dlmalloc.
          </p>
          <Allocation />
        </div>
      </div>
    </main>
  );
};

export default Home;
