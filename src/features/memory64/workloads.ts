export type Variant = "wasm32" | "wasm64";
export const variants: readonly Variant[] = ["wasm32", "wasm64"];

export type WorkloadParam = {
  key: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
};

export type WorkloadDefinition = {
  name: string;
  params: readonly WorkloadParam[];
};

export const workloads = {
  editor: {
    name: "bevy_ecs editor session",
    params: [
      {
        key: "entities",
        label: "Entities",
        defaultValue: 100_000,
        min: 1_000,
        max: 1_000_000,
      },
    ],
  },
} as const satisfies Record<string, WorkloadDefinition>;

export type WorkloadKey = keyof typeof workloads;
export const workloadKeys = Object.keys(workloads) as WorkloadKey[];

export type WorkloadParams = Record<string, number>;

export const defaultParams = (key: WorkloadKey): WorkloadParams =>
  Object.fromEntries(
    workloads[key].params.map((p: WorkloadParam) => [p.key, p.defaultValue]),
  );

// A minimal module declaring a memory64 memory. `WebAssembly.validate`
// rejects it in engines without memory64 support.
const memory64Probe = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x04, 0x00,
]);

let memory64Support: boolean | undefined;

export const supportsMemory64 = () => {
  if (memory64Support === undefined) {
    try {
      memory64Support = WebAssembly.validate(memory64Probe);
    } catch {
      memory64Support = false;
    }
  }
  return memory64Support;
};
