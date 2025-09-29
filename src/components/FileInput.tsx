import { useRef, useId } from "react";
import { useFileDrop } from "@/hooks";
import clsx from "clsx";

type FileInputProps = {
  onChange: (file: File) => void | Promise<void>;
  disabled?: boolean;
  children: React.ReactNode;
};

export const FileInput = ({
  onChange,
  children,
  disabled = false,
}: FileInputProps) => {
  const dropAreaRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const { isHovering: isFileHovering } = useFileDrop({
    onFile: onChange,
    target: dropAreaRef,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget?.files?.[0];
    if (file) {
      e.currentTarget.value = "";
      onChange(file);
    }
  };

  return (
    <div className="w-full" ref={dropAreaRef}>
      <input
        id={inputId}
        type="file"
        className="peer absolute opacity-0"
        disabled={disabled}
        onChange={handleChange}
      />
      <label
        htmlFor={inputId}
        className={clsx(
          "flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed transition-colors peer-focus:ring-2 peer-focus:ring-blue-500 peer-focus:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:saturate-0",
          !isFileHovering
            ? "border-gray-300 bg-gray-50 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
            : "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20",
        )}
      >
        {children}
      </label>
    </div>
  );
};
