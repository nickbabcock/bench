import { Memory64Form } from "./Memory64Form";

const ExternalLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => (
  <a
    href={href}
    className="text-blue-600 underline dark:text-blue-400"
    target="_blank"
    rel="noopener noreferrer"
  >
    {children}
  </a>
);

export const Memory64 = () => {
  return (
    <div className="space-y-8">
      <p className="text-center text-gray-700 dark:text-gray-300">
        Run the same Rust code built for wasm32 and for wasm64 (memory64) to see
        what 64-bit linear memory costs.
      </p>

      <div className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:p-8 dark:border-gray-700 dark:bg-gray-800">
        <Memory64Form />
      </div>

      <div className="mx-auto max-w-3xl space-y-4 text-gray-700 dark:text-gray-300">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Why memory64 can be slower
        </h3>

        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Bounds checks:</strong> On 64-bit hosts, engines reserve 4
            GiB of address space for a wasm32 memory, so most bounds checks can
            be left out. A 64-bit index can't be handled that way, so every load
            and store pays for an explicit check. The SpiderMonkey team{" "}
            <ExternalLink href="https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html">
              measured slowdowns
            </ExternalLink>{" "}
            ranging from 10% to over 100%, depending on the workload.
          </li>
          <li>
            <strong>Bigger pointers:</strong> <code>usize</code> and pointers
            grow from 4 to 8 bytes. Pointer-heavy data such as <code>Vec</code>{" "}
            headers, hash map entries, and ECS archetype and table metadata gets
            bigger, so it uses more memory and cache. The peak memory column
            shows this.
          </li>
          <li>
            <strong>What you get in return:</strong> wasm32 can address at most
            4 GiB. The WebAssembly JS API caps memory64 at 16 GiB.
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Methodology
        </h3>

        <ul className="list-disc space-y-2 pl-6">
          <li>
            Both modules come from the same crate, built with the same pinned
            nightly Rust compiler, flags, and <code>wasm-opt</code> pass. Both
            builds compile std from source with <code>-Zbuild-std</code>,
            because <code>wasm64-unknown-unknown</code> is a tier 3 target with
            no prebuilt std. The target is the only difference.
          </li>
          <li>
            Inputs come from a fixed seed, so both builds do the same work. The
            Output column checks that the checksums from every sample are
            identical.
          </li>
          <li>
            Each workload starts in a fresh worker. Both builds load and prepare
            their inputs untimed before either runs. A shared repetition count
            is then calibrated so each timed sample lasts tens of milliseconds,
            and the builds alternate untimed warm-up rounds (at least half a
            second in total) so the JIT can tier up. Timed samples also
            alternate which build goes first.
          </li>
          <li>
            Memory64 shipped in Chrome 133 and Firefox 134. Results differ
            between engines, so test the browsers you're targeting.
          </li>
        </ul>
      </div>
    </div>
  );
};
