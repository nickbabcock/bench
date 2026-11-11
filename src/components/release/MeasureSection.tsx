import { clsx } from "clsx";
import { useId } from "react";
import { Button } from "@/components/Button";
import { AlertIcon, CheckIcon, InfoIcon } from "@/components/icons";
import { Prose, Section } from "./ReleaseBody";

/** Where a run ended up, for the copy under the controls. */
export type RunOutcome =
  | {
      kind: "done";
      measured: number;
      unit: string;
      /** Where the results now show; default: "The switch at the top of the page now shows This machine." */
      shown?: string;
    }
  /** Some configurations finished, others failed or were skipped. */
  | { kind: "partial"; measured: number; total: number; unit: string; reason?: React.ReactNode }
  | {
      kind: "cancelled";
      /** Units measured before the cancel, of `total` planned. */
      measured: number;
      total: number;
      /** The unit's noun, plural ("configurations", "rows"); its singular drops the final "s". */
      unit: string;
      /**
       * Sample rounds, when every unit has some but fewer than planned:
       * "Cancelled after 2 of 10 sample rounds; every configuration has at least one."
       */
      rounds?: { measured: number; total: number };
      /** Replaces the whole copy (a page whose partial rounds are discarded, say). */
      message?: React.ReactNode;
    }
  /** The run stopped with an error (worker crash, fetch failure). */
  | { kind: "failed"; message: React.ReactNode }
  /** A round trip or checksum failed: the one use of danger. */
  | {
      kind: "mismatch";
      what: React.ReactNode;
      /** Replaces the round-trip wording (a checksum that differed between builds). */
      message?: React.ReactNode;
    };

export type MeasureSectionProps = {
  /** Section id in ReleaseBody's list (default "measure"). */
  id?: string;
  /** Opening paragraph; default: "Run the same measurements on this machine." */
  intro?: React.ReactNode;
  /** "Input": a reference file (<ChoiceChips>) or your own file. */
  input?: React.ReactNode;
  /** "Configurations": what to run. */
  configurations?: React.ReactNode;
  /** "Samples": rounds per configuration. */
  samples?: React.ReactNode;
  /** Further rows (<MeasureRow>), after samples. */
  children?: React.ReactNode;
  run: {
    /** Names the action and its size: "Run 25 configurations". */
    label: string;
    onRun: () => void;
    disabled?: boolean;
    /** Why Run is off (another benchmark is running; unsupported browser). */
    disabledReason?: React.ReactNode;
  };
  /** Present while a run can be cancelled. */
  onCancel?: () => void;
  running: boolean;
  progress?: {
    /** 0..1 */
    fraction: number;
    /** "Sample round 3 of 5". */
    label: React.ReactNode;
    /** "zstd 9" */
    detail?: React.ReactNode;
  };
  outcome?: RunOutcome;
  /** Export controls (<ExportButtons>) once there are results. */
  exports?: React.ReactNode;
};

/** The id runRegistry's `focusResults` moves focus to when a run ends. */
export const RESULTS_ID = "results";

/**
 * The `#results` focus target: when a run ends with focus lost (its
 * controls were disabled), `focusResults` (src/lib/runRegistry.ts) moves
 * focus here, and the announcement is read out. Render exactly one per
 * page, after <MeasureSection>, with the session's announcement:
 * "Measured 25 configurations. The page now shows This machine."
 */
export const ResultsTarget = ({ children }: { children?: React.ReactNode }) => (
  <p id={RESULTS_ID} tabIndex={-1} aria-live="polite" className="sr-only">
    {children}
  </p>
);

/** One row of the measure form: a label column and its control. */
export const MeasureRow = ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
  <fieldset className="min-w-0 border-t border-rule pt-4 pb-5">
    {/* The legend can't sit in a grid cell, so it stays for assistive tech and a twin shows it. */}
    <legend className="sr-only">{label}</legend>
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[160px_minmax(0,1fr)]">
      <div aria-hidden="true" className="text-[0.9375rem] font-semibold text-ink">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  </fieldset>
);

export type Choice<T extends string> = { value: T; label: React.ReactNode; detail?: React.ReactNode; disabled?: boolean };

/** Reference-file chips (dickens 10.2 MB, xml 5.3 MB …): a radio group in hairline boxes. */
export function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="flex flex-wrap gap-1.5 disabled:opacity-55">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-baseline gap-1.5 rounded-[4px] border border-rule px-2.5 py-[5px] text-sm transition-colors duration-150 hover:border-ink-3 has-checked:border-accent has-checked:shadow-[inset_0_0_0_1px_var(--c-accent)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-not-allowed"
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
          {o.detail ? <small className="text-xs text-ink-3">{o.detail}</small> : null}
        </label>
      ))}
    </fieldset>
  );
}

