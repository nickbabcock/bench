import { clsx } from "clsx";
import { createContext, useContext } from "react";
import { wrapClass } from "./ReleaseHeader";

export type SectionSpec = {
  /** Anchor id; also what <Section id> looks up for its number. */
  id: string;
  /** Short title, shown as the numbered H2. */
  title: string;
};

const SectionsCtx = createContext<SectionSpec[]>([]);

export type ReleaseBodyProps = {
  /** Every numbered section, in page order (the measure section included). Gives each <Section> its number. */
  sections?: SectionSpec[];
  children: React.ReactNode;
  className?: string;
};

/**
 * The body: one linear column on the page's left edge. Figures and tables
 * may use its full width (up to 1120px); prose and main points stay at the
 * reading measure (68ch). There is no Contents rail: the release header's
 * "Measure on this machine" link is the one shortcut.
 */
export const ReleaseBody = ({ sections = [], children, className }: ReleaseBodyProps) => (
  <SectionsCtx.Provider value={sections}>
    <div className={clsx(wrapClass, "pt-6 pb-24 sm:pt-[34px]", className)}>
      <div className="max-w-wide min-w-0">{children}</div>
    </div>
  </SectionsCtx.Provider>
);

export type SectionProps = {
  /** Must match an id in ReleaseBody's `sections`; that list gives the number and title. */
  id: string;
  /** Overrides the title from `sections`. */
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/** A numbered section: "2. Speed against ratio". Unnumbered when its id isn't in `sections`. */
export const Section = ({ id, title, children, className }: SectionProps) => {
  const sections = useContext(SectionsCtx);
  const i = sections.findIndex((s) => s.id === id);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={clsx("mt-14 scroll-mt-4 first:mt-0", className)}>
      <h2 id={`${id}-h`} className="mb-3.5 text-h2 font-bold text-ink">
        {i >= 0 ? `${i + 1}. ` : null}
        {title ?? sections[i]?.title}
      </h2>
      {children}
    </section>
  );
};

/** Prose at the reading measure (68ch), with teal links and paragraph spacing. */
export const Prose = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={clsx("prose-links max-w-measure [&_li+li]:mt-1.5 [&>*+*]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:marker:text-ink-3", className)}>
    {children}
  </div>
);
