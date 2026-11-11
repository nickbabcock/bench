import { clsx } from "clsx";
import { useId } from "react";
import { buttonClass, type ButtonProps } from "./Button";

type FileButtonProps = {
  onFile: (file: File) => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
};

/**
 * A native file input, visually hidden but focusable, behind a label styled
 * as a button. The focus ring follows the input onto its label.
 */
export const FileButton = ({
  onFile,
  disabled = false,
  children,
  variant = "primary",
  size = "md",
  className,
}: FileButtonProps) => {
  const id = useId();
  return (
    <span className="relative flex sm:inline-flex">
      <input
        id={id}
        type="file"
        className="peer sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) {
            onFile(file);
          }
        }}
      />
      <label
        htmlFor={id}
        className={clsx(
          buttonClass({ variant, size }),
          "w-full sm:w-auto",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
          disabled && "pointer-events-none border-rule bg-band text-ink-3",
          className,
        )}
        aria-disabled={disabled || undefined}
      >
        {children}
      </label>
    </span>
  );
};
