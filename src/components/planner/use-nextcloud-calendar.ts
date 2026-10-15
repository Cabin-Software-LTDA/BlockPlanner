"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type {
  CalendarConnection,
  ExternalCalendarEvent,
} from "@/domain/models";
import { eventOnDay } from "@/domain/calendar";
import { db } from "@/lib/db/database";
import {
  cacheDay,
  chooseCalendars,
  disconnectCalendar,
  rangeKey,
  saveConnection,
} from "@/lib/db/calendar";
interface Credentials {
  username: string;
  password: string;
  connectionId?: string;
}
class ConnectionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(input: object, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api/nextcloud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ConnectionError(
      result.error || "Nextcloud request failed.",
      response.status,
    );
  return result;
}
export function useNextcloudCalendar(date: string, timezone?: string) {
  const data = useLiveQuery(
    async () => ({
      connection: await db.connections
        .filter((c) => c.provider === "nextcloud")
        .first(),
      events: await db.events.toArray(),
    }),
    [],
  );
  const connection = data?.connection;
  const credentials = useRef<Credentials | null>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(0);
  const cancel = useCallback(() => {
    epoch.current++;
    controller.current?.abort();
    controller.current = null;
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/nextcloud", { cache: "no-store", signal: abort.signal })
      .then((r) => r.json())
      .then((r) => setConfigured(r.configured === true))
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Could not check Nextcloud setup. Reload to retry.");
      });
    return () => {
      abort.abort();
      cancel();
      credentials.current = null;
    };
  }, [cancel]);
  useEffect(() => {
    cancel();
    const auth = credentials.current;
    if (
      !connection ||
      !auth ||
      auth.connectionId !== connection.id ||
      !date ||
      !timezone
    ) {
      if (auth && connection && auth.connectionId !== connection.id)
        credentials.current = null;
      setAuthorized(false);
      setBusy(false);
      return;
    }
    setAuthorized(true);
    const abort = new AbortController();
    controller.current = abort;
    const version = epoch.current;
    const current = () => epoch.current === version && !abort.signal.aborted;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const result = await request<{ events: ExternalCalendarEvent[] }>(
          {
            action: "events",
            ...auth,
            connectionId: connection.id,
            calendarIds: connection.calendarIds,
            date,
            timezone,
          },
          abort.signal,
        );
        if (current())
          await cacheDay(connection, date, timezone, result.events, current);
      } catch (error) {
        if (current()) {
          if (error instanceof ConnectionError && error.status === 401) {
            credentials.current = null;
            setAuthorized(false);
          }
          setError(
            error instanceof Error
              ? error.message
              : "Nextcloud refresh failed.",
          );
        }
      } finally {
        if (current()) setBusy(false);
      }
    })();
    return () => abort.abort();
  }, [date, timezone, connection?.id, connection?.revision, session, cancel]);
  async function connect(username: string, password: string) {
    cancel();
    const version = epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    const current = () => epoch.current === version && !abort.signal.aborted;
    setBusy(true);
    setError("");
    try {
      const discovered = await request<
        Pick<
          CalendarConnection,
          "id" | "provider" | "serverUrl" | "accountLabel" | "calendars"
        >
      >(
        { action: "discover", username: username.trim(), password },
        abort.signal,
      );
      if (!current()) return;
      const existing = await db.connections.get(discovered.id);
      if (!current()) return;
      const calendarIds = existing
        ? existing.calendarIds.filter((id) =>
            discovered.calendars?.some((c) => c.id === id),
          )
        : (discovered.calendars ?? []).slice(0, 10).map((c) => c.id);
      // Bind credentials to the discovered principal before storing metadata or starting refresh.
      credentials.current = {
        username: username.trim(),
        password,
        connectionId: discovered.id,
      };
      await saveConnection(
        { ...discovered, calendarIds, revision: crypto.randomUUID() },
        db,
        current,
      );
      if (current()) {
        setAuthorized(true);
        setSession((s) => s + 1);
      }
    } catch (error) {
      if (current()) {
        credentials.current = null;
        setAuthorized(false);
        setError(
          error instanceof Error
            ? error.message
            : "Nextcloud connection failed.",
        );
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function selectCalendar(id: string, selected: boolean) {
    if (!connection) return;
    const ids = selected
      ? [...new Set([...connection.calendarIds, id])]
      : connection.calendarIds.filter((c) => c !== id);
    if (ids.length > 10) {
      setError("Select up to 10 calendars.");
      return;
    }
    cancel();
    setBusy(true);
    setError("");
    try {
      await chooseCalendars(connection.id, ids);
    } catch {
      setError("Could not save calendar selection.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    cancel();
    credentials.current = null;
    setAuthorized(false);
    setBusy(true);
    setError("");
    try {
      await disconnectCalendar(db, "nextcloud");
    } catch {
      setError("Could not remove local Nextcloud data. Retry disconnecting.");
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
              e.connectionId === connection?.id &&
              connection.calendarIds.includes(e.calendarId) &&
              eventOnDay(e, date, timezone),
          )
        : [],
    syncedAt:
      date && timezone
        ? connection?.syncedRanges?.[rangeKey(date, timezone)]
        : undefined,
    configured,
    authorized,
    busy,
    error,
    connect,
    disconnect,
    selectCalendar,
    refresh: () => setSession((s) => s + 1),
    cancelUpdate: () => {
      cancel();
      credentials.current = null;
      setAuthorized(false);
      setBusy(false);
    },
  };
}
