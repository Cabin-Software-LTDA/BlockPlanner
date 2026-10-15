import { afterEach, expect, it, vi } from "vitest";
import { fetchDay, listCalendars, normalizeEvent } from "./google-api";
afterEach(() => vi.unstubAllGlobals());
const sample = {
  id: "series_instance_1",
  summary: "Standup",
  start: { dateTime: "2026-10-15T09:00:00+07:00" },
  end: { dateTime: "2026-10-15T09:30:00+07:00" },
};
it("normalizes instants and keys recurring instances by account/calendar/event", () => {
  const event = normalizeEvent(sample, "account1", "calendar1")!;
  expect(event.start).toBe("2026-10-15T02:00:00Z");
  expect(normalizeEvent(sample, "account2", "calendar1")!.id).not.toBe(
    event.id,
  );
  expect(
    normalizeEvent(
      { ...sample, id: "series_instance_2" },
      "account1",
      "calendar1",
    )!.id,
  ).not.toBe(event.id);
  expect(
    normalizeEvent(
      { id: "cancelled", status: "cancelled" },
      "account1",
      "calendar1",
    ),
  ).toBeNull();
  expect(
    normalizeEvent(
      { id: "day", start: { date: "2026-10-15" }, end: { date: "2026-10-16" } },
      "a",
      "c",
    ),
  ).toMatchObject({ allDay: true, start: "2026-10-15", end: "2026-10-16" });
  expect(() =>
    normalizeEvent({ ...sample, end: sample.start }, "a", "c"),
  ).toThrow();
});
it("retrieves every calendar list page", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: "one" }], nextPageToken: "next" }),
    )
    .mockResolvedValueOnce(Response.json({ items: [{ id: "two" }] }));
  vi.stubGlobal("fetch", fetch);
  expect(
    await listCalendars("test-token", new AbortController().signal),
  ).toEqual([{ id: "one" }, { id: "two" }]);
  expect(fetch.mock.calls[1][0]).toContain("pageToken=next");
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer test-token",
  );
  expect(fetch.mock.calls[0][0]).not.toContain("test-token");
});
it("expands recurring events, encodes calendar IDs and fails the entire refresh on a later page failure", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ items: [sample], nextPageToken: "next" }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    fetchDay(
      "test-token",
      "a",
      ["calendar/+@example.com"],
      "2026-10-15",
      "Asia/Bangkok",
      new AbortController().signal,
    ),
  ).rejects.toThrow("expired");
  expect(fetch.mock.calls[0][0]).toContain("singleEvents=true");
  expect(fetch.mock.calls[0][0]).toContain("calendar%2F%2B%40example.com");
});
it("returns independent overlapping events from all selected calendars", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json({ items: [sample] })),
  );
  const events = await fetchDay(
    "test-token",
    "a",
    ["one", "two"],
    "2026-10-15",
    "UTC",
    new AbortController().signal,
  );
  expect(events).toHaveLength(2);
  expect(new Set(events.map((e) => e.id)).size).toBe(2);
});
