import { expose } from "comlink";
import * as WorkerModule from "./module";

expose(WorkerModule);
export type WasmWorker = typeof WorkerModule;
