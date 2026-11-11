import { probeTimer } from "./timer";

// Benchmarks time inside workers, whose clocks can differ from the page's,
// so the timer is also probed here (see measureWorkerTimer in context.ts).
self.onmessage = () => self.postMessage(probeTimer());
