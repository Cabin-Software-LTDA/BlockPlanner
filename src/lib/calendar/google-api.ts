import { Temporal } from "@js-temporal/polyfill";
import type { ExternalCalendarEvent } from "@/domain/models";
import { dayRange, safeEventUrl, safeMeetingUrl } from "../../domain/calendar";
export interface GoogleCalendar {
  id: string;
  summary?: string;
  primary?: boolean;
}
export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}
export class CalendarApiError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? "Google access expired. Reconnect to refresh meetings."
        : status === 403
          ? "Google denied access. Check Calendar API setup and the granted permissions."
          : status === 429
            ? "Google is rate limiting requests. Please try again later."
            : "Google Calendar could not be refreshed. Your cached meetings are unchanged.",
    );
  }
}
async function pages<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  signal: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  let pageToken = "";
  const seen = new Set<string>();
  do {
    const query = new URLSearchParams({
      ...params,
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/${path}?${query}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        cache: "no-store",
        credentials: "omit",
      },
    );
    if (!response.ok) throw new CalendarApiError(response.status);
    const result = (await response.json()) as {
      items?: T[];
      nextPageToken?: string;
    };
    items.push(...(result.items ?? []));
    pageToken = result.nextPageToken ?? "";
    if (pageToken && seen.has(pageToken))
      throw new Error(
        "Google returned an invalid page sequence. Please retry.",
      );
    seen.add(pageToken);
  } while (pageToken);
  return items;
}
export function listCalendars(token: string, signal: AbortSignal) {
  return pages<GoogleCalendar>(
    "users/me/calendarList",
    { maxResults: "250", fields: "items(id,summary,primary),nextPageToken" },
    token,
    signal,
  );
}
export function normalizeEvent(
  item: GoogleEvent,
  connectionId: string,
  calendarId: string,
): ExternalCalendarEvent | null {
  if (item.status === "cancelled") return null;
  const allDay = Boolean(item.start?.date);
  const start = allDay
    ? Temporal.PlainDate.from(item.start!.date!).toString()
    : Temporal.Instant.from(item.start?.dateTime ?? "").toString();
  const end = allDay
    ? Temporal.PlainDate.from(item.end?.date ?? "").toString()
    : Temporal.Instant.from(item.end?.dateTime ?? "").toString();
  if (
    !item.id ||
    (allDay ? end <= start : Date.parse(end) <= Date.parse(start))
  )
    throw new Error(
      "Google returned an invalid event range. Cached meetings were preserved.",
    );
  return {
    id: JSON.stringify([connectionId, calendarId, item.id]),
    connectionId,
    calendarId,
    externalId: item.id,
    title: item.summary || "Busy",
    start,
    end,
    allDay,
    sourceUrl: safeEventUrl(item.htmlLink),
    meetingUrl: safeMeetingUrl(item.hangoutLink),
  };
}
export async function fetchDay(
  token: string,
  connectionId: string,
  calendarIds: string[],
  date: string,
  timezone: string,
  signal: AbortSignal,
) {
  const range = dayRange(date, timezone);
  // Include a date margin for all-day calendars whose timezone differs from the viewer.
  const timeMin = Temporal.Instant.from(range.start)
    .subtract({ hours: 48 })
    .toString();
  const timeMax = Temporal.Instant.from(range.end)
    .add({ hours: 48 })
    .toString();
  const results = await Promise.all(
    calendarIds.map(async (calendarId) => {
      const items = await pages<GoogleEvent>(
        `calendars/${encodeURIComponent(calendarId)}/events`,
        {
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "2500",
          timeZone: timezone,
          fields:
            "items(id,status,summary,start,end,htmlLink,hangoutLink),nextPageToken",
        },
        token,
        signal,
      );
      return items.flatMap((item) => {
        const event = normalizeEvent(item, connectionId, calendarId);
        return event ? [event] : [];
      });
    }),
  );
  return results.flat();
}
