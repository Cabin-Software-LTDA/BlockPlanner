export type ShortcutAction =
  "new-block" | "new-routine" | "today" | "previous" | "next" | "help";
export function shortcutAction(
  event: {
    key: string;
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    repeat: boolean;
    isComposing: boolean;
  },
  editing: boolean,
  modalOpen: boolean,
): ShortcutAction | undefined {
  if (
    editing ||
    modalOpen ||
    event.repeat ||
    event.isComposing ||
    !event.altKey ||
    !event.shiftKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  const keys: Record<string, ShortcutAction> = {
    n: "new-block",
    r: "new-routine",
    t: "today",
    arrowleft: "previous",
    arrowright: "next",
    k: "help",
  };
  return keys[event.key.toLowerCase()];
}
