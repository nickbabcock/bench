// Applies the reader's chosen theme before first paint, so there is no
// flash. Loaded synchronously in <head> (same origin, so it meets the CSP).
// "light" or "dark" sets data-theme on <html> and retints the browser bar;
// "system" or nothing leaves both alone, and the stylesheet follows
// prefers-color-scheme. Mirrors setTheme() in src/lib/theme.ts.
(function () {
  try {
    var t = window.localStorage.getItem("theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
      // Its own tag, first in <head> so it wins over the media-specific
      // pair. Those are React's: editing them made hydration add a copy.
      var meta = document.createElement("meta");
      meta.id = "theme-color-chosen";
      meta.name = "theme-color";
      meta.content = t === "dark" ? "#15191b" : "#ffffff";
      document.head.insertBefore(meta, document.head.firstChild);
    }
  } catch (e) {
    // Storage blocked: follow the system.
  }
})();
