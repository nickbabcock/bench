import { defineConfig } from "vitest/config";

// Unit tests for the pure data layer (statistics, findings, editions). The
// site's own plugins aren't needed, so this doesn't extend vite.config.ts.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["src/**/*.test.ts"] },
});
