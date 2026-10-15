import { describe, expect, it } from "vitest";
import {
  buildOccurrence,
  datesForView,
  matchesDate,
  occurrenceId,
  validateRoutine,
  type Routine,
} from "./recurrence";
const routine: Routine = {
  id: "routine",
  title: "Study",
  color: "sage",
  icon: "book",
  timezone: "UTC",
  startTime: "08:00",
  endTime: "10:00",
  endDayOffset: 0,
  recurrence: {
    frequency: "weekly",
    weekdays: [1, 2, 3, 4, 5],
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
  },
};
describe("recurrence rules", () => {
  it("uses ISO weekdays and inclusive start/end dates", () => {
    expect(matchesDate(routine, "2026-10-01")).toBe(true);
    expect(matchesDate(routine, "2026-10-02")).toBe(true);
    expect(matchesDate(routine, "2026-10-03")).toBe(false);
    expect(matchesDate(routine, "2026-09-30")).toBe(false);
    expect(matchesDate(routine, "2026-11-02")).toBe(false);
    const daily = {
      ...routine,
      recurrence: { ...routine.recurrence, frequency: "daily" as const },
    };
    expect(matchesDate(daily, "2026-10-31")).toBe(true);
  });
  it("supports leap days and year boundaries", () => {
    const daily = {
      ...routine,
      recurrence: {
        frequency: "daily" as const,
        weekdays: [],
        startsOn: "2023-12-31",
      },
    };
    for (const day of ["2023-12-31", "2024-01-01", "2024-02-29"])
      expect(matchesDate(daily, day)).toBe(true);
  });
  it("validates rules and normalizes selected weekdays", () => {
    expect(
      validateRoutine({
        ...routine,
        recurrence: { ...routine.recurrence, weekdays: [5, 1, 5] },
      }).recurrence.weekdays,
    ).toEqual([1, 5]);
    expect(() =>
      validateRoutine({
        ...routine,
        recurrence: { ...routine.recurrence, weekdays: [] },
      }),
    ).toThrow("weekday");
    expect(() =>
      validateRoutine({
        ...routine,
        recurrence: { ...routine.recurrence, weekdays: [0] },
      }),
    ).toThrow();
    expect(() =>
      validateRoutine({
        ...routine,
        recurrence: { ...routine.recurrence, endsOn: "2026-09-01" },
      }),
    ).toThrow();
    expect(() =>
      validateRoutine({
        ...routine,
        recurrence: { ...routine.recurrence, startsOn: "invalid" },
      }),
    ).toThrow();
    expect(() => validateRoutine({ ...routine, endTime: "08:00" })).toThrow();
    expect(() =>
      validateRoutine({ ...routine, timezone: "invalid" }),
    ).toThrow();
  });
  it("builds stable, independent dated identities", () => {
    const a = buildOccurrence(routine, "2026-10-15");
    const b = buildOccurrence(routine, "2026-10-16");
    expect(a.id).toBe(occurrenceId(routine.id, "2026-10-15"));
    expect(a.id).not.toBe(b.id);
    expect(a).toEqual(buildOccurrence(routine, "2026-10-15"));
    expect(a.overridden).toBe(false);
  });
  it("preserves local routine hours across DST offset changes", () => {
    const ny = { ...routine, timezone: "America/New_York" };
    expect(buildOccurrence(ny, "2026-10-30").start).toBe(
      "2026-10-30T12:00:00Z",
    );
    expect(buildOccurrence(ny, "2026-11-02").start).toBe(
      "2026-11-02T13:00:00Z",
    );
  });
  it("rejects DST gaps and folds instead of shifting occurrences", () => {
    expect(() =>
      buildOccurrence(
        {
          ...routine,
          timezone: "America/New_York",
          startTime: "02:30",
          endTime: "03:30",
        },
        "2026-03-08",
      ),
    ).toThrow();
    expect(() =>
      buildOccurrence(
        {
          ...routine,
          timezone: "America/New_York",
          startTime: "01:30",
          endTime: "02:30",
        },
        "2026-11-01",
      ),
    ).toThrow();
  });
  it("builds overnight and full-day intervals", () => {
    expect(
      buildOccurrence(
        { ...routine, startTime: "23:00", endTime: "01:00", endDayOffset: 1 },
        "2026-12-31",
      ).end,
    ).toBe("2027-01-01T01:00:00Z");
    expect(
      buildOccurrence(
        { ...routine, startTime: "08:00", endTime: "08:00", endDayOffset: 1 },
        "2026-10-15",
      ).end,
    ).toBe("2026-10-16T08:00:00Z");
  });
  it("includes overnight tails and distant timezone dates for a visible day", () => {
    expect(
      datesForView("2026-10-16", "Asia/Bangkok", "Asia/Bangkok"),
    ).toContain("2026-10-15");
    const dates = datesForView(
      "2026-10-15",
      "Pacific/Honolulu",
      "Pacific/Kiritimati",
    );
    expect(dates).toContain("2026-10-16");
    expect(dates.length).toBeLessThanOrEqual(4);
  });
});
