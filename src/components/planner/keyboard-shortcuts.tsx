"use client";
import { useEffect } from "react";
import { X } from "lucide-react";
import { shortcutAction, type ShortcutAction } from "@/domain/shortcuts";
import { EditorPanel } from "./editor-panel";
export function KeyboardShortcuts({
  onAction,
}: {
  onAction: (action: ShortcutAction) => void;
}) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      const editing = Boolean(
        element?.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable=false])",
        ),
      );
      const action = shortcutAction(
        event,
        editing,
        Boolean(document.querySelector("dialog[open]")),
      );
      if (action && !event.defaultPrevented) {
        event.preventDefault();
        onAction(action);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onAction]);
  return null;
}
export function ShortcutHelp({ close }: { close: () => void }) {
  return (
    <EditorPanel label="Keyboard shortcuts" close={close}>
      <div className="section-heading">
        <h2>Keyboard shortcuts</h2>
        <button
          className="icon-button"
          aria-label="Close keyboard shortcuts"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        Use Alt + Shift (Option + Shift on Mac). Shortcuts pause while typing or
        when a dialog is open.
      </p>
      <dl className="shortcut-list">
        {[
          ["N", "New block"],
          ["R", "New routine"],
          ["T", "Today"],
          ["← / →", "Previous / next day"],
          ["K", "Show shortcuts"],
        ].map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>Alt + Shift + {key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <p>
        Tab to a block’s move or resize handle and use ↑ / ↓ to change its time.
        Enter opens details. Task arrow buttons reorder tasks; task details let
        you move them between blocks. Escape closes a dialog or cancels a drag.
      </p>
    </EditorPanel>
  );
}
