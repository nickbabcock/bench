import { useIsomorphicLayoutEffect } from "@/hooks";
import { RefObject, useEffect, useRef, useState } from "react";

const hasFiles = (e: DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes("Files");

export interface FileDropProps {
  onFile: (file: File) => void | Promise<void>;
  /** Called instead of onFile when a drop can't be used (e.g. two files). */
  onReject?: (reason: string) => void;
  enabled?: boolean;
  target?: RefObject<HTMLElement | null>;
}

/**
 * Accept a single dropped file on `target` (or the whole document). File
 * drops are always swallowed so the browser never navigates away to the
 * file, even while disabled.
 */
export function useFileDrop({
  onFile,
  onReject,
  enabled = true,
  target,
}: FileDropProps) {
  const [isHovering, setHovering] = useState(false);

  // keep count of drags: https://stackoverflow.com/a/21002544/433785
  const dragCount = useRef(0);

  // Latest ref pattern for props, so listeners are added once.
  const enabledRef = useRef(enabled);
  const onFileRef = useRef(onFile);
  const onRejectRef = useRef(onReject);
  useIsomorphicLayoutEffect(() => {
    enabledRef.current = enabled;
    onFileRef.current = onFile;
    onRejectRef.current = onReject;
  });

  useEffect(() => {
    if (target?.current === null) {
      return;
    }
    const elem = target ? target.current : document;

    function drop(e: Event) {
      if (!(e instanceof DragEvent) || !hasFiles(e)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dragCount.current = 0;
      setHovering(false);
      if (!enabledRef.current) {
        return;
      }
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length !== 1) {
        onRejectRef.current?.(
          files.length === 0
            ? "That drop didn't contain a readable file."
            : `You dropped ${files.length} files. Drop one file at a time.`,
        );
        return;
      }
      onFileRef.current(files[0]);
    }

    function enter(e: Event) {
      if (e instanceof DragEvent && hasFiles(e) && enabledRef.current) {
        dragCount.current += 1;
        e.preventDefault();
        setHovering(true);
      }
    }

    function leave(e: Event) {
      if (e instanceof DragEvent && hasFiles(e) && enabledRef.current) {
        dragCount.current = Math.max(0, dragCount.current - 1);
        setHovering(dragCount.current !== 0);
      }
    }

    // Cancelling dragover is what allows a drop at all.
    function over(e: Event) {
      if (!(e instanceof DragEvent) || !hasFiles(e)) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = enabledRef.current ? "copy" : "none";
      }
    }

    elem.addEventListener("drop", drop, { capture: true });
    elem.addEventListener("dragenter", enter);
    elem.addEventListener("dragleave", leave);
    elem.addEventListener("dragover", over);
    return () => {
      elem.removeEventListener("drop", drop, { capture: true });
      elem.removeEventListener("dragenter", enter);
      elem.removeEventListener("dragleave", leave);
      elem.removeEventListener("dragover", over);
    };
  }, [target]);

  return { isHovering };
}
