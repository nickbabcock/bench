import { PRACTICAL_FLOOR } from "@/lib/stats";

const floor = `${PRACTICAL_FLOOR * 100}%`;

/** Allocation's workload and the allocator's share; the Allocation page links to #allocation-workload. */
export const AllocationWorkload = () => (
  <div id="allocation-workload" className="scroll-mt-4 [&>*+*]:mt-3">
    <p>
      The workload processes the 21 XML documents in the Silesia corpus&apos;s xml file (a tar) one at a time, largest first, so memory
      kept from a large document shows when smaller ones follow. For each document:
    </p>
    <ol className="list-decimal pl-5 marker:text-ink-3 [&_li+li]:mt-1.5">
      <li>Parse it into an owned tree, copying names, attribute values and text and growing child lists by push.</li>
      <li>
        Walk the tree, creating and freeing a path string per element, a normalised copy of each attribute value and a word list per
        text node. Fold everything into a checksum that every build must match.
      </li>
      <li>
        Keep a small survivor set (interned tag names and recent per-document summaries, trimmed now and then) in the global
        allocator, in all four builds.
      </li>
      <li>Drop the tree.</li>
    </ol>
    <p>
      dlmalloc and talc serve everything as the global allocator. Each arena build keeps one arena for the module&apos;s lifetime;
      after every document it drops the tree and resets the arena. The arena&apos;s chunks come from dlmalloc.
    </p>
    <p>
      All four builds run the same code on allocator-api2&apos;s collections;{" "}
      <a href="https://github.com/bluurryy/bump-scope/discussions/108">bump-scope discussion 108</a> explains why.
    </p>
    <p>
      <b className="font-semibold">Timing and pairing.</b> A sample times whole batches of every document, cleanup included (dropping
      each tree and, for arenas, the reset), divided by the number of documents. All four allocators run in every round, so a
      comparison within a class, talc against dlmalloc or bump-scope against bumpalo, is a paired ratio under the {floor} claim rule.
      The cold first batch, which pays for <code>memory.grow</code>, is reported apart.
    </p>
    <p>
      <b className="font-semibold">Heap pages.</b> Linear memory grows in 64 KiB pages and never shrinks: pages are kept for the
      module instance&apos;s lifetime, counted over a fixed sequence on a fresh instance.
    </p>
    <p>
      <b className="font-semibold">The allocator&apos;s share.</b> An untimed counting pass records each build&apos;s allocator calls
      in one batch (allocations, grows, frees and bytes requested). Changing the allocator also changes memory layout, locality and
      copying, so the page compares whole-application times and does not split out an allocator&apos;s share.
    </p>
    <p>
      <b className="font-semibold">Classes.</b> dlmalloc and talc are general-purpose: each allocation is freed on its own and reused.
      bumpalo and bump-scope are arenas: everything is freed at once on reset, so memory only grows until then. The classes do
      different jobs, so allocators are compared only within a class.
    </p>
  </div>
);
