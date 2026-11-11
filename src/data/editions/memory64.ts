/** Memory64 reference captures: only this benchmark's data. See ./index.ts. */
import { type Memory64Edition, loadCaptures } from "./index";

/** Every memory64 capture, the same array on every call. */
export const memory64Captures = () => loadCaptures("memory64", () => import.meta.glob<Memory64Edition>("./memory64/*/*/*.json", { eager: true, import: "default" }));
