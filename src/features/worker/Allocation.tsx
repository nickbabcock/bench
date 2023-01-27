import { AllocationForm } from "./AllocationForm";
import { BenchmarkHarnessProvider } from "./HarnessProvider";

export const Allocation = () => {
  return (
    <BenchmarkHarnessProvider>
      <AllocationForm />
    </BenchmarkHarnessProvider>
  );
};
