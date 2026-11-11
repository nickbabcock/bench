/** Compression reference captures: only this benchmark's data. See ./index.ts. */
import { type CompressionEdition, loadCaptures } from "./index";

/** Every compression capture, the same array on every call. */
export const compressionCaptures = () => loadCaptures("compression", () => import.meta.glob<CompressionEdition>("./compression/*/*/*.json", { eager: true, import: "default" }));
