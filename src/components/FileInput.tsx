import { useRef, KeyboardEvent } from "react";
import { useFileDrop } from "@/hooks";
import clsx from "clsx";

export function keyboardTrigger(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.isPropagationStopped()) {
      e.stopPropagation();
      fn();
    }
  };
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropAreaRef = useRef<HTMLDivElement>(null);
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

  const labelFocus = () => fileInputRef.current?.click();
  return (
    <div
      className="mx-auto my-5 w-full max-w-prose flex-col space-y-1"
      ref={dropAreaRef}
    >
      <label
        className={clsx(
          "flex items-center gap-1  rounded-md border-2 border-dashed border-slate-600 p-4 hover:bg-slate-300 focus:border-indigo-500 focus:ring-indigo-500 hover:dark:bg-slate-800",
          disabled ? "cursor-not-allowed saturate-0 " : "cursor-pointer",
          !isFileHovering
            ? "bg-slate-200 dark:bg-slate-700"
            : "bg-slate-300 dark:bg-slate-800"
        )}
        tabIndex={disabled ? -1 : 0}
        onKeyUp={keyboardTrigger(labelFocus)}
      >
        {children}
        <input
          ref={fileInputRef}
          type="file"
          disabled={disabled}
          hidden
          onChange={handleChange}
        />
      </label>
    </div>
  );
};
