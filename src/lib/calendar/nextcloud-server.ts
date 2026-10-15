import { XMLParser, XMLValidator } from "fast-xml-parser";
import ICAL from "ical.js";
import { Temporal } from "@js-temporal/polyfill";
import type { ExternalCalendarEvent } from "../../domain/models";
import { dayRange, eventOnDay, safeMeetingUrl } from "../../domain/calendar";

export class NextcloudError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function nextcloudBase(value = process.env.NEXTCLOUD_URL) {
  if (!value)
    throw new NextcloudError(
      "Nextcloud setup needed: configure the server-only NEXTCLOUD_URL environment variable.",
      503,
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NextcloudError("NEXTCLOUD_URL is invalid.", 503);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new NextcloudError(
      "NEXTCLOUD_URL must be an HTTPS installation URL without credentials, query or fragment.",
      503,
    );
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}
/** Never accepts an arbitrary upstream: every discovery/calendar href must stay in the configured DAV tree. */
export function davUrl(href: string, base: URL) {
  const url = new URL(href, base);
  const prefix = `${base.pathname}remote.php/dav/`;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    throw new NextcloudError("Invalid calendar address.");
  }
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !decoded.startsWith(prefix) ||
    decoded.split("/").some((p) => p === "." || p === "..") ||
    /[\\\x00-\x1f%]/.test(decoded)
  )
    throw new NextcloudError(
      "Nextcloud returned a calendar address outside its configured DAV service.",
    );
  return url;
}
export async function boundedText(response: Response | Request, max: number) {
  if (Number(response.headers.get("content-length")) > max)
    throw new NextcloudError(
      "Calendar response is too large. Select fewer calendars.",
      413,
    );
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let result = "",
    size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new NextcloudError(
          "Calendar response is too large. Select fewer calendars.",
          413,
        );
      }
      result += decoder.decode(part.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
type Row = {
  href?: string;
  status?: string;
  propstat?: { status?: string; prop?: Record<string, unknown> }[];
};
export function davRows(
  xml: string,
): { href: string; props: Record<string, unknown> }[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new NextcloudError("Nextcloud returned invalid calendar XML.", 502);
  const result = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: false,
    isArray: (name) =>
      name === "response" || name === "propstat" || name === "comp",
  }).parse(xml);
  const rows: Row[] | undefined = result.multistatus?.response;
  if (!Array.isArray(rows))
    throw new NextcloudError(
      "Nextcloud did not return a DAV calendar response.",
      502,
    );
  return rows.map((row) => {
    if (row.status && !/\s2\d\d\s/.test(row.status))
      throw new NextcloudError(
        "Nextcloud could not read every requested calendar item. Cached events are unchanged.",
        502,
      );
    const props = Object.assign(
      {},
      ...(row.propstat ?? [])
        .filter((p) => /\s200\s/.test(p.status ?? ""))
        .map((p) => p.prop ?? {}),
    );
    return { href: typeof row.href === "string" ? row.href : "", props };
  });
}
const propfind = (props: string) =>
  `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${props}</d:prop></d:propfind>`;
const hrefValue = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "href" in value &&
  typeof value.href === "string"
    ? value.href
    : undefined;
