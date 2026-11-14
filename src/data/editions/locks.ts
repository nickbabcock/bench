/** RefCell against Mutex reference captures: only this benchmark's data. See ./index.ts. */
import { type LocksEdition, loadCaptures } from "./index";

/** Every locks capture, the same array on every call. */
export const locksCaptures = () => loadCaptures("locks", () => import.meta.glob<LocksEdition>("./locks/*/*/*.json", { eager: true, import: "default" }));
