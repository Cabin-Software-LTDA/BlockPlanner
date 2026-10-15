"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/database";
import {
  cacheDay,
  chooseCalendars,
  disconnectCalendar,
  rangeKey,
  saveConnection,
} from "@/lib/db/calendar";
import {
  accessToken,
  authorize,
  clearToken,
  loadIdentity,
  revokeAccess,
} from "@/lib/calendar/auth";
import {
  CalendarApiError,
  fetchDay,
  listCalendars,
} from "@/lib/calendar/google-api";
import { eventOnDay } from "@/domain/calendar";

export function useGoogleCalendar(date: string, timezone?: string) {
  const data = useLiveQuery(
    async () => ({
      connection: await db.connections.toCollection().first(),
      events: await db.events.toArray(),
    }),
    [],
  );
  const [identityReady, setIdentityReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState(0);
  const [authorized, setAuthorized] = useState(false);
  const request = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const authorizedAccount = useRef<string | null>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const connection = data?.connection;
  const cancel = useCallback(() => {
    operation.current++;
    request.current?.abort();
    request.current = null;
  }, []);
  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setAuthorized(
          Boolean(accessToken()) &&
            authorizedAccount.current === connection?.id,
        ),
      15000,
    );
    return () => clearInterval(timer);
  }, [connection?.id]);
  useEffect(() => {
    if (
      authorizedAccount.current &&
      connection?.id !== authorizedAccount.current
    ) {
      clearToken();
      authorizedAccount.current = null;
      setAuthorized(false);
      setBusy(false);
    }
    if (!date || !timezone || !connection) return;
    cancel();
    const token =
      authorizedAccount.current === connection.id ? accessToken() : undefined;
    if (!token) {
      setAuthorized(false);
      setBusy(false);
      return;
    }
    setAuthorized(true);
    const controller = new AbortController();
    request.current = controller;
    const revision = operation.current;
    const current = () =>
      !controller.signal.aborted && operation.current === revision;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const events = await fetchDay(
          token,
          connection.id,
          connection.calendarIds,
          date,
          timezone,
          controller.signal,
        );
        if (current())
          await cacheDay(connection, date, timezone, events, current);
      } catch (e) {
        if (current()) {
          if (e instanceof CalendarApiError && e.status === 401) {
            clearToken();
            setAuthorized(false);
          }
          setError(
            e instanceof Error
              ? e.message
              : "Refresh failed. Cached meetings are unchanged.",
          );
        }
      } finally {
        if (current()) setBusy(false);
      }
    })();
    return () => controller.abort();
    // Metadata updates after a successful refresh must not cause another refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, timezone, connection?.id, connection?.revision, session, cancel]);

  async function prepare() {
    cancel();
    const revision = operation.current;
    setBusy(true);
    setError("");
    try {
      await loadIdentity();
      if (revision !== operation.current) return;
      setIdentityReady(true);
    } catch (e) {
      if (revision === operation.current)
        setError(e instanceof Error ? e.message : "Google could not load.");
    } finally {
      if (revision === operation.current) setBusy(false);
    }
  }
  async function connect() {
    cancel();
    const revision = operation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // authorize is called before any await so this remains a user-initiated popup.
      const token = await authorize(clientId);
      if (revision !== operation.current) return;
      const controller = new AbortController();
      request.current = controller;
      const calendars = await listCalendars(token, controller.signal);
      if (revision !== operation.current) return;
      const primary = calendars.find((c) => c.primary);
      if (!primary)
        throw new Error(
          "Google did not return a primary calendar for this account.",
        );
      const id = `google:${primary.id}`;
      const existing = await db.connections.get(id);
      if (revision !== operation.current) return;
      authorizedAccount.current = id;
      await saveConnection(
        {
          id,
          provider: "google",
          accountLabel: primary.id,
          revision: crypto.randomUUID(),
          calendarIds: existing
            ? existing.calendarIds.filter((id) =>
                calendars.some((c) => c.id === id),
              )
            : [primary.id],
          calendars: calendars.map((c) => ({
            id: c.id,
            title: c.summary ?? c.id,
            primary: c.primary,
          })),
        },
        db,
        () => revision === operation.current,
      );
      if (revision !== operation.current) return;
      setAuthorized(true);
    } catch (e) {
      if (revision === operation.current) {
        clearToken();
        setAuthorized(false);
        setError(e instanceof Error ? e.message : "Connection failed.");
      }
    } finally {
      if (revision === operation.current) setBusy(false);
    }
  }
  async function selectCalendar(id: string, selected: boolean) {
    if (!connection) return;
    cancel();
    setBusy(true);
    setError("");
    try {
      await chooseCalendars(
        connection.id,
        selected
          ? [...new Set([...connection.calendarIds, id])]
          : connection.calendarIds.filter((c) => c !== id),
      );
    } catch {
      setError("Calendar selection could not be saved. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    cancel();
    setBusy(true);
    setError("");
    const revoking = revokeAccess();
    setAuthorized(false);
    try {
      await disconnectCalendar();
      const revoked = await revoking;
      setNotice(
        revoked
          ? "Disconnected. Google permission revoked and cached meetings removed."
          : "Disconnected locally. To remove Google permission too, use your Google Account connections page.",
      );
    } catch {
      setError(
        "Local calendar data could not be removed. Please retry disconnecting.",
      );
    } finally {
      setBusy(false);
    }
  }
  return {
    connection,
    events:
      date && timezone
        ? (data?.events ?? []).filter(
            (e) =>
              connection?.calendarIds.includes(e.calendarId) &&
              e.connectionId === connection.id &&
              eventOnDay(e, date, timezone),
          )
        : [],
    syncedAt:
      date && timezone
        ? connection?.syncedRanges?.[rangeKey(date, timezone)]
        : undefined,
    busy,
    error,
    notice,
    authorized,
    identityReady,
    configured: Boolean(clientId),
    prepare,
    connect,
    disconnect,
    selectCalendar,
    cancelUpdate: () => {
      cancel();
      clearToken();
      authorizedAccount.current = null;
      setAuthorized(false);
      setBusy(false);
      setNotice("Update cancelled. Reconnect when ready.");
    },
    refresh: () => {
      setError("");
      setSession((s) => s + 1);
    },
  };
}
export type CalendarState = ReturnType<typeof useGoogleCalendar>;
