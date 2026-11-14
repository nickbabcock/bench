import { expose } from "comlink";
import * as WorkerModule from "./module";

expose(WorkerModule);
export type LocksWorker = typeof WorkerModule;
