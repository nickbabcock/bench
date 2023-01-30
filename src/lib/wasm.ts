type WasmModule<IN, R> = { default: (path: IN) => Promise<R> };

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
    (cached = cached ?? js().then((mod) => mod.default(wasm).then(() => mod)));
}
