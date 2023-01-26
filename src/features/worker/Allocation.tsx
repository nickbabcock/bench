import { AllocationForm } from "./AllocationForm";
import { BenchmarkHarnessProvider } from "./HarnessProvider";

export const Allocation = () => {
  return (
    <BenchmarkHarnessProvider>
      <h2>Allocation</h2>
      <p>
        The allocation benchmark measures how long it takes to allocate a given
        number of vectors with 5 strings of input
      </p>
      <AllocationForm />
    </BenchmarkHarnessProvider>
  );
};
