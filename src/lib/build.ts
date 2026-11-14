import type { BuildInfo } from "../../build-info";

// Injected by Vite's `define` (see vite.config.ts and build-info.ts).
// oxlint-disable-next-line no-underscore-dangle
declare const __BUILD_INFO__: BuildInfo;

/** What was built, from the lockfiles and build config at build time. */
// oxlint-disable-next-line no-underscore-dangle
export const build: BuildInfo = __BUILD_INFO__;

/** The compiler and profile: "rustc 1.99.1, opt-level 3, LTO fat". */
export const toolchainSummary = (nightly = false) =>
  `${nightly ? `rustc ${build.rustcNightly}, std built from source` : build.rustc.replace(/ \(.*\)$/, "")}, opt-level ${build.optLevel}, LTO ${build.lto}`;

/** One-line summary of the toolchain and flags of the site's modules. */
export const buildSummary = (nightly = false) =>
  `${toolchainSummary(nightly)}, ${build.targetFeatures.join(", ").startsWith("none") ? "no SIMD" : build.targetFeatures.join(" ")}, wasm-opt ${build.wasmOpt}`;

/** Machine facts for exports: logical cores and platform. */
export const hardware = () => ({
  hardwareConcurrency: typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency,
  platform:
    typeof navigator === "undefined"
      ? undefined
      : ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform),
});
