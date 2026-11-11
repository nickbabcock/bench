import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { buildInfo } from "./build-info.ts";

/**
 * Cross-origin isolation, as production serves it (public/_headers): it
 * gives workers the finer performance.now() the measurements rely on.
 * Every resource is same-origin, so require-corp blocks nothing.
 */
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * `server.headers` covers Vite's own responses but not the SSR document
 * TanStack Start renders in dev, so set the headers on every response.
 */
const isolate = ({ middlewares }: Pick<ViteDevServer, "middlewares">) => {
  middlewares.use((_req, res, next) => {
    for (const [k, v] of Object.entries(isolation)) {
      res.setHeader(k, v);
    }
    next();
  });
};
const crossOriginIsolation = (): Plugin => ({
  name: "cross-origin-isolation",
  configureServer: isolate,
  configurePreviewServer: isolate,
});

/**
 * Reference captures imported as modules (src/data/editions/<bench>.ts)
 * carry every per-round sample, so pages can compute medians, CIs and the
 * reproduction gate at prerender time. Their float noise (17 digits from a
 * batch time divided by its repetitions) is rounded to 6 significant
 * digits: at most 5 parts in 10⁷, far below the clock's resolution, and
 * about a third less to download. The raw-data links (`?url`) still ship
 * each capture byte for byte.
 */
const SAMPLE_DIGITS = 6;
const roundEditionSamples = (): Plugin => ({
  name: "round-edition-samples",
  enforce: "pre",
  transform(code, id) {
    if (!/\/src\/data\/editions\/.+\.json$/.test(id)) {
      return;
    }
    const round = (x: unknown): unknown =>
      typeof x === "number" ? (Number.isInteger(x) ? x : Number(x.toPrecision(SAMPLE_DIGITS))) : Array.isArray(x) ? x.map(round) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round(v)])) : x;
    const edition = JSON.parse(code) as { raw?: unknown };
    return { code: JSON.stringify({ ...edition, raw: round(edition.raw) }), map: null };
  },
});

export default defineConfig({
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo()),
  },
  server: { headers: isolation },
  preview: { headers: isolation },
  resolve: {
    tsconfigPaths: true,
  },
  environments: {
    client: {
      build: {
        outDir: ".output/public",
      },
    },
    ssr: {
      build: {
        outDir: ".output/server",
      },
    },
  },
  plugins: [
    crossOriginIsolation(),
    roundEditionSamples(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
        // The component gallery exists only in dev builds (src/routes/dev-kit.tsx).
        filter: ({ path }) => !path.startsWith("/dev-kit"),
      },
    }),
    react(),
  ],
});
