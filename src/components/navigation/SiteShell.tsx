import { Link } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useRef } from "react";
import { GithubIcon, MoonIcon, SunIcon, SystemThemeIcon } from "@/components/icons";
import { wrapClass } from "@/components/release/ReleaseHeader";
import { type Benchmark, benchmarkNames, useActiveRun } from "@/lib/runRegistry";
import { setTheme, type Theme, useTheme } from "@/lib/theme";

const REPO = "https://github.com/nickbabcock/bench";

const navigation: { name: string; to: string; run?: Benchmark }[] = [
  { name: "Compression", to: "/compression", run: "compression" },
  { name: "Allocation", to: "/allocation", run: "allocation" },
  { name: "Memory64", to: "/memory64", run: "memory64" },
  { name: "Build settings", to: "/build", run: "build" },
  { name: "Method", to: "/method" },
];

/** A benchmark is running on that page: a small teal dot, named for screen readers. */
const Running = ({ name }: { name: string }) => (
  <>
    <span aria-hidden="true" title={`${name} is running`} className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />
    <span className="sr-only"> (running)</span>
  </>
);

const Header = () => {
  const active = useActiveRun();
  const nav = useRef<HTMLElement>(null);
  // On phones the nav scrolls sideways: bring the current page into view.
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);
  return (
    <header className="border-b border-rule bg-bg">
      <div className={clsx(wrapClass, "flex flex-wrap items-center gap-x-10 pt-3 md:h-14 md:flex-nowrap md:pt-0")}>
        <Link to="/compression" className="order-1 text-[1.0625rem] font-bold whitespace-nowrap text-ink">
          WASM Bench
        </Link>
        <nav
          ref={nav}
          aria-label="Site"
          className="no-scrollbar relative order-3 -mx-4 mt-0.5 flex basis-[calc(100%+2rem)] overflow-x-auto px-4 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-2rem),transparent)] sm:-mx-6 sm:basis-[calc(100%+3rem)] sm:px-6 md:order-2 md:mx-0 md:mt-0 md:basis-auto md:overflow-visible md:px-0 md:[mask-image:none]"
        >
          <ul className="flex gap-[22px] text-[0.9375rem] md:gap-7">
            {navigation.map((item) => (
              <li key={item.to} className="shrink-0">
                <Link
                  to={item.to}
                  className="block py-2.5 whitespace-nowrap text-ink-2 transition-colors duration-150 hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-[inset_0_-3px_0_var(--c-accent)] md:py-4"
                >
                  {item.name}
                  {item.run && active === item.run ? <Running name={benchmarkNames[item.run]} /> : null}
                </Link>
              </li>
            ))}
            {/* Room past the fade, so the last item can scroll fully clear of it. */}
            <li aria-hidden="true" className="w-6 shrink-0 md:hidden" />
          </ul>
        </nav>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="order-2 ml-auto flex items-center gap-1.5 py-1 text-sm whitespace-nowrap text-ink-2 hover:text-ink md:order-3"
        >
          <GithubIcon className="size-4" />
          GitHub
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </header>
  );
};

const themes: [Theme, string, typeof SunIcon][] = [
  ["light", "Light", SunIcon],
  ["dark", "Dark", MoonIcon],
  ["system", "System", SystemThemeIcon],
];

/** Light, dark or follow the system; remembered in this browser. */
const ThemeControl = () => {
  const theme = useTheme();
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">Theme</legend>
      <span aria-hidden="true">Theme</span>
      <div className="flex rounded-[4px] border border-rule">
        {themes.map(([t, label, Icon]) => (
          <button
            key={t}
            type="button"
            aria-pressed={theme === undefined ? undefined : theme === t}
            data-opt={t}
            title={`${label} theme`}
            onClick={() => setTheme(t)}
            className="theme-opt flex size-9 cursor-pointer items-center justify-center border-r border-rule text-ink-3 transition-colors duration-150 last:border-r-0 hover:text-ink sm:size-8"
          >
            <Icon />
            <span className="sr-only">{label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
};

const Footer = () => (
  <footer className="border-t border-rule">
    <div className={clsx(wrapClass, "flex flex-wrap items-center justify-end gap-x-8 gap-y-3 py-6 text-cap text-ink-2")}>
      <div className="flex items-center gap-6">
        <Link to="/method" className="link">
          Method
        </Link>
        <ThemeControl />
      </div>
    </div>
  </footer>
);

/** Skip link, top nav, main landmark and footer, shared by every page. */
export const SiteShell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-dvh flex-col">
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[4px] focus:bg-bg focus:px-3 focus:py-2 focus:text-ink focus:outline-2 focus:outline-accent"
    >
      Skip to content
    </a>
    <Header />
    <main id="main" tabIndex={-1} className="flex-1 outline-none">
      {children}
    </main>
    <Footer />
  </div>
);