/** "1 configuration", "3 configurations": `unit` is the plural noun; one drops its final "s". */
const count = (n: number, unit: string) => `${n} ${n === 1 ? singular(unit) : unit}`;
const singular = (unit: string) => unit.replace(/s$/, "");
/** "2 of 10 configurations": the noun agrees with the total. */
const countOf = (n: number, total: number, unit: string) => `${n} of ${total} ${total === 1 ? singular(unit) : unit}`;

const outcomeCopy = (o: RunOutcome): React.ReactNode => {
  switch (o.kind) {
    case "done":
      return `Finished: ${count(o.measured, o.unit)} measured. ${o.shown ?? "The switch at the top of the page now shows This machine."}`;
    case "partial":
      return (
        <>
          {countOf(o.measured, o.total, o.unit)} finished{o.reason ? <>; {o.reason}</> : null}. The main points, figures and table cover
          only the {count(o.measured, o.unit)} measured.
        </>
      );
    case "cancelled":
      if (o.message) {
        return o.message;
      }
      if (o.measured === 0) {
        return "Cancelled before anything was measured. The reference results are unchanged.";
      }
      if (o.rounds && o.measured === o.total) {
        return `Cancelled after ${countOf(o.rounds.measured, o.rounds.total, "sample rounds")}; every ${singular(o.unit)} has at least one. The main points, figures and table use the ${count(o.rounds.measured, "rounds")} measured.`;
      }
      return `Cancelled after ${countOf(o.measured, o.total, o.unit)}. The main points, figures and table cover only the ${count(o.measured, o.unit)} measured.`;
    case "failed":
      return (
        <>
          The run stopped: {o.message}. Nothing from it is shown. Run again, or reload the page if it happens twice.
        </>
      );
    case "mismatch":
      return (
        o.message ?? <>
          {o.what} did not round-trip: the decoded output differed from the input. It is left out of the figures and marked in the
          table.
        </>
      );
  }
};

/**
 * "Measure on this machine": the visitor's own run, at the end of the
 * page. Rows for input, configurations and samples; Run and Cancel; a
 * progress bar while it runs; and the copy for how it ended.
 */
export const MeasureSection = ({
  id = "measure",
  intro,
  input,
  configurations,
  samples,
  children,
  run,
  onCancel,
  running,
  progress,
  outcome,
  exports,
}: MeasureSectionProps) => {
  const reasonId = useId();
  const pct = progress ? Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100) : 0;
  return (
    <Section id={id}>
      <Prose>
        {intro ?? <p>Run the same measurements on this machine.</p>}
      </Prose>
      <div className="mt-5 max-w-[780px]">
        {input ? <MeasureRow label="Input">{input}</MeasureRow> : null}
        {configurations ? <MeasureRow label="Configurations">{configurations}</MeasureRow> : null}
        {samples ? <MeasureRow label="Samples">{samples}</MeasureRow> : null}
        {children}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-rule pt-[18px]">
          <Button onClick={run.onRun} disabled={running || run.disabled} aria-describedby={run.disabledReason ? reasonId : undefined}>
            {run.label}
          </Button>
          {onCancel || running ? (
            <Button variant="secondary" onClick={onCancel} disabled={!running} data-cancel>
              Cancel
            </Button>
          ) : null}
          {exports ? <div className="text-sm text-ink-2">{exports}</div> : null}
          {run.disabledReason && !running ? (
            <p id={reasonId} className="basis-full text-sm text-ink-2">
              {run.disabledReason}
            </p>
          ) : null}
          {running && progress ? (
            <div className="basis-full" aria-live="polite">
              <progress
                max={100}
                value={pct}
                aria-label="Run progress"
                className="mt-1 mb-2 block h-1.5 w-full appearance-none overflow-hidden rounded-[3px] border-0 bg-grid [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-grid [&::-webkit-progress-value]:bg-accent [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-300"
              />
              <p className="text-sm text-ink-2">
                <b className="font-semibold text-ink">{progress.label}</b>
                {progress.detail ? <> · {progress.detail}</> : null}
                <span className="text-ink-3"> · {pct}%</span>
              </p>
            </div>
          ) : null}
        </div>
        {outcome && !running ? (
          <p
            role={outcome.kind === "failed" || outcome.kind === "mismatch" ? "alert" : "status"}
            className={clsx("mt-4 flex max-w-measure items-baseline gap-2 text-sm", outcome.kind === "mismatch" ? "text-danger" : "text-ink-2")}
          >
            {outcome.kind === "done" ? (
              <CheckIcon className="relative top-[3px] size-3.5 shrink-0 text-accent" />
            ) : outcome.kind === "failed" || outcome.kind === "mismatch" ? (
              <AlertIcon className="relative top-[3px] size-3.5 shrink-0" />
            ) : (
              <InfoIcon className="relative top-[3px] size-3.5 shrink-0" />
            )}
            <span>{outcomeCopy(outcome)}</span>
          </p>
        ) : null}
      </div>
    </Section>
  );
};
