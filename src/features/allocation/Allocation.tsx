import { AllocationForm } from "./AllocationForm";

export const Allocation = () => {
  return (
    <div className="space-y-8">
      <p className="text-center text-gray-700 dark:text-gray-300">
        Compare allocation implementations by repeatedly allocating and
        deallocating memory.
      </p>

      <div className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <AllocationForm />
      </div>

      <div className="mx-auto max-w-3xl space-y-4 text-gray-700 dark:text-gray-300">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Things to know about Wasm memory allocation
        </h3>

        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Memory is never reclaimed:</strong> Once allocated, memory
            grows (by factors of 64 KiB) but never shrinks. Deallocated memory
            can be reused by the allocator within the Wasm module, so the overall memory footprint
            remains at its peak usage.
          </li>
          <li>
            <strong>4 GB memory limit:</strong> Wasm uses 32-bit addressing,
            limiting addressable memory to 4 GB. While wasm64 increases this
            to 16 GB, it remains a Tier 3 platform in Rust that lacks
            wasm-bindgen support. Early testing suggests{" "}
            <a
              href="https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html"
              className="text-blue-600 underline dark:text-blue-400"
              target="_blank"
              rel="noopener noreferrer"
            >
              performance degradations
            </a>{" "}
            may accompany wasm64. Small string optimizations may be less
            effective in Wasm than in an 64 bit environment.
          </li>
          <li>
            <strong>Browser differences:</strong> Allocator performance varies
            significantly across browsers. Make sure you test the browsers you
            are targeting!
          </li>
          <li>
            <strong>Allocator customization:</strong> Each Wasm module has its
            own memory allocator. By default, Rust uses a port of dlmalloc,
            but this can be customized to use others (like talc). All
            allocators have an extra layer of indirection when they need more
            memory as interact with the underlying browser allocator via{" "}
            <code>Memory.grow</code>
          </li>
        </ul>

        <p>
          Every run and allocator starts with a fresh heap, so there should be
          no performance differences between runs. This benchmark seeks to
          measure how much faster a bump allocator can be with its ability to
          pre-allocate the total amount of anticipated memory as well as
          coalescing everything into a single drop call.
        </p>
      </div>
    </div>
  );
};
