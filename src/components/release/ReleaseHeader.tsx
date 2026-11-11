import { clsx } from "clsx";
import { useId } from "react";
import { InfoIcon } from "@/components/icons";
import { nbNode } from "./nb";

/** A wrapper for the page's width: 1248px max, 16px gutters on phones, 24px above. */
export const wrapClass = "mx-auto w-full max-w-page px-4 sm:px-6";

export type MetaItem = { label: string; value: React.ReactNode };

export type ReleaseHeaderProps = {
  /** H1: the subject and the edition. "Compression codecs in WebAssembly, Silesia corpus subset: November 2026". */
  title: React.ReactNode;
  /**
   * Label/value pairs under the title (reference machine, samples,
   * browser): nothing the H1 or the switches already say.
   */
  meta?: MetaItem[];
  /** Switches: <Switch> for inputs, <DatasetSwitch>, <BrowserSwitch>. */
  switches?: React.ReactNode;
  /** One line under the switches: <ReleaseNotice>. */
  notice?: React.ReactNode;
  /**
   * The one shortcut on the page: a link that scrolls to the Measure
   * section. `true` for "Measure on this machine" → #measure.
   */
  measure?: boolean | { href?: string; label?: string };
  className?: string;
};

/**
 * Focus the heading of the section an in-page link points at (<Section>
 * gives its H2 the id `<section id>-h`), so keyboard and screen-reader
 * users land where the page scrolled to. The link's own navigation still
 * does the scrolling; focus moves once it has run, since navigating to a
 * fragment focuses its target (or the page) itself.
 */
const focusSectionHeading = (href: string) => {
  if (!href.startsWith("#")) {
    return;
  }
  const id = href.slice(1);
  window.setTimeout(() => {
    const heading = document.getElementById(`${id}-h`) ?? document.getElementById(id);
    if (heading) {
      if (!heading.hasAttribute("tabindex")) {
        heading.tabIndex = -1;
      }
      heading.focus({ preventScroll: true });
    }
  }, 0);
};

/** "Measure on this machine ↓": scrolls to the Measure section and focuses its heading. */
const MeasureLink = ({ href = "#measure", label = "Measure on this machine", className }: { href?: string; label?: string; className?: string }) => (
  <a
    href={href}
    onClick={() => focusSectionHeading(href)}
    className={clsx(
      "inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[4px] border border-tint-rule bg-bg px-3 text-sm font-semibold whitespace-nowrap text-accent transition-colors duration-150 hover:border-accent",
      className,
    )}
  >
    {label}
    <span aria-hidden="true">↓</span>
  </a>
);

/**
 * The release band: the one filled region on the page. Title, meta row,
 * switches (with the "Measure on this machine" link at their right end)
 * and an optional notice, on the pale tint.
 */
