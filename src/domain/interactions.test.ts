import { describe, expect, it } from "vitest";
import { adjustBlock, validateRange } from "./interactions";
import { interval } from "./time";
import type { TimeBlockOccurrence } from "./models";
function block(
  date = "2026-10-15",
  start = "09:00",
  end = "10:00",
  timezone = "UTC",
): TimeBlockOccurrence {
  return {
    id: "block",
    definitionId: "definition",
    date,
    timezone,
    ...interval(date, start, end, timezone),
    title: "Focus",
    color: "sage",
    icon: "book",
    overridden: false,
  };
}
describe("timeline gestures", () => {
  it("snaps a pointer delta to 15 or 30 minutes", () => {
    expect(adjustBlock(block(), "move", 22, 15)).toEqual({
      start: "2026-10-15T09:15:00Z",
      end: "2026-10-15T10:15:00Z",
    });
    expect(adjustBlock(block(), "move", 22, 30)).toEqual({
      start: "2026-10-15T09:30:00Z",
      end: "2026-10-15T10:30:00Z",
    });
  });
  it("moves an overnight interval across the day boundary without changing its duration", () => {
    const original = block("2026-10-15", "23:00", "01:00");
    expect(adjustBlock(original, "move", 90, 15)).toEqual({
      start: "2026-10-16T00:30:00Z",
      end: "2026-10-16T02:30:00Z",
    });
    expect(original.date).toBe("2026-10-15");
  });
  it("resizes either boundary while enforcing the minimum increment", () => {
    expect(adjustBlock(block(), "resize-start", 120, 15)).toEqual({
      start: "2026-10-15T09:45:00Z",
      end: "2026-10-15T10:00:00Z",
    });
    expect(adjustBlock(block(), "resize-end", -120, 30)).toEqual({
      start: "2026-10-15T09:00:00Z",
      end: "2026-10-15T09:30:00Z",
    });
  });
  it("caps resize at 24 hours", () => {
    expect(adjustBlock(block(), "resize-end", 3000, 15).end).toBe(
      "2026-10-16T09:00:00Z",
    );
  });
  it("rejects a drag into a DST gap or repeated hour", () => {
    expect(() =>
      adjustBlock(
        block("2026-03-08", "00:30", "01:30", "America/New_York"),
        "move",
        120,
        15,
      ),
    ).toThrow();
    expect(() =>
      adjustBlock(
        block("2026-11-01", "00:15", "00:45", "America/New_York"),
        "move",
        60,
        15,
      ),
    ).toThrow();
  });
  it("preserves local clock duration across DST", () => {
    const original = block("2026-03-07", "23:00", "04:00", "America/New_York");
    const moved = adjustBlock(original, "move", 1440, 15);
    expect(moved).toEqual({
      start: "2026-03-09T03:00:00Z",
      end: "2026-03-09T08:00:00Z",
    });
  });
  it("rejects zero, negative, and excessive durations", () => {
    for (const end of [
      "2026-10-15T09:00:00Z",
      "2026-10-15T08:00:00Z",
      "2026-10-16T10:00:00Z",
    ])
      expect(() => validateRange("2026-10-15T09:00:00Z", end, "UTC")).toThrow();
  });
});
it("supports an explicitly selected full-day interval", () => {
  const full = interval("2026-10-15", "09:00", "09:00", "UTC", true);
  expect(full).toEqual({
    start: "2026-10-15T09:00:00Z",
    end: "2026-10-16T09:00:00Z",
    endDayOffset: 1,
  });
  expect(() => validateRange(full.start, full.end, "UTC")).not.toThrow();
});
