import { probeTimer, type TimerProbe } from "./timer";

export type RunContext = {
  browser: string;
  /** Smallest non-zero step observed in performance.now(), in ms. */
  timerMs: number;
  crossOriginIsolated: boolean;
  /** Logical cores the browser reports. */
  cores?: number;
};

function browserName(): string {
  const ua = navigator.userAgent;
  const match =
    ua.match(/(Edg)\/(\d+)/) ??
    ua.match(/(Firefox)\/(\d+)/) ??
    ua.match(/(Chrome)\/(\d+)/) ??
    ua.match(/Version\/(\d+)[\d.]* .*(Safari)/);
  if (!match) {
    return "Unknown browser";
  }
  if (match[2] === "Safari") {
    return `Safari ${match[1]}`;
  }
  return `${match[1] === "Edg" ? "Edge" : match[1]} ${match[2]}`;
}

let cached: RunContext | undefined;

/** Browser, timer granularity and isolation: what bounds every number. */
export function runContext(): RunContext {
  cached ??= {
    browser: browserName(),
    timerMs: probeTimer().minStepMs,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    cores: navigator.hardwareConcurrency,
  };
  return cached;
}

/**
 * The timer as the benchmarks see it: probed inside a dedicated worker,
 * where every benchmark times. Falls back to the page's clock if the
 * worker can't start.
 */
export function measureWorkerTimer(): Promise<TimerProbe & { where: "worker" | "page" }> {
  return new Promise((resolve) => {
    const page = () => resolve({ ...probeTimer(), where: "page" });
    let worker: Worker;
    try {
      worker = new Worker(new URL("./timerWorker", import.meta.url), { type: "module" });
    } catch {
      page();
      return;
    }
    const done = (result?: TimerProbe) => {
      worker.terminate();
      if (result) {
        resolve({ ...result, where: "worker" });
      } else {
        page();
      }
    };
    worker.onmessage = (e: MessageEvent<TimerProbe>) => done(e.data);
    worker.onerror = () => done();
    worker.postMessage(null);
  });
}

export type BrowserFacts = {
  /** "Chrome", "Firefox", "Safari", "Edge". */
  name: string;
  /** The fullest version the browser exposes ("156.0.7444.60"). */
  version: string;
  userAgent: string;
  /** "macOS", from client hints where available, else from the user agent. */
  platform?: string;
  /** CPU architecture from client hints (Chromium only). */
  arch?: string;
};

type UAData = { getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>> };

/**
 * Browser name and full version. Chromium reduces the user agent's version
 * to "156.0.0.0", so ask client hints for the full one when offered.
 */
export async function browserFacts(): Promise<BrowserFacts> {
  const ua = navigator.userAgent;
  const m =
    /(Edg)\/([\d.]+)/.exec(ua) ?? /(Firefox)\/([\d.]+)/.exec(ua) ?? /(Chrome)\/([\d.]+)/.exec(ua) ?? /Version\/([\d.]+).*(Safari)/.exec(ua);
  const name = !m ? "Unknown" : m[2] === "Safari" ? "Safari" : m[1] === "Edg" ? "Edge" : m[1];
  let version = !m ? "unknown" : m[2] === "Safari" ? m[1] : m[2];
  let platform: string | undefined;
  let arch: string | undefined;
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  if (data?.getHighEntropyValues) {
    try {
      const hints = await data.getHighEntropyValues(["fullVersionList", "platformVersion", "architecture", "bitness"]);
      const brand = (hints.fullVersionList as { brand: string; version: string }[] | undefined)?.find((b) =>
        name === "Edge" ? b.brand === "Microsoft Edge" : b.brand === "Google Chrome" || b.brand === "Chromium",
      );
      version = brand?.version ?? version;
      platform = typeof hints.platform === "string" ? hints.platform : undefined;
      arch = typeof hints.architecture === "string" && hints.architecture ? `${hints.architecture}${hints.bitness === "64" ? "64" : ""}` : undefined;
    } catch {
      // Client hints refused: keep the user agent's version.
    }
  }
  platform ??= /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : undefined;
  return { name, version, userAgent: ua, platform, arch };
}
