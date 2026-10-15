import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { TimeBlockDB } from "./database";
import {
  cacheDay,
  chooseCalendars,
  disconnectCalendar,
  saveConnection,
} from "./calendar";
import { addTask } from "./repository";
import type {
  CalendarConnection,
  ExternalCalendarEvent,
} from "@/domain/models";
const databases: TimeBlockDB[] = [];
function database() {
  const db = new TimeBlockDB(crypto.randomUUID());
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases) await db.delete();
  databases.length = 0;
});
const connection: CalendarConnection = {
  id: "google:a",
  provider: "google",
  accountLabel: "a",
  calendarIds: ["one", "two"],
  revision: "v1",
};
const event: ExternalCalendarEvent = {
  id: "one",
  connectionId: connection.id,
  calendarId: "one",
  externalId: "one",
  title: "Old title",
  start: "2026-10-15T09:00:00Z",
  end: "2026-10-15T10:00:00Z",
  allDay: false,
};
it("replaces a day atomically, removes cancelled/moved events, and preserves other days and tasks", async () => {
  const db = database();
  await saveConnection(connection, db);
  await addTask("Keep task", null, db);
  await db.events.bulkPut([
    event,
    {
      ...event,
      id: "other",
      externalId: "other",
      start: "2026-10-16T09:00:00Z",
      end: "2026-10-16T10:00:00Z",
    },
  ]);
  await cacheDay(
    connection,
    "2026-10-15",
    "UTC",
    [{ ...event, title: "Renamed" }],
    () => true,
    db,
  );
  expect((await db.events.get(event.id))?.title).toBe("Renamed");
  await cacheDay(connection, "2026-10-15", "UTC", [], () => true, db);
  expect((await db.events.toArray()).map((e) => e.id)).toEqual(["other"]);
  expect(await db.tasks.count()).toBe(1);
  db.close();
  await db.open();
  expect(
    (await db.connections.get(connection.id))?.syncedRanges?.["2026-10-15@UTC"],
  ).toBeTruthy();
});
it("rejects stale refreshes after selection changes, aborts, and disconnects", async () => {
  const db = database();
  await saveConnection(connection, db);
  expect(
    await cacheDay(connection, "2026-10-15", "UTC", [event], () => false, db),
  ).toBe(false);
  await chooseCalendars(connection.id, ["two"], db);
  expect(
    await cacheDay(connection, "2026-10-15", "UTC", [event], () => true, db),
  ).toBe(false);
  await disconnectCalendar(db);
  expect(
    await cacheDay(connection, "2026-10-15", "UTC", [event], () => true, db),
  ).toBe(false);
  expect(await db.events.count()).toBe(0);
});
it("keeps planner data when disconnecting and removes previous-account caches on account switch", async () => {
  const db = database();
  await addTask("Keep", null, db);
  await saveConnection(connection, db);
  await db.events.put(event);
  await saveConnection({ ...connection, id: "google:b" }, db);
  expect(await db.events.count()).toBe(0);
  await disconnectCalendar(db);
  expect(await db.connections.count()).toBe(0);
  expect(await db.tasks.count()).toBe(1);
});
it("upgrades v1 indexes without losing stored calendar records or tasks", async () => {
  const db = database();
  const legacy = new Dexie(db.name);
  legacy.version(1).stores({
    definitions: "id",
    occurrences: "id, definitionId, date, start, end",
    tasks: "id, occurrenceId, order",
    exceptions: "id, &[definitionId+date]",
    connections: "id",
    events: "id, connectionId, &[calendarId+externalId], start, end",
    preferences: "id",
    layouts: "date",
  });
  await legacy.table("events").put(event);
  await legacy.table("tasks").put({
    id: "task",
    title: "Keep",
    occurrenceId: null,
    order: 0,
    completed: true,
    notes: "",
    createdAt: "2026-10-15",
  });
  legacy.close();
  await db.open();
  expect(await db.events.get(event.id)).toEqual(event);
  expect((await db.tasks.get("task"))?.completed).toBe(true);
  await db.events.put({
    ...event,
    id: "second-account",
    connectionId: "google:b",
  });
  expect(await db.events.count()).toBe(2);
});
it("preserves the same account's offline cache when reconnecting", async () => {
  const db = database();
  await saveConnection(connection, db);
  await cacheDay(connection, "2026-10-15", "UTC", [event], () => true, db);
  await saveConnection({ ...connection, revision: "new-session" }, db);
  expect(await db.events.get(event.id)).toEqual(event);
  expect(
    (await db.connections.get(connection.id))?.syncedRanges?.["2026-10-15@UTC"],
  ).toBeTruthy();
});

it("persists local assignment across refresh/reopen without changing meeting times, and rejects invalid blocks", async () => {
  const { assignMeeting } = await import("./calendar");
  const { createBlock } = await import("./repository");
  const db = database();
  await saveConnection(connection, db);
  await cacheDay(connection, "2026-10-15", "UTC", [event], () => true, db);
  const blockId = await createBlock(
    {
      title: "Work",
      date: "2026-10-15",
      start: "08:00",
      end: "12:00",
      timezone: "UTC",
      color: "sage",
      icon: "briefcase",
    },
    db,
  );
  const short = await createBlock(
    {
      title: "Too short",
      date: "2026-10-15",
      start: "09:30",
      end: "10:00",
      timezone: "UTC",
      color: "sage",
      icon: "briefcase",
    },
    db,
  );
  await assignMeeting(event.id, blockId, db);
  await expect(assignMeeting(event.id, short, db)).rejects.toThrow(
    "entire time range",
  );
  expect((await db.meetingPlacements.get(event.id))?.occurrenceId).toBe(
    blockId,
  );
  await cacheDay(
    connection,
    "2026-10-15",
    "UTC",
    [{ ...event, title: "Refreshed" }],
    () => true,
    db,
  );
  db.close();
  await db.open();
  expect((await db.meetingPlacements.get(event.id))?.occurrenceId).toBe(
    blockId,
  );
  expect(await db.events.get(event.id)).toMatchObject({
    start: event.start,
    end: event.end,
    title: "Refreshed",
  });
  await assignMeeting(event.id, null, db);
  expect((await db.meetingPlacements.get(event.id))?.occurrenceId).toBeNull();
  await disconnectCalendar(db);
  expect(await db.meetingPlacements.count()).toBe(0);
});
