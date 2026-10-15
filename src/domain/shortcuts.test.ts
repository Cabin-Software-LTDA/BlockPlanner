import { expect, it } from "vitest";
import { shortcutAction } from "./shortcuts";
const key = {
  key: "N",
  altKey: true,
  shiftKey: true,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
};
it("recognizes modified shortcuts but leaves ordinary typing and browser commands alone", () => {
  expect(shortcutAction(key, false, false)).toBe("new-block");
  expect(shortcutAction({ ...key, key: "ArrowLeft" }, false, false)).toBe(
    "previous",
  );
  expect(shortcutAction({ ...key, key: "k" }, false, false)).toBe("help");
  for (const change of [
    { altKey: false },
    { shiftKey: false },
    { ctrlKey: true },
    { metaKey: true },
    { repeat: true },
    { isComposing: true },
    { key: "s" },
  ])
    expect(shortcutAction({ ...key, ...change }, false, false)).toBeUndefined();
});
it("never triggers while editing or inside a modal", () => {
  expect(shortcutAction(key, true, false)).toBeUndefined();
  expect(shortcutAction(key, false, true)).toBeUndefined();
});
