import { expect, it } from "vitest";
import { plannerView } from "./planner-view";
import type { Task, TimeBlockOccurrence, UserPreferences } from "./models";
const preferences: UserPreferences = {
  id: "user",
  timezone: "UTC",
  visibleStart: 8,
  visibleEnd: 18,
  increment: 15,
  theme: "light",
};
const block = (
  id: string,
  start: string,
  end: string,
): TimeBlockOccurrence => ({
  id,
  definitionId: id,
  date: "2026-10-14",
  timezone: "UTC",
  title: id,
  start,
  end,
  color: "sage",
  icon: "book",
  overridden: false,
});
const task = (
  id: string,
  occurrenceId: string | null,
  completed: boolean,
): Task => ({
  id,
  occurrenceId,
  completed,
  title: id,
  notes: "",
  order: 0,
  createdAt: "2026-10-15T00:00:00Z",
});
it("indexes tasks by occurrence and counts each daily task once across overlapping and overnight blocks", () => {
  const blocks = [
    block("overnight", "2026-10-14T23:00:00Z", "2026-10-15T01:00:00Z"),
    block("work", "2026-10-15T09:00:00Z", "2026-10-15T11:00:00Z"),
    block("overlap", "2026-10-15T10:00:00Z", "2026-10-15T12:00:00Z"),
    block("next", "2026-10-16T00:00:00Z", "2026-10-16T01:00:00Z"),
  ];
  const view = plannerView(
    blocks,
    [
      task("a", "overnight", false),
      task("b", "work", true),
      task("c", "next", false),
      task("inbox", null, true),
    ],
    [],
    "2026-10-15",
    preferences,
  );
  expect(view.dayBlocks.map((b) => b.id)).toEqual([
    "overnight",
    "work",
    "overlap",
  ]);
  expect(view.visible.map((b) => b.id)).toEqual(["work", "overlap"]);
  expect([view.taskCount, view.completed]).toEqual([2, 1]);
  expect(view.tasksByBlock.get(null)?.[0].id).toBe("inbox");
});
