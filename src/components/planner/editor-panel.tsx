"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    node?.showModal();
    node?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => {
      node?.close();
      if (previous?.isConnected && previous.getClientRects().length)
        previous.focus();
      else document.getElementById("daily-planner")?.focus();
    };
  }, []);
  return ref;
}

/** Native top-layer dialogs provide focus containment, Escape and focus restoration. */
export function EditorPanel({
  children,
  label,
  close,
  className = "",
}: {
  children: ReactNode;
  label: string;
  close: () => void;
  className?: string;
}) {
  const ref = useModalDialog();
  return (
    <dialog
      ref={ref}
      className={`editor editor-dialog ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {children}
    </dialog>
  );
}