export const ReleaseHeader = ({ title, meta, switches, notice, measure, className }: ReleaseHeaderProps) => {
  const link = measure ? <MeasureLink {...(measure === true ? {} : measure)} className="sm:ml-auto" /> : null;
  const facts = meta?.length ? (
    <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:mt-[18px] sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-3">
      {meta.map((m) => (
        <div key={m.label} className="min-w-0">
          <dt className="text-cap text-tint-ink-3">{m.label}</dt>
          <dd className="font-semibold text-ink">{m.value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
  // With no switches, the link shares a row: the notice's when there is one, else the facts'. It never sits alone.
  const inline = link && !switches;
  return (
    <header aria-labelledby="release-title" className={clsx("bg-tint", className)}>
      <div className={clsx(wrapClass, "pt-5 pb-4 sm:pt-[30px] sm:pb-[22px]")}>
        <h1 id="release-title" className="max-w-[34ch] text-h1-sm font-bold tracking-[-0.01em] text-ink sm:text-h1">
          {nbNode(title)}
        </h1>
        {inline && !notice ? (
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            {facts}
            {link}
          </div>
        ) : (
          facts
        )}
        {switches ? (
          <div className="mt-3 flex flex-wrap items-end gap-x-10 gap-y-3 border-t border-tint-rule pt-3 sm:mt-5 sm:pt-4">
            {switches}
            {link}
          </div>
        ) : null}
        {inline && notice ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 [&>a]:mt-3">
            {notice}
            {link}
          </div>
        ) : (
          notice
        )}
      </div>
    </header>
  );
};

/** A line of context under the switches (placeholder data, a confound). */
export const ReleaseNotice = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-3 flex max-w-[90ch] items-baseline gap-2 text-sm text-tint-ink-2">
    <InfoIcon className="relative top-[3px] size-3.5 shrink-0" />
    <span>{children}</span>
  </p>
);

export type SwitchOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Small trailing detail ("10.2 MB"), hidden on phones. */
  detail?: React.ReactNode;
  disabled?: boolean;
};

export type SwitchProps<T extends string> = {
  /** Visible label above the options ("Input", "Results", "Browser"). */
  label: string;
  value: T;
  options: SwitchOption<T>[];
  onChange: (value: T) => void;
  /** Underline colour of the chosen option: mine marks "This machine". */
  toneFor?: (value: T) => "accent" | "mine";
  /** One short line under the switch (why an option is off). */
  hint?: React.ReactNode;
  className?: string;
};

/**
 * A segmented switch on the release band. Native radios underneath, so
 * arrow keys move the choice and screen readers announce a radio group.
 */
export function Switch<T extends string>({ label, value, options, onChange, toneFor, hint, className }: SwitchProps<T>) {
  const name = useId();
  return (
    <fieldset className={clsx("flex max-w-full min-w-0 flex-col gap-1.5", className)}>
      <legend className="mb-1.5 text-cap leading-tight text-tint-ink-3">{label}</legend>
      <div className="no-scrollbar inline-flex max-w-full self-start overflow-x-auto rounded-[4px] border border-tint-rule">
        {options.map((o) => {
          const mine = toneFor?.(o.value) === "mine";
          return (
            <label
              key={o.value}
              className={clsx(
                "relative flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-tint-rule px-2.5 text-sm leading-none whitespace-nowrap text-tint-ink-2 last:border-r-0 sm:px-[13px]",
                "transition-colors duration-150 hover:bg-bg/45 has-checked:bg-bg has-checked:font-semibold has-checked:text-ink",
                mine ? "has-checked:shadow-[inset_0_-2px_0_var(--c-mine)]" : "has-checked:shadow-[inset_0_-2px_0_var(--c-accent)]",
                "has-focus-visible:z-10 has-focus-visible:outline-2 has-focus-visible:outline-accent",
                "has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:bg-transparent",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={o.value === value}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
              {o.detail ? <small className="text-xs font-normal text-tint-ink-3 max-sm:hidden">{o.detail}</small> : null}
            </label>
          );
        })}
      </div>
      {hint ? <p className="text-xs text-tint-ink-3">{hint}</p> : null}
    </fieldset>
  );
}

export type Dataset = "reference" | "mine";

export type DatasetSwitchProps = {
  value: Dataset;
  onChange: (value: Dataset) => void;
  /**
   * Whether this machine has results. The switch exists only after a
   * run: with nothing to switch to it renders nothing, and the header's
   * "Measure on this machine" link is the way in.
   */
  hasMine: boolean;
  /** One short line under it ("Own file: no reference to compare"). */
  hint?: React.ReactNode;
};

/** Reference / This machine. Same place and wording on every page. */
export const DatasetSwitch = ({ value, onChange, hasMine, hint }: DatasetSwitchProps) =>
  hasMine ? (
    <Switch<Dataset>
      label="Results"
      value={value}
      onChange={onChange}
      toneFor={(v) => (v === "mine" ? "mine" : "accent")}
      hint={hint}
      options={[
        { value: "reference", label: "Reference" },
        { value: "mine", label: "This machine" },
      ]}
    />
  ) : null;

/**
 * Engines, side by side only where they differ materially (Build
 * settings). Elsewhere the page shows Chrome and a computed note.
 * Never list an engine that wasn't measured.
 */
export function BrowserSwitch<T extends string>(props: Omit<SwitchProps<T>, "label"> & { label?: string }) {
  return <Switch<T> {...props} label={props.label ?? "Browser"} />;
}
