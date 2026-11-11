/** Allocation reference captures: only this benchmark's data. See ./index.ts. */
import { type AllocationEdition, loadCaptures } from "./index";

/** Every allocation capture, the same array on every call. */
export const allocationCaptures = () => loadCaptures("allocation", () => import.meta.glob<AllocationEdition>("./allocation/*/*/*.json", { eager: true, import: "default" }));
