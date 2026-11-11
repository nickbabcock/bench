import { Link } from "@tanstack/react-router";
import { MainPoints, Prose, ReleaseBody, ReleaseHeader, Section } from "@/components/release";
import { MAX_REPETITIONS, MAX_WARMUP_ROUNDS, MIN_SAMPLE_MS, MIN_WARMUP_MS, MIN_WARMUP_ROUNDS } from "@/lib/bench";
import { corpora } from "@/features/compression/corpora";
import { STREAM_ALLOWANCE } from "@/features/compression/findings";
import { formatInteger } from "@/lib/format";
import { MIN_WARMUP_MS as MEMORY64_WARMUP_MS } from "@/features/memory64/harness";
import { AllocationWorkload } from "./AllocationWorkload";
import { MAX_DRIFT, MAX_DRIFT_OUTLIERS } from "@/lib/edition";
import { MIN_PAIRED_ROUNDS, PRACTICAL_FLOOR, medianCI } from "@/lib/stats";

const pct = `${PRACTICAL_FLOOR * 100}%`;

const sections = [
  { id: "brief", title: "In brief" },
  { id: "timing", title: "Timing, warm-up and order" },
  { id: "paired", title: `Paired ratios and the ±${pct} threshold` },
  { id: "unpaired", title: "What is paired, and what is not" },
  { id: "clock", title: "Timer resolution and isolation" },
  { id: "editions", title: "Reference editions" },
  { id: "this-machine", title: "This machine" },
  { id: "benchmarks", title: "Per benchmark" },
];

/** "x(4)–x(12), 96.5%": the order statistics and exact coverage of the median CI at n rounds. */
const ciAt = (n: number) => {
  const ci = medianCI(Array.from({ length: n }, (_, i) => i + 1));
  return ci ? { lo: ci.k, hi: n - ci.k + 1, coverage: `${(ci.coverage * 100).toFixed(1)}%` } : undefined;
};

const CiRow = ({ n }: { n: number }) => {
  const c = ciAt(n);
  return c ? (
    <li>
      {n} rounds: the {ordinal(c.lo)} to the {ordinal(c.hi)} smallest ratio ({c.coverage} coverage).
    </li>
  ) : null;
};

const ordinal = (k: number) => `${k}${k % 10 === 1 && k !== 11 ? "st" : k % 10 === 2 && k !== 12 ? "nd" : k % 10 === 3 && k !== 13 ? "rd" : "th"}`;

const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="mt-6 mb-1.5 text-base font-bold text-ink">{children}</h3>;

/** A compiler flag or tool name in prose: kept on one line, ASCII hyphen intact so it copies as typed. */
const Flag = ({ children }: { children: string }) => <span className="whitespace-nowrap">{children}</span>;

