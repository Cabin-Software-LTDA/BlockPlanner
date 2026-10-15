import { describe, expect, it } from "vitest";
import { minuteOnDay } from "./time";
import {
  associatedBlocks,
  dayRange,
  eventOnDay,
  hasClockChange,
  meetingLabel,
  safeEventUrl,
} from "./calendar";
import type { ExternalCalendarEvent, TimeBlockOccurrence } from "./models";
const event: ExternalCalendarEvent = {
  id: "event",
  connectionId: "google",
  calendarId: "primary",
  externalId: "event",
  title: "Meeting",
  allDay: false,
  start: "2026-10-15T09:30:00Z",
  end: "2026-10-15T11:30:00Z",
};
const block = (
  id: string,
  start: string,
  end: string,
): TimeBlockOccurrence => ({
  id,
  definitionId: id,
  date: "2026-10-15",
  timezone: "UTC",
  start,
  end,
  title: id,
  color: "sage",
  icon: "book",
  overridden: false,
});
describe("meeting association", () => {
  it("intersects every block without assigning adjacent endpoints or outside meetings", () => {
    const blocks = [
      block("before", "2026-10-15T08:00:00Z", event.start),
      block("one", "2026-10-15T09:00:00Z", "2026-10-15T10:00:00Z"),
      block("two", "2026-10-15T10:00:00Z", "2026-10-15T12:00:00Z"),
      block("after", event.end, "2026-10-15T13:00:00Z"),
    ];
    expect(associatedBlocks(event, blocks).map((b) => b.id)).toEqual([
      "one",
      "two",
    ]);
    expect(associatedBlocks({ ...event, allDay: true }, blocks)).toEqual([]);
  });
  it("uses exclusive all-day dates without timezone conversion", () => {
    const allDay = {
      ...event,
      allDay: true,
      start: "2026-10-15",
      end: "2026-10-17",
    };
    for (const timezone of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
      expect(eventOnDay(allDay, "2026-10-15", timezone)).toBe(true);
      expect(eventOnDay(allDay, "2026-10-16", timezone)).toBe(true);
      expect(eventOnDay(allDay, "2026-10-17", timezone)).toBe(false);
    }
  });
  it("includes overnight events on each actual local day", () => {
    const overnight = {
      ...event,
      start: "2026-10-15T23:30:00Z",
      end: "2026-10-16T00:30:00Z",
    };
    expect(eventOnDay(overnight, "2026-10-15", "UTC")).toBe(true);
    expect(eventOnDay(overnight, "2026-10-16", "UTC")).toBe(true);
    expect(eventOnDay(overnight, "2026-10-15", "Asia/Bangkok")).toBe(false);
  });
  it("uses real day boundaries across DST and exposes offsets for ambiguous clocks", () => {
    const spring = dayRange("2026-03-08", "America/New_York");
    const fall = dayRange("2026-11-01", "America/New_York");
    expect(Date.parse(spring.end) - Date.parse(spring.start)).toBe(
      23 * 3600000,
    );
    expect(Date.parse(fall.end) - Date.parse(fall.start)).toBe(25 * 3600000);
    expect(hasClockChange("2026-11-01", "America/New_York")).toBe(true);
    expect(hasClockChange("2026-10-15", "Asia/Bangkok")).toBe(false);
    const label = meetingLabel(
      { ...event, start: "2026-11-01T05:30:00Z", end: "2026-11-01T06:30:00Z" },
      "America/New_York",
    );
    expect(label).toContain("01:30 (-04:00)");
    expect(label).toContain("01:30 (-05:00)");
    expect(minuteOnDay("2026-10-15T09:00:30Z", "2026-10-15", "UTC")).toBe(
      540.5,
    );
    expect(
      meetingLabel({ ...event, start: "2026-10-15T09:00:30Z" }, "UTC"),
    ).toContain("09:00:30");
  });
  it("only accepts HTTPS Google event links", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://calendar.google.com.evil.test",
      "http://calendar.google.com/event",
      "invalid",
    ])
      expect(safeEventUrl(url)).toBeUndefined();
    expect(
      safeEventUrl("https://calendar.google.com/calendar/event?eid=1"),
    ).toContain("eid=1");
  });
});
