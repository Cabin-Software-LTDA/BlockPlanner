import { describe, expect, it } from "vitest";
import {
  instantAt,
  interval,
  intersects,
  layoutBlocks,
  meetingBlocks,
} from "./time";
import type { TimeBlockOccurrence } from "./models";
const block = (
  id: string,
  start: string,
  end: string,
): TimeBlockOccurrence => ({
  id,
  definitionId: id,
  date: "2026-10-15",
  timezone: "UTC",
  start: `2026-10-15T${start}:00Z`,
  end: `2026-10-15T${end}:00Z`,
  title: id,
  color: "sage",
  icon: "book",
  overridden: false,
});
describe("time boundaries", () => {
  it("preserves an overnight block across dates", () => {
    expect(interval("2026-10-15", "23:00", "01:00", "Asia/Bangkok")).toEqual({
      start: "2026-10-15T16:00:00Z",
      end: "2026-10-15T18:00:00Z",
      endDayOffset: 1,
    });
  });
  it("rejects ambiguous and nonexistent DST times", () => {
    expect(() =>
      instantAt("2026-03-08", "02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      instantAt("2026-11-01", "01:30", "America/New_York"),
    ).toThrow();
  });
  it("uses the correct DST offset for valid dates", () => {
    expect(instantAt("2026-07-01", "09:00", "America/New_York")).toBe(
      "2026-07-01T13:00:00Z",
    );
    expect(instantAt("2026-01-01", "09:00", "America/New_York")).toBe(
      "2026-01-01T14:00:00Z",
    );
  });
  it("associates spanning meetings with each intersected block without boundary collisions", () => {
    const blocks = [
      block("a", "09:00", "10:00"),
      block("b", "10:00", "11:00"),
      block("c", "11:00", "12:00"),
    ];
    expect(meetingBlocks(block("event", "09:30", "11:00"), blocks)).toEqual([
      "a",
      "b",
    ]);
    expect(intersects(blocks[0], blocks[1])).toBe(false);
  });
  it("uses separate lanes for overlapping blocks", () => {
    const result = layoutBlocks([
      block("a", "09:00", "11:00"),
      block("b", "10:00", "12:00"),
      block("c", "12:00", "13:00"),
    ]);
    expect(result.map((x) => [x.lane, x.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
  });
});
