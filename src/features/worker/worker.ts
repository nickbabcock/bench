import { expose } from "comlink";
import * as WorkerModule from "./engine";

expose(WorkerModule);
export type WasmWorker = typeof WorkerModule;
