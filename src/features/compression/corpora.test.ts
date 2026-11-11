import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCorpus } from "./corpora";

describe("loading a corpus file", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops waiting the moment the run is cancelled, while the shared archive is still opening", async () => {
    // The archive never finishes opening (a stalled network).
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const load = loadCorpus("dickens", controller.signal);
    const settled = vi.fn();
    load.catch(settled);
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).not.toHaveBeenCalled();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(load).rejects.toThrow("cancelled");
  });
});
