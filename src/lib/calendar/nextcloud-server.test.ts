import { afterEach, expect, it, vi } from "vitest";
import {
  davRows,
  davUrl,
  nextcloudBase,
  nextcloudClient,
  parseExpandedCalendar,
} from "./nextcloud-server";
import { GET, POST } from "../../app/api/nextcloud/route";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const base = new URL("https://cloud.example.com/team/");
const calendarId = `${base}remote.php/dav/calendars/user/work/`;
const connectionId = `nextcloud:${base}remote.php/dav/principals/users/user/`;
const ics = (events: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
const timed =
  "BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART:20261015T150000Z\r\nDTEND:20261015T160000Z\r\nSUMMARY:Team\\, meeting\r\nURL:https://meet.example.com/team\r\nEND:VEVENT";
const xml = (body: string) =>
  `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;
const row = (href: string, props: string, status = "200 OK") =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response>`;
it("keeps all DAV URLs in the configured HTTPS installation, never follows user supplied hosts", () => {
  expect(nextcloudBase("https://cloud.example.com/team").href).toBe(base.href);
  for (const value of [
    "http://cloud.example.com",
    "https://u:p@cloud.example.com",
    "https://cloud.example.com/?token=x",
  ])
    expect(() => nextcloudBase(value)).toThrow();
  expect(davUrl(calendarId, base).href).toBe(calendarId);
  for (const href of [
    "https://evil.example/remote.php/dav/",
    "//evil.example/a",
    "/admin/",
    "/team/remote.php/dav/%2e%2e/admin",
    "/team/remote.php/dav/%252e%252e/admin",
    `${calendarId}?x=1`,
  ])
    expect(() => davUrl(href, base)).toThrow();
});
it("parses namespace variations and denies DTD/entity documents", () => {
  expect(
    davRows(
      xml(row(calendarId, "<d:displayname>Work &amp; study</d:displayname>")),
    )[0].props.displayname,
  ).toBe("Work & study");
  expect(() => davRows('<!DOCTYPE x [<!ENTITY test "x">]><x/>')).toThrow();
  expect(() => davRows("<not-xml>")).toThrow();
});
it("normalizes timed, all-day and expanded recurrence identities without duplicate tasks", () => {
  const recurring = timed.replace(
    "UID:weekly",
    "UID:weekly\r\nRECURRENCE-ID:20261015T150000Z",
  );
  const second = recurring.replaceAll("20261015", "20261016");
  const day =
    "BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20261015\r\nDTEND;VALUE=DATE:20261017\r\nSUMMARY:Holiday\r\nEND:VEVENT";
  const events = parseExpandedCalendar(
    ics([recurring, second, day].join("\r\n")),
    connectionId,
    calendarId,
    base,
  );
  expect(events).toHaveLength(3);
  expect(new Set(events.map((e) => e.id)).size).toBe(3);
  expect(events[0]).toMatchObject({
    provider: "nextcloud",
    title: "Team, meeting",
    start: "2026-10-15T15:00:00.000Z",
    end: "2026-10-15T16:00:00.000Z",
    meetingUrl: "https://meet.example.com/team",
  });
  expect(events[2]).toMatchObject({
    allDay: true,
    start: "2026-10-15",
    end: "2026-10-17",
  });
  expect(
    parseExpandedCalendar(
      ics(timed.replace("SUMMARY:", "STATUS:CANCELLED\r\nSUMMARY:")),
      connectionId,
      calendarId,
      base,
    ),
  ).toEqual([]);
});
it("rejects unexpanded recurrence and unresolved floating times instead of losing occurrences or guessing timezone", () => {
  expect(() =>
    parseExpandedCalendar(
      ics(timed.replace("UID:weekly", "UID:weekly\r\nRRULE:FREQ=WEEKLY")),
      connectionId,
      calendarId,
      base,
    ),
  ).toThrow("expand recurring");
  expect(() =>
    parseExpandedCalendar(
      ics(timed.replaceAll("0000Z", "0000")),
      connectionId,
      calendarId,
      base,
    ),
  ).toThrow("timezone");
});
it("resolves embedded VTIMEZONE and preserves exact instants", () => {
  const zone =
    "BEGIN:VTIMEZONE\r\nTZID:Custom\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0700\r\nTZOFFSETTO:+0700\r\nEND:STANDARD\r\nEND:VTIMEZONE";
  const event = timed
    .replace("DTSTART:20261015T150000Z", "DTSTART;TZID=Custom:20261015T150000")
    .replace("DTEND:20261015T160000Z", "DTEND;TZID=Custom:20261015T160000");
  expect(
    parseExpandedCalendar(
      ics(`${zone}\r\n${event}`),
      connectionId,
      calendarId,
      base,
    )[0].start,
  ).toBe("2026-10-15T08:00:00.000Z");
});
it("discovers calendars with PROPFIND and retrieves expanded events using read-only REPORT", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        xml(
          row(
            "/team/remote.php/dav/",
            "<d:current-user-principal><d:href>/team/remote.php/dav/principals/users/user/</d:href></d:current-user-principal>",
          ),
        ),
        { status: 207 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        xml(
          row(
            "/team/remote.php/dav/principals/users/user/",
            "<c:calendar-home-set><d:href>/team/remote.php/dav/calendars/user/</d:href></c:calendar-home-set>",
          ),
        ),
        { status: 207 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        xml(
          row(
            calendarId,
            '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>',
          ),
        ),
        { status: 207 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        xml(
          row(
            `${calendarId}event.ics`,
            `<c:calendar-data><![CDATA[${ics(timed)}]]></c:calendar-data>`,
          ),
        ),
        { status: 207 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const client = nextcloudClient(
    base,
    { username: "user", password: "app-password" },
    new AbortController().signal,
  );
  const connection = await client.discover();
  expect(connection.id).toBe(connectionId);
  expect(connection.calendars).toEqual([{ id: calendarId, title: "Work" }]);
  expect(JSON.stringify(connection)).not.toContain("app-password");
  expect(
    await client.events(connection.id, [calendarId], "2026-10-15", "UTC"),
  ).toHaveLength(1);
  expect(fetch.mock.calls.map((call) => call[1].method)).toEqual([
    "PROPFIND",
    "PROPFIND",
    "PROPFIND",
    "REPORT",
  ]);
  expect(fetch.mock.calls[3][1].body).toContain(
    '<c:expand start="20261013T000000Z" end="20261018T000000Z"',
  );
  expect(fetch.mock.calls.every((call) => call[1].redirect === "error")).toBe(
    true,
  );
});
it("rejects incomplete multistatus reads and authentication errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(xml(row(`${calendarId}event.ics`, "", "403 Forbidden")), {
          status: 207,
        }),
      ),
  );
  const client = nextcloudClient(
    base,
    { username: "user", password: "secret" },
    new AbortController().signal,
  );
  await expect(
    client.events(connectionId, [calendarId], "2026-10-15", "UTC"),
  ).rejects.toThrow("incomplete");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("private upstream error", { status: 401 }),
      ),
  );
  await expect(client.discover()).rejects.toThrow("app password");
});
it("route rejects cross-origin requests and arbitrary calendar destinations before forwarding credentials", async () => {
  vi.stubEnv("NEXTCLOUD_URL", base.href);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await GET().json()).toEqual({ configured: true });
  const input = {
    action: "events",
    username: "user",
    password: "secret",
    connectionId,
    calendarIds: ["https://evil.example/remote.php/dav/"],
    date: "2026-10-15",
    timezone: "UTC",
  };
  const make = (origin: string) =>
    new Request("https://planner.example/api/nextcloud", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  expect((await POST(make("https://evil.example"))).status).toBe(403);
  expect((await POST(make("https://planner.example"))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("route sanitizes transport failures and disables caching", async () => {
  vi.stubEnv("NEXTCLOUD_URL", base.href);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(
        new Error("secret credentials in hypothetical transport error"),
      ),
  );
  const response = await POST(
    new Request("https://planner.example/api/nextcloud", {
      method: "POST",
      headers: {
        origin: "https://planner.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "discover",
        username: "user",
        password: "secret",
      }),
    }),
  );
  expect(response.status).toBe(502);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(await response.text()).not.toContain("secret");
});