export interface NextcloudCredentials {
  username: string;
  password: string;
}
export function nextcloudClient(
  base: URL,
  credentials: NextcloudCredentials,
  signal: AbortSignal,
) {
  const auth = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString("base64")}`;
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
  async function request(
    href: string,
    method: "PROPFIND" | "REPORT",
    body: string,
    depth: "0" | "1",
  ) {
    const response = await fetch(davUrl(href, base), {
      method,
      body,
      headers: {
        Authorization: auth,
        "Content-Type": "application/xml; charset=utf-8",
        Depth: depth,
      },
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
    });
    if (response.status === 401)
      throw new NextcloudError(
        "Nextcloud rejected the username or app password. Generate an app password in Nextcloud’s Security settings.",
        401,
      );
    if (response.status === 403)
      throw new NextcloudError(
        "Nextcloud denied access to this calendar. Check account permissions.",
        403,
      );
    if (response.status === 429)
      throw new NextcloudError(
        "Nextcloud is rate limiting requests. Try again later.",
        429,
      );
    if (response.status !== 207)
      throw new NextcloudError(
        "Nextcloud’s CalDAV service could not be reached. Check the installation URL and retry.",
        502,
      );
    return davRows(await boundedText(response, 5 * 1024 * 1024));
  }
  async function discover() {
    const root = new URL("remote.php/dav/", base).href;
    const principal = (
      await request(
        root,
        "PROPFIND",
        propfind("<d:current-user-principal/>"),
        "0",
      )
    )
      .map((r) => hrefValue(r.props["current-user-principal"]))
      .find(Boolean);
    if (!principal)
      throw new NextcloudError(
        "Nextcloud did not return an account principal.",
        502,
      );
    const principalUrl = davUrl(principal, base).href;
    const home = (
      await request(
        principalUrl,
        "PROPFIND",
        propfind("<c:calendar-home-set/>"),
        "0",
      )
    )
      .map((r) => hrefValue(r.props["calendar-home-set"]))
      .find(Boolean);
    if (!home)
      throw new NextcloudError(
        "Nextcloud Calendar is unavailable for this account.",
        502,
      );
    const rows = await request(
      home,
      "PROPFIND",
      propfind(
        "<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/>",
      ),
      "1",
    );
    const calendars = rows
      .filter((r) => {
        const type = r.props.resourcetype as
          Record<string, unknown> | undefined;
        const supported = r.props["supported-calendar-component-set"] as
          { comp?: { "@_name"?: string }[] } | undefined;
        return (
          type &&
          Object.hasOwn(type, "calendar") &&
          (!supported || supported.comp?.some((c) => c["@_name"] === "VEVENT"))
        );
      })
      .map((r) => ({
        id: davUrl(r.href, base).href,
        title: String(r.props.displayname || "Calendar"),
      }));
    return {
      id: `nextcloud:${principalUrl}`,
      provider: "nextcloud" as const,
      serverUrl: base.href,
      accountLabel: credentials.username,
      calendars,
    };
  }
  async function events(
    connectionId: string,
    calendarIds: string[],
    date: string,
    timezone: string,
  ) {
    const range = dayRange(date, timezone);
    const min = Temporal.Instant.from(range.start)
      .subtract({ hours: 48 })
      .toString()
      .replace(/[-:]/g, "");
    const max = Temporal.Instant.from(range.end)
      .add({ hours: 48 })
      .toString()
      .replace(/[-:]/g, "");
    const query = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="${min}" end="${max}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${min}" end="${max}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const events: ExternalCalendarEvent[] = [];
    for (const calendarId of calendarIds) {
      const rows = await request(calendarId, "REPORT", query, "1");
      for (const row of rows) {
        const data = row.props["calendar-data"];
        if (typeof data !== "string")
          throw new NextcloudError(
            "Nextcloud returned incomplete event data. Cached events are unchanged.",
            502,
          );
        events.push(
          ...parseExpandedCalendar(data, connectionId, calendarId, base).filter(
            (e) => eventOnDay(e, date, timezone),
          ),
        );
        if (events.length > 10000)
          throw new NextcloudError("Too many events for one day.", 413);
      }
    }
    return [...new Map(events.map((e) => [e.id, e])).values()];
  }
  return { discover, events };
}
/** CalDAV expand resolves RRULE/EXDATE/overrides server-side; never guess if the server ignores it. */
export function parseExpandedCalendar(
  data: string,
  connectionId: string,
  calendarId: string,
  base: URL,
): ExternalCalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(data));
  if (root.name !== "vcalendar")
    throw new NextcloudError("Invalid iCalendar document.", 502);
  return root.getAllSubcomponents("vevent").flatMap((component) => {
    if (component.getFirstPropertyValue("status") === "CANCELLED") return [];
    if (component.hasProperty("rrule") || component.hasProperty("rdate"))
      throw new NextcloudError(
        "Nextcloud did not expand recurring events. Check CalDAV support; cached events are unchanged.",
        502,
      );
    const event = new ICAL.Event(component);
    const start = event.startDate,
      end = event.endDate;
    if (!event.uid || !start || !end || start.isDate !== end.isDate)
      throw new NextcloudError("Invalid calendar event range.", 502);
    const convert = (time: typeof start) => {
      if (time.isDate) return time.toString();
      if (time.zone.tzid === "floating")
        throw new NextcloudError(
          "Nextcloud returned a timed event without a resolvable timezone.",
          502,
        );
      return time.toJSDate().toISOString();
    };
    const startValue = convert(start),
      endValue = convert(end);
    if (endValue <= startValue)
      throw new NextcloudError(
        "Nextcloud returned an empty or reversed event range.",
        502,
      );
    const recurrence = component.getFirstPropertyValue("recurrence-id") as
      typeof start | null;
    const externalId = JSON.stringify([
      event.uid,
      recurrence ? convert(recurrence) : "",
    ]);
    const url = safeMeetingUrl(
      String(component.getFirstPropertyValue("url") ?? ""),
    );
    return [
      {
        id: JSON.stringify([connectionId, calendarId, externalId]),
        connectionId,
        calendarId,
        externalId,
        provider: "nextcloud" as const,
        title: event.summary || "Busy",
        start: startValue,
        end: endValue,
        allDay: start.isDate,
        sourceUrl: new URL("index.php/apps/calendar/", base).href,
        meetingUrl: url,
      },
    ];
  });
}
