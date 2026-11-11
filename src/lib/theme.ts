import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

/** Shared with public/theme.js, which applies it before first paint. */
const KEY = "theme";
const EVENT = "themechange";

const read = (): Theme => {
  try {
    const t = window.localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
};

const LIGHT_BAR = "#ffffff";
const DARK_BAR = "#15191b";

/** The id of the chosen theme's own theme-color tag, shared with public/theme.js. */
const CHOSEN = "theme-color-chosen";

/**
 * Apply a theme to the page: data-theme on <html>, and the browser bar's
 * tint. React renders the two media-specific theme-color tags and matches
 * them by their attributes when it hydrates, so they are never edited
 * (an edited one was re-inserted, leaving a duplicate). A chosen theme
 * instead gets one more tag, without media, first in <head>, where it
 * wins; "system" removes it.
 */
const apply = (theme: Theme) => {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  let chosen = document.getElementById(CHOSEN) as HTMLMetaElement | null;
  if (theme === "system") {
    chosen?.remove();
    return;
  }
  if (!chosen) {
    chosen = document.createElement("meta");
    chosen.id = CHOSEN;
    chosen.name = "theme-color";
    document.head.prepend(chosen);
  }
  chosen.content = theme === "dark" ? DARK_BAR : LIGHT_BAR;
};

/** Set the theme for this viewer: applied at once and remembered per browser. */
export function setTheme(theme: Theme) {
  apply(theme);
  try {
    if (theme === "system") {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, theme);
    }
  } catch {
    // Storage blocked: the choice holds for this page only.
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (onChange: () => void) => {
  // Another tab changed it: follow along.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      apply(read());
      onChange();
    }
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
};

/** What the page shows now: data-theme, set before first paint by theme.js. */
const shown = (): Theme => {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "system";
};

/**
 * The chosen theme, read from the page itself; undefined on the server and
 * during hydration, so nothing (aria-pressed included) claims a choice it
 * can't know yet.
 */
export const useTheme = () => {
  // Hydration reorders <head>, which can leave the chosen theme-color tag
  // behind React's pair; put it first again once hydrated.
  useEffect(() => {
    const t = read();
    if (t !== "system") {
      apply(t);
      const chosen = document.getElementById(CHOSEN);
      if (chosen && chosen !== document.head.firstElementChild) {
        document.head.prepend(chosen);
      }
    }
  }, []);
  return useSyncExternalStore<Theme | undefined>(subscribe, shown, () => undefined);
};
