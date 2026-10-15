import { expect, it } from "vitest";
import type { Task, TimeBlockOccurrence } from "./models";
import {
  checklistProgress,
  scheduleAtMinute,
  taskFits,
  taskRange,
} from "./task-schedule";
const block = {
  start: "2026-10-15T13:00:00Z",
  end: "2026-10-15T18:00:00Z",
} as TimeBlockOccurrence;
it("places tasks proportionally before and after meetings without rearranging them", () => {
  const schedule = scheduleAtMinute(
    block,
    "2026-10-15",
    "UTC",
    16 * 60 + 6,
    60,
    15,
  );
  expect(schedule).toEqual({ offsetMinutes: 180, durationMinutes: 60 });
  expect(taskRange({ schedule } as Task, block)).toEqual({
    start: "2026-10-15T16:00:00Z",
    end: "2026-10-15T17:00:00Z",
  });
  expect(() =>
    scheduleAtMinute(block, "2026-10-15", "UTC", 17 * 60 + 45, 30, 15),
  ).toThrow("does not fit");
});
it("keeps elapsed task duration across midnight and carries tasks with block moves", () => {
  const overnight = {
    ...block,
    start: "2026-10-15T23:00:00Z",
    end: "2026-10-16T02:00:00Z",
  };
  const schedule = scheduleAtMinute(overnight, "2026-10-16", "UTC", 30, 60, 15);
  expect(taskRange({ schedule } as Task, overnight)?.start).toBe(
    "2026-10-16T00:30:00Z",
  );
  expect(
    taskRange({ schedule } as Task, {
      ...overnight,
      start: "2026-10-16T00:00:00Z",
    })?.start,
  ).toBe("2026-10-16T01:30:00Z");
});
it("rejects ambiguous and nonexistent wall-clock drops", () => {
  expect(() =>
    scheduleAtMinute(block, "2026-03-08", "America/New_York", 150, 30, 15),
  ).toThrow();
  expect(() =>
    scheduleAtMinute(block, "2026-11-01", "America/New_York", 90, 30, 15),
  ).toThrow();
});
it("preserves checklist progress separately from task completion and detects overflow", () => {
  const task = {
    completed: true,
    schedule: { offsetMinutes: 280, durationMinutes: 30 },
    checklist: [
      { id: "1", title: "A", completed: true },
      { id: "2", title: "B", completed: false },
    ],
  } as Task;
  expect(checklistProgress(task)).toEqual({ done: 1, total: 2 });
  expect(taskFits(task, block)).toBe(false);
});
