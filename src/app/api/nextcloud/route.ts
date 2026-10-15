import {
  boundedText,
  davUrl,
  nextcloudBase,
  nextcloudClient,
  NextcloudError,
} from "../../../lib/calendar/nextcloud-server";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
};
export function GET() {
  try {
    nextcloudBase();
    return Response.json({ configured: true }, { headers });
  } catch {
    return Response.json({ configured: false }, { headers });
  }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new NextcloudError(
        "Use the Nextcloud connector from this TimeBlock site.",
        403,
      );
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new NextcloudError("Expected a JSON request.", 415);
    const input = JSON.parse(await boundedText(request, 20000));
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.username !== "string" ||
      !input.username.trim() ||
      input.username.length > 320 ||
      /[:\r\n]/.test(input.username) ||
      typeof input.password !== "string" ||
      !input.password ||
      input.password.length > 1024
    )
      throw new NextcloudError(
        "Enter your Nextcloud username and app password.",
      );
    const base = nextcloudBase();
    const client = nextcloudClient(
      base,
      { username: input.username, password: input.password },
      request.signal,
    );
    if (input.action === "discover")
      return Response.json(await client.discover(), { headers });
    if (
      input.action !== "events" ||
      typeof input.connectionId !== "string" ||
      !input.connectionId.startsWith(`nextcloud:${base.origin}`) ||
      !Array.isArray(input.calendarIds) ||
      input.calendarIds.length > 10 ||
      input.calendarIds.some((id: unknown) => typeof id !== "string") ||
      typeof input.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      typeof input.timezone !== "string"
    )
      throw new NextcloudError(
        "Invalid calendar refresh request. Select up to 10 calendars.",
      );
    davUrl(input.connectionId.slice("nextcloud:".length), base);
    input.calendarIds.forEach((id: string) => davUrl(id, base));
    return Response.json(
      {
        events: await client.events(
          input.connectionId,
          [...new Set<string>(input.calendarIds)],
          input.date,
          input.timezone,
        ),
      },
      { headers },
    );
  } catch (error) {
    // Never return upstream bodies, credentials, stack traces, or fetch errors containing URLs.
    return Response.json(
      {
        error:
          error instanceof NextcloudError
            ? error.message
            : "Nextcloud could not be read. Check the server connection and retry; cached events are unchanged.",
      },
      { status: error instanceof NextcloudError ? error.status : 502, headers },
    );
  }
}
