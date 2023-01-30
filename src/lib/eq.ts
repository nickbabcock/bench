export function shallowEq<T>(arr1: T[], arr2: T[]) {
  return arr1.length === arr2.length && arr1.every((x, i) => x === arr2[i]);
}
