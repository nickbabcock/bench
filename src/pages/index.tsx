import { GithubIcon } from "@/components/icons";
import { PageHead } from "@/components/PageHead";
import { Allocation } from "@/features/worker";
import type { NextPage } from "next";

const Home: NextPage = () => {
  return (
    <main className="p-4">
      <div className="mx-auto max-w-prose">
        <PageHead />
        <div className="grid grid-cols-[1fr_32px] gap-2 md:gap-6">
          <h1 className="text-2xl font-bold">Benchmarks</h1>
          <div>
            <a href="https://github.com/nickbabcock/wasm-bench">
              <GithubIcon alt="Benchmarks website Github Repo" />
            </a>
          </div>
        </div>
        <Allocation />
      </div>
    </main>
  );
};

export default Home;
