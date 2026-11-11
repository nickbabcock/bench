import "@fontsource-variable/source-sans-3/wght.css";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import "@/styles/tailwind.css";

import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "description",
        content:
          "WebAssembly benchmarks for compression, allocation, Memory64 and build settings, measured in real browsers and re-runnable in yours.",
      },
      { name: "color-scheme", content: "light dark" },
      { title: "WASM Bench" },
    ],
    // Synchronous and same-origin: sets data-theme from the stored choice
    // before first paint, so a chosen theme never flashes the other one.
    scripts: [{ src: "/theme.js" }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    // theme.js may set data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Rendered here, not in head(), which keeps only one tag per name.
            Never edited after render: a chosen theme adds its own tag
            first in <head> (public/theme.js, src/lib/theme.ts). */}
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#15191b" media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
