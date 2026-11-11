/** Build reference captures: only this benchmark's data. See ./index.ts. */
import { type BuildEdition, loadCaptures } from "./index";

/** Every build capture, the same array on every call. */
export const buildCaptures = () => loadCaptures("build", () => import.meta.glob<BuildEdition>("./build/*/*/*.json", { eager: true, import: "default" }));
