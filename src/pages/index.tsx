import { Allocation } from "@/features/worker";
import type { NextPage } from "next";

const Home: NextPage = () => {
  return (
    <main>
      <h1>Wasm Benchmark</h1>

      <Allocation />
      <style jsx>{`
        main {
          max-width: var(--size-content-3);
          margin: 0 auto;
        }
      `}</style>
    </main>
  );
};

export default Home;
