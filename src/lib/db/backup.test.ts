import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { TimeBlockDB } from "./database";
import { exportBackup, restoreBackup, undoRestore } from "./backup";
import {
  initialize,
  addTask,
  createBlock,
  adjustBlockTime,
} from "./repository";
import { createRoutine, materializeDay, skipDate } from "./routines";
import { occurrenceId } from "../../domain/recurrence";
import { parseBackup, validateBackup } from "../../domain/backup";
const databases: TimeBlockDB[] = [];
async function database() {
  const db = new TimeBlockDB(crypto.randomUUID());
  databases.push(db);
  await initialize(db);
  return db;
}
afterEach(async () => {
  for (const db of databases) await db.delete();
  databases.length = 0;
});
async function fixture(db: TimeBlockDB) {
  const routine = await createRoutine(
    {
      title: "Study",
      color: "sage",
      icon: "book",
      timezone: "America/New_York",
      startTime: "23:00",
      endTime: "01:00",
      endDayOffset: 1,
      recurrence: { frequency: "daily", weekdays: [], startsOn: "2026-10-15" },
    },
    db,
  );
  await materializeDay("2026-10-15", "America/New_York", db);
  const block = occurrenceId(routine, "2026-10-15");
  await adjustBlockTime(block, "move", 30, 15, db);
  await skipDate(routine, "2026-10-16", db);
  await addTask("Read chapter", block, db);
  const task = (await db.tasks.toArray())[0];
  await db.tasks.update(task.id, {
    completed: true,
    notes: "Notes survive\nUnicode ✓",
    estimatedMinutes: 25,
    schedule: { offsetMinutes: 15, durationMinutes: 45 },
    checklist: [{ id: "step", title: "Review", completed: true }],
    notesFormat: "markdown",
  });
  await addTask("Inbox", null, db);
  await db.layouts.put({ date: "2026-10-15", visibleStart: 0, visibleEnd: 24 });
  return exportBackup(db);
}
it("round-trips routines, overrides, skips, overnight blocks, notes, completion and layouts after reopening", async () => {
  const source = await database();
  const backup = await fixture(source);
  const target = await database();
  await restoreBackup(parseBackup(JSON.stringify(backup)), target);
  target.close();
  await target.open();
  expect((await exportBackup(target)).data).toEqual(backup.data);
  await materializeDay("2026-10-16", "America/New_York", target);
  expect(
    (await target.tasks.toArray()).find((t) => t.title === "Read chapter")
      ?.completed,
  ).toBe(true);
  expect(
    await target.occurrences.get(
      occurrenceId(backup.data.definitions[0].id, "2026-10-16"),
    ),
  ).toBeUndefined();
});
it("saves a recovery snapshot atomically and allows recovery after reload without losing intervening edits", async () => {
  const target = await database();
  await addTask("Original", null, target);
  const before = await exportBackup(target);
  const source = await database();
  const incoming = await fixture(source);
  await restoreBackup(incoming, target);
  expect((await target.recovery.get("before-restore"))?.backup.data).toEqual(
    before.data,
  );
  target.close();
  await target.open();
  await addTask("After restore", null, target);
  const edited = await exportBackup(target);
  await undoRestore(target);
  expect((await exportBackup(target)).data).toEqual(before.data);
  await undoRestore(target);
  expect((await exportBackup(target)).data).toEqual(edited.data);
});
it("rolls back all tables and the recovery snapshot when a write fails mid-restore", async () => {
  const target = await database();
  await addTask("Original", null, target);
  const before = await exportBackup(target);
  const incoming = await fixture(await database());
  const reject = () => {
    throw new Error("Simulated storage failure");
  };
  target.tasks.hook("creating", reject);
  await expect(restoreBackup(incoming, target)).rejects.toThrow(
    "Simulated storage failure",
  );
  target.tasks.hook("creating").unsubscribe(reject);
  expect((await exportBackup(target)).data).toEqual(before.data);
  expect(await target.recovery.count()).toBe(0);
});
it("excludes calendar metadata and credentials from export and leaves calendar stores unchanged on restore", async () => {
  const target = await database();
  await target.connections.put({
    id: "google",
    provider: "google",
    accountLabel: "private-account",
    calendarIds: ["calendar"],
  });
  await target.events.put({
    id: "event",
    connectionId: "google",
    calendarId: "calendar",
    externalId: "event",
    title: "Private meeting",
    start: "2026-10-15",
    end: "2026-10-16",
    allDay: true,
  });
  const backup = await exportBackup(target);
  expect(JSON.stringify(backup)).not.toContain("private-account");
  expect(JSON.stringify(backup)).not.toContain("Private meeting");
  const incoming = await fixture(await database());
  await restoreBackup(
    {
      ...incoming,
      access_token: "never-save",
      data: {
        ...incoming.data,
        connections: [{ access_token: "never-save" }],
        tasks: incoming.data.tasks.map((t) => ({
          ...t,
          refresh_token: "never-save",
        })),
      },
    },
    target,
  );
  expect(JSON.stringify(await exportBackup(target))).not.toContain(
    "never-save",
  );
  expect(await target.connections.count()).toBe(1);
  expect(await target.events.count()).toBe(1);
});
it("rejects malformed, future-version and dangling-reference backups without mutating existing data", async () => {
  const target = await database();
  const valid = await fixture(target);
  const before = await exportBackup(target);
  const invalid = [
    null,
    { ...valid, version: 99 },
    {
      ...valid,
      data: {
        ...valid.data,
        tasks: [{ ...valid.data.tasks[0], occurrenceId: "missing" }],
      },
    },
    { ...valid, data: { ...valid.data, definitions: [] } },
  ];
  for (const value of invalid)
    await expect(restoreBackup(value, target)).rejects.toThrow(
      "Invalid backup",
    );
  expect((await exportBackup(target)).data).toEqual(before.data);
  expect(await target.recovery.count()).toBe(0);
  expect(() => parseBackup("not JSON")).toThrow("valid JSON");
});
it("rejects duplicate identities, invalid preferences, bad estimates and contradictory recurrence exceptions", async () => {
  const valid = await fixture(await database());
  const invalidData = [
    { ...valid.data, tasks: [...valid.data.tasks, valid.data.tasks[0]] },
    {
      ...valid.data,
      preferences: [
        { ...valid.data.preferences[0], visibleStart: 22, visibleEnd: 8 },
      ],
    },
    {
      ...valid.data,
      preferences: [{ ...valid.data.preferences[0], timezone: "Invalid/Zone" }],
    },
    { ...valid.data, tasks: [{ ...valid.data.tasks[0], completed: "yes" }] },
    {
      ...valid.data,
      tasks: [{ ...valid.data.tasks[0], estimatedMinutes: -1 }],
    },
    {
      ...valid.data,
      occurrences: [{ ...valid.data.occurrences[0], date: "2026-02-30" }],
    },
    { ...valid.data, exceptions: [] },
    {
      ...valid.data,
      exceptions: valid.data.exceptions.map((e) => ({ ...e, kind: "skip" })),
    },
    {
      ...valid.data,
      occurrences: [{ ...valid.data.occurrences[0], definitionId: "missing" }],
    },
    {
      ...valid.data,
      definitions: [
        {
          ...valid.data.definitions[0],
          recurrence: {
            frequency: "weekly",
            weekdays: [],
            startsOn: "2026-10-15",
          },
        },
      ],
    },
  ];
  for (const data of invalidData)
    expect(() => validateBackup({ ...valid, data })).toThrow("Invalid backup");
});
it("preserves independent task state and IDs when importing twice", async () => {
  const source = await database();
  const first = await createBlock(
    {
      title: "Work",
      date: "2026-10-15",
      start: "09:00",
      end: "10:00",
      timezone: "UTC",
      color: "blue",
      icon: "briefcase",
    },
    source,
  );
  const second = await createBlock(
    {
      title: "Work",
      date: "2026-10-16",
      start: "09:00",
      end: "10:00",
      timezone: "UTC",
      color: "blue",
      icon: "briefcase",
    },
    source,
  );
  await addTask("Same title", first, source);
  await addTask("Same title", second, source);
  const tasks = await source.tasks.toArray();
  await source.tasks.update(tasks[0].id, { completed: true });
  const backup = await exportBackup(source);
  const target = await database();
  await restoreBackup(backup, target);
  await restoreBackup(backup, target);
  expect(await target.tasks.count()).toBe(2);
  expect(
    (await target.tasks.toArray()).filter((t) => t.completed),
  ).toHaveLength(1);
  expect((await target.tasks.toArray()).map((t) => t.id).sort()).toEqual(
    tasks.map((t) => t.id).sort(),
  );
});
it("adds recovery storage to v2 without clearing existing planner or calendar data", async () => {
  const name = crypto.randomUUID();
  const legacy = new Dexie(name);
  legacy.version(2).stores({
    definitions: "id",
    occurrences: "id, definitionId, date, start, end",
    tasks: "id, occurrenceId, order",
    exceptions: "id, &[definitionId+date]",
    connections: "id",
    events:
      "id, connectionId, &[connectionId+calendarId+externalId], start, end",
    preferences: "id",
    layouts: "date",
  });
  await legacy.table("tasks").put({
    id: "old-task",
    title: "Keep me",
    completed: true,
    occurrenceId: null,
    order: 0,
    notes: "",
    createdAt: "2026-10-15T00:00:00Z",
  });
  await legacy.table("connections").put({
    id: "google",
    provider: "google",
    accountLabel: "account",
    calendarIds: [],
  });
  legacy.close();
  const upgraded = new TimeBlockDB(name);
  databases.push(upgraded);
  await upgraded.open();
  expect((await upgraded.tasks.get("old-task"))?.completed).toBe(true);
  expect(await upgraded.connections.count()).toBe(1);
  expect(await upgraded.recovery.count()).toBe(0);
});
it("rejects oversized input before parsing and refuses recovery when none exists", async () => {
  expect(() => parseBackup(" ".repeat(20 * 1024 * 1024 + 1))).toThrow("20 MB");
  const db = await database();
  await expect(undoRestore(db)).rejects.toThrow("No restore recovery copy");
  expect(await db.preferences.count()).toBe(1);
});

it("accepts legacy v1 backups without inventing task schedules", async () => {
  const db = await database();
  await addTask("Legacy", null, db);
  const legacy = { ...(await exportBackup(db)), version: 1 };
  await restoreBackup(legacy, db);
  expect((await db.tasks.toArray())[0].schedule).toBeUndefined();
});
it("rejects corrupt task timing and duplicate checklist IDs", async () => {
  const db = await database();
  const backup = await fixture(db);
  const index = backup.data.tasks.findIndex((t) => t.schedule);
  for (const patch of [
    { schedule: { offsetMinutes: -1, durationMinutes: 30 } },
    { schedule: { offsetMinutes: 0, durationMinutes: 0 } },
    {
      checklist: [
        { id: "x", title: "A", completed: false },
        { id: "x", title: "B", completed: true },
      ],
    },
  ]) {
    const value = structuredClone(backup);
    Object.assign(value.data.tasks[index], patch);
    expect(() => validateBackup(value)).toThrow("Invalid backup");
  }
});
