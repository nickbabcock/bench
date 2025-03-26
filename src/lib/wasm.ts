type WasmModule<IN, R> = {
  default: (args: { module_or_path: IN }) => Promise<R>;
};

type LoadProps<IN, R, T extends WasmModule<IN, R>> = {
  wasm: IN;
  js: () => Promise<T>;
};

export function load<IN, R, T extends WasmModule<IN, R>>({
  js,
  wasm,
}: LoadProps<IN, R, T>) {
  let cached: Promise<T> | undefined = undefined;
  return () =>
    (cached ??= js().then((mod) =>
      mod.default({ module_or_path: wasm }).then(() => mod),
    ));
}