/** Quality and methodology: how every number on the site is measured and when a difference is reported. */
export const Method = () => (
  <>
    <ReleaseHeader
      title="Quality and methodology"
      meta={[
        { label: "Applies to", value: "Compression, Allocation, Memory64, Build settings" },
        { label: "Sample", value: `A batch of at least ${MIN_SAMPLE_MS} ms` },
        { label: "Reporting threshold", value: `±${pct}` },
      ]}
    />
    <ReleaseBody sections={sections}>
      <Section id="brief">
        <MainPoints
          points={[
            { text: `Timing values are medians of samples timed in a Web Worker, each a batch of at least ${MIN_SAMPLE_MS} ms; bytes and ratios are exact.` },
            { text: `Paired comparisons claim a difference beyond ±${pct} only when its 95% interval excludes no change; Compression compares unpaired medians.` },
            { text: "Headline claims on reference pages must hold in two independent captures; a run on this machine is shown without that check." },
          ]}
        />
      </Section>

      <Section id="timing">
        <Prose>
          <p>
            Browsers coarsen <code>performance.now()</code>, so each sample times a batch of repetitions in a Web Worker and divides by
            its size. Calibration grows the batch (at most {formatInteger(MAX_REPETITIONS)} repetitions) until it lasts at least{" "}
            {MIN_SAMPLE_MS} ms; builds compared in the same round share one count.
          </p>
          <p>
            Untimed warm-up runs at least {MIN_WARMUP_ROUNDS} rounds and {MIN_WARMUP_MS} ms ({MEMORY64_WARMUP_MS} ms for Memory64),
            at most {MAX_WARMUP_ROUNDS} rounds. Each
            round visits everything once, in an order rotated each round, so slow drift spreads across all of them.
          </p>
        </Prose>
      </Section>

      <Section id="paired">
        <Prose>
          <p>
            Two things timed in the same round give one ratio per round, so drift that hits both cancels. The effect is the median
            ratio (0.9 is &ldquo;10% less time&rdquo;); its 95% interval comes from order statistics, assuming independent rounds:
          </p>
          <ul>
            <CiRow n={6} />
            <CiRow n={10} />
            <CiRow n={15} />
          </ul>
          <p>Below {MIN_PAIRED_ROUNDS} rounds there is no interval and no claim.</p>
          <p>
            An effect is claimed only when the median is more than {pct} from 1 <em>and</em> the interval excludes 1. The ±{pct} band
            is a reporting threshold, set from the A/A control below; figures shade it as &ldquo;not claimed&rdquo;.
          </p>
          <H3>What the interval does not cover</H3>
          <p>
            It covers round-to-round sampling only, so a bias that stays with one module instance for a whole run is outside it. Build settings&apos; A/A
            control, the baseline instantiated twice, shows such bias: in the 2026-11-08 edition, 13 of 88 Chrome and Firefox A/A rows
            excluded 1, all within about 2%; hence the {pct} threshold. Safari&apos;s A/A rows show far larger bias on some workloads
            (cause not investigated); rows its A/A control rejects claim nothing.
          </p>
        </Prose>
      </Section>

      <Section id="unpaired">
        <Prose>
          <p>Three pages pair their comparisons by round:</p>
          <ul>
            <li>
              <b className="font-semibold">Build settings</b>: every variant, and the A/A instance, against the shipped build.
            </li>
            <li>
              <b className="font-semibold">Memory64</b>: wasm64 against wasm32.
            </li>
            <li>
              <b className="font-semibold">Allocation</b>: within a class only, talc against dlmalloc and bump-scope against bumpalo.
            </li>
          </ul>
          <p>
            Compression compares many configurations at once, so it compares medians, unpaired: two are &ldquo;about the same&rdquo;
            when their medians are less than {pct} apart, or when their observed min–max ranges overlap and neither is wider than ±10%
            of its median. Its bandwidth figures name a configuration fastest only where it beats the runner-up by more than {pct},
            with the same winner, in both captures.
          </p>
          <p>
            Observed min–max is the fastest and slowest sample: it widens with more samples, while a confidence interval narrows.
          </p>
        </Prose>
      </Section>

      <Section id="clock">
        <Prose>
          <p>
            The site serves <code>Cross-Origin-Opener-Policy: same-origin</code> and{" "}
            <code>Cross-Origin-Embedder-Policy: require-corp</code>, so every run is cross-origin isolated and gets the browser&apos;s
            finer clock. Each run measures the clock it got and the Measurement notes report it. With {MIN_SAMPLE_MS} ms batches, even
            a 1 ms step is at most 2% of one sample.
          </p>
        </Prose>
      </Section>

      <Section id="editions">
        <Prose>
          <p>
            A reference edition is a dated capture in Chrome, Firefox and Safari on one stated machine, today one Apple M4 Pro
            (arm64); x86-64 is not measured. Safari has no memory64. Each capture records the machine, power state, browser version,
            isolation and timer, the method, the toolchain and library versions, the commit, a SHA-256 per wasm module and input,
            and every per-round sample as raw JSON.
          </p>
          <p>Engines and machines are never pooled.</p>
          <p>
            Every browser and input is captured twice, independently. The two must agree: their timing medians, matched series by
            series, may not differ by more than {MAX_DRIFT}× overall, nor may more than {MAX_DRIFT_OUTLIERS * 100}% of series move
            by more than 1.5×. A pair that disagrees ran in a slowed state and is withheld everywhere, with a note.
          </p>
        </Prose>
      </Section>

      <Section id="this-machine">
        <Prose>
          <p>
            &ldquo;Measure on this machine&rdquo; runs the same harness in your browser without a second capture. On a reference input
            it also reports this machine ÷ reference as a geometric mean; if your browser differs from the reference&apos;s, engine and
            machine are confounded.
          </p>
          <p>Benchmarks run in your browser; files and results are not uploaded.
          </p>
        </Prose>
      </Section>

      <Section id="benchmarks">
        <Prose>
          <H3>
            <Link to="/compression" className="link">
              Compression
            </Link>
          </H3>
          <ul>
            <li>
              Speed is MB/s of uncompressed data (1 MB = 10<sup>6</sup> bytes), both ways; ratio is original ÷ compressed size. Levels
              follow each library&apos;s own scale.
            </li>
            <li>Every output is decoded and checked byte for byte before timing; a failure is marked and left off the figures.</li>
            <li>
              Each decoder decodes its own encoder&apos;s output, so the stream is part of its speed. In a separate test (Node 26, the
              M4; six decoders, five encoders&apos; streams) the stream alone moved a decoder&apos;s speed by up to about 1.2× at level
              6, so two streams can set two decoders up to 1.2² ≈ {STREAM_ALLOWANCE}× apart. Decoders within {STREAM_ALLOWANCE}× of a
              group&apos;s fastest are not ranked; one group is called faster only where its slowest decoder beats the next group&apos;s
              fastest by more than {STREAM_ALLOWANCE}×, in both captures.
            </li>
            <li>
              The browser&apos;s own gzip runs through CompressionStream and DecompressionStream, Streams overhead included.
            </li>
            <li>Code size is kB after gzip level 6, measured at build time; JavaScript libraries use their published minified builds.</li>
            <li>
              Inputs are 4 of the Silesia corpus&apos;s 12 files, the ones zstd, lz4 and brotli publish results against:{" "}
              {corpora.map((c, i) => (
                <span key={c.id}>
                  {i > 0 ? ", " : ""}
                  <b className="font-semibold">{c.name}</b> ({formatInteger(c.bytes)} bytes)
                </span>
              ))}
              . Each is checked against a pinned SHA-256 when packed and by length when loaded; loading is never timed.
            </li>
          </ul>
          <H3>
            <Link to="/allocation" className="link">
              Allocation
            </Link>
          </H3>
          <AllocationWorkload />
          <H3>
            <Link to="/memory64" className="link">
              Memory64
            </Link>
          </H3>
          <ul>
            <li>One crate, a bevy_ecs editor session, built for wasm32 and wasm64 with the same nightly compiler and flags.</li>
            <li>Both builds run in every round, so wasm64 ÷ wasm32 time is paired. Every sample&apos;s checksum must match across builds.</li>
            <li>Memory differences within one 64 KiB page or {pct} are not called.</li>
          </ul>
          <H3>
            <Link to="/build" className="link">
              Build settings
            </Link>
          </H3>
          <ul>
            <li>
              The same crates built with SIMD off and on, each with no <Flag>wasm-opt</Flag>, <Flag>-Os</Flag> and <Flag>-O3</Flag>;
              the baseline is the shipped build, no SIMD with <Flag>-Os</Flag>.
            </li>
            <li>All variants and the A/A control run in every round, so any two compare as a paired ratio.</li>
            <li>Sizes are exact: raw, gzip and brotli bytes of each module, and its count of SIMD instructions.</li>
          </ul>
        </Prose>
      </Section>
    </ReleaseBody>
  </>
);
