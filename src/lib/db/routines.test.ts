import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { TimeBlockDB } from "./database";
import {
  createRoutine,
  deleteRoutine,
  materializeDay,
  resetDate,
  skipDate,
  updateRoutine,
} from "./routines";
import {
  addTask,
  adjustBlockTime,
  createBlock,
  removeBlock,
  updateBlock,
} from "./repository";
import {
  exceptionId,
  occurrenceId,
  type RoutineInput,
} from "../../domain/recurrence";
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
const input: RoutineInput = {
  title: "Study",
  color: "sage",
  icon: "book",
  timezone: "UTC",
  startTime: "08:00",
  endTime: "10:00",
  endDayOffset: 0,
  recurrence: { frequency: "daily", weekdays: [], startsOn: "2026-10-15" },
};
const day = "2026-10-15";
it("materializes idempotently across concurrent calls and reloads", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await Promise.all([
    materializeDay(day, "UTC", db),
    materializeDay(day, "UTC", db),
  ]);
  const before = await db.occurrences.toArray();
  expect(new Set(before.map((o) => o.id)).size).toBe(before.length);
  db.close();
  await db.open();
  await materializeDay(day, "UTC", db);
  expect(await db.occurrences.toArray()).toEqual(before);
  expect(await db.occurrences.get(occurrenceId(id, day))).toBeDefined();
  expect(await db.tasks.count()).toBe(0);
});
it("never shares tasks or completion between days", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await materializeDay(day, "UTC", db);
  await materializeDay("2026-10-16", "UTC", db);
  await addTask("Read", occurrenceId(id, day), db);
  const task = (await db.tasks.toArray())[0];
  await db.tasks.update(task.id, { completed: true });
  expect(
    await db.tasks
      .where("occurrenceId")
      .equals(occurrenceId(id, "2026-10-16"))
      .count(),
  ).toBe(0);
  await addTask("Read", occurrenceId(id, "2026-10-16"), db);
  expect(
    (
      await db.tasks
        .where("occurrenceId")
        .equals(occurrenceId(id, "2026-10-16"))
        .first()
    )?.completed,
  ).toBe(false);
});
it("preserves moved overrides under their original recurrence identity", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await materializeDay(day, "UTC", db);
  const key = occurrenceId(id, day);
  await addTask("Keep", key, db);
  await adjustBlockTime(key, "move", 1440, 15, db);
  expect(await db.exceptions.get(exceptionId(id, day))).toMatchObject({
    kind: "override",
    occurrenceId: key,
  });
  await materializeDay(day, "UTC", db);
  await materializeDay("2026-10-16", "UTC", db);
  expect(await db.occurrences.get(key)).toMatchObject({
    date: day,
    start: "2026-10-16T08:00:00Z",
    overridden: true,
  });
  expect((await db.tasks.toArray())[0].occurrenceId).toBe(key);
});
it("skipping through block deletion persists and rescues tasks", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await materializeDay(day, "UTC", db);
  const key = occurrenceId(id, day);
  await addTask("Keep", key, db);
  await removeBlock(key, db);
  db.close();
  await db.open();
  await materializeDay(day, "UTC", db);
  expect(await db.occurrences.get(key)).toBeUndefined();
  expect(await db.definitions.get(id)).toBeDefined();
  expect((await db.tasks.toArray())[0].occurrenceId).toBe(null);
  expect((await db.exceptions.get(exceptionId(id, day)))?.kind).toBe("skip");
  await resetDate(id, day, db);
  expect(await db.occurrences.get(key)).toBeDefined();
  expect((await db.tasks.toArray())[0].occurrenceId).toBe(null);
});
it("supports skipping dates before materialization", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await skipDate(id, "2026-12-25", db);
  await materializeDay("2026-12-25", "UTC", db);
  expect(
    await db.occurrences.get(occurrenceId(id, "2026-12-25")),
  ).toBeUndefined();
});
it("updates entire series including past regular occurrences but preserves overrides and skips", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  for (const d of [day, "2026-10-16", "2026-10-17"])
    await materializeDay(d, "UTC", db);
  const first = occurrenceId(id, day);
  const second = occurrenceId(id, "2026-10-16");
  const third = occurrenceId(id, "2026-10-17");
  await addTask("Regular task", first, db);
  await adjustBlockTime(second, "move", 30, 15, db);
  await skipDate(id, "2026-10-17", db);
  await updateRoutine(
    id,
    { ...input, title: "New title", startTime: "09:00", endTime: "11:00" },
    db,
  );
  expect(await db.occurrences.get(first)).toMatchObject({
    title: "New title",
    start: "2026-10-15T09:00:00Z",
  });
  expect(await db.occurrences.get(second)).toMatchObject({
    title: "Study",
    start: "2026-10-16T08:30:00Z",
  });
  expect(await db.occurrences.get(third)).toBeUndefined();
  expect((await db.tasks.toArray())[0].occurrenceId).toBe(first);
  await resetDate(id, "2026-10-16", db);
  expect(await db.occurrences.get(second)).toMatchObject({
    title: "New title",
    overridden: false,
    start: "2026-10-16T09:00:00Z",
  });
  expect(
    await db.exceptions.get(exceptionId(id, "2026-10-16")),
  ).toBeUndefined();
});
it("moves removed-day tasks to the inbox without touching override tasks", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await materializeDay("2026-10-16", "UTC", db);
  await materializeDay("2026-10-17", "UTC", db);
  const friday = occurrenceId(id, "2026-10-16");
  const saturday = occurrenceId(id, "2026-10-17");
  await addTask("Friday", friday, db);
  await addTask("Saturday", saturday, db);
  await adjustBlockTime(saturday, "move", 15, 15, db);
  await updateRoutine(
    id,
    {
      ...input,
      recurrence: { frequency: "weekly", weekdays: [1], startsOn: day },
    },
    db,
  );
  expect(await db.occurrences.get(friday)).toBeUndefined();
  expect(await db.occurrences.get(saturday)).toBeDefined();
  expect(
    (await db.tasks.toArray()).find((t) => t.title === "Friday")?.occurrenceId,
  ).toBe(null);
  expect(
    (await db.tasks.toArray()).find((t) => t.title === "Saturday")
      ?.occurrenceId,
  ).toBe(saturday);
  await expect(resetDate(id, "2026-10-17", db)).rejects.toThrow("no longer");
});
it("resetting a moved occurrence preserves its tasks and completion", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await materializeDay(day, "UTC", db);
  const key = occurrenceId(id, day);
  await addTask("Keep", key, db);
  const task = (await db.tasks.toArray())[0];
  await db.tasks.update(task.id, { completed: true });
  const block = (await db.occurrences.get(key))!;
  await updateBlock(key, { ...block, title: "Only today" }, db);
  await resetDate(id, day, db);
  expect((await db.occurrences.get(key))?.title).toBe("Study");
  expect(await db.tasks.get(task.id)).toMatchObject({
    completed: true,
    occurrenceId: key,
  });
});
it("surfaces DST errors while still generating valid routines", async () => {
  const db = database();
  const bad = await createRoutine(
    {
      ...input,
      timezone: "America/New_York",
      startTime: "02:30",
      endTime: "03:30",
      recurrence: { frequency: "daily", weekdays: [], startsOn: "2026-03-08" },
    },
    db,
  );
  const good = await createRoutine(
    {
      ...input,
      timezone: "America/New_York",
      recurrence: { frequency: "daily", weekdays: [], startsOn: "2026-03-08" },
    },
    db,
  );
  const issues = await materializeDay("2026-03-08", "America/New_York", db);
  expect(
    issues.some((i) => i.definitionId === bad && i.date === "2026-03-08"),
  ).toBe(true);
  expect(
    await db.occurrences.get(occurrenceId(good, "2026-03-08")),
  ).toBeDefined();
  expect(
    await db.occurrences.get(occurrenceId(bad, "2026-03-08")),
  ).toBeUndefined();
  await skipDate(bad, "2026-03-08", db);
  expect(await materializeDay("2026-03-08", "America/New_York", db)).toEqual(
    [],
  );
  await expect(resetDate(bad, "2026-03-08", db)).rejects.toThrow();
  expect((await db.exceptions.get(exceptionId(bad, "2026-03-08")))?.kind).toBe(
    "skip",
  );
});
it("rolls back a series edit that cannot represent an existing DST date", async () => {
  const db = database();
  const original = {
    ...input,
    timezone: "America/New_York",
    recurrence: {
      frequency: "daily" as const,
      weekdays: [],
      startsOn: "2026-03-08",
    },
  };
  const id = await createRoutine(original, db);
  await materializeDay("2026-03-08", "America/New_York", db);
  const before = await db.occurrences.toArray();
  await expect(
    updateRoutine(
      id,
      { ...original, startTime: "02:30", endTime: "03:30" },
      db,
    ),
  ).rejects.toThrow("2026-03-08");
  expect(await db.occurrences.toArray()).toEqual(before);
  expect((await db.definitions.get(id))?.startTime).toBe("08:00");
});
it("generates overnight tails when navigating directly to the following day", async () => {
  const db = database();
  const id = await createRoutine(
    { ...input, startTime: "23:00", endTime: "01:00", endDayOffset: 1 },
    db,
  );
  await materializeDay("2026-10-16", "UTC", db);
  expect(await db.occurrences.get(occurrenceId(id, day))).toMatchObject({
    start: "2026-10-15T23:00:00Z",
    end: "2026-10-16T01:00:00Z",
  });
});
it("deletes a series and exceptions while preserving every task", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await materializeDay(day, "UTC", db);
  const key = occurrenceId(id, day);
  await addTask("Keep", key, db);
  await adjustBlockTime(key, "move", 15, 15, db);
  await skipDate(id, "2026-10-20", db);
  await deleteRoutine(id, db);
  expect(await db.definitions.count()).toBe(0);
  expect(await db.occurrences.count()).toBe(0);
  expect(await db.exceptions.count()).toBe(0);
  expect((await db.tasks.toArray())[0].occurrenceId).toBe(null);
  await materializeDay(day, "UTC", db);
  expect(await db.occurrences.count()).toBe(0);
});
it("keeps Phase 1/2 one-off blocks and tasks unchanged", async () => {
  const db = database();
  const single = await createBlock(
    {
      title: "Original",
      date: day,
      start: "12:00",
      end: "13:00",
      timezone: "UTC",
      icon: "coffee",
      color: "peach",
    },
    db,
  );
  await addTask("Original task", single, db);
  const block = await db.occurrences.get(single);
  const task = (await db.tasks.toArray())[0];
  const id = await createRoutine(input, db);
  await materializeDay(day, "UTC", db);
  await updateRoutine(id, { ...input, title: "Changed" }, db);
  await deleteRoutine(id, db);
  expect(await db.occurrences.get(single)).toEqual(block);
  expect(await db.tasks.get(task.id)).toEqual(task);
});
it("rejects invalid routine edits without changing stored data", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  const original = await db.definitions.get(id);
  await expect(
    updateRoutine(
      id,
      {
        ...input,
        recurrence: { frequency: "weekly", weekdays: [], startsOn: day },
      },
      db,
    ),
  ).rejects.toThrow();
  expect(await db.definitions.get(id)).toEqual(original);
  await expect(createRoutine({ ...input, title: "" }, db)).rejects.toThrow();
  expect(await db.definitions.count()).toBe(1);
});

it("a rejected recurring drag does not leave an override exception behind", async () => {
  const db = database();
  const id = await createRoutine(
    {
      ...input,
      timezone: "America/New_York",
      startTime: "00:30",
      endTime: "01:30",
      recurrence: { frequency: "daily", weekdays: [], startsOn: "2026-03-08" },
    },
    db,
  );
  await materializeDay("2026-03-08", "America/New_York", db);
  const key = occurrenceId(id, "2026-03-08");
  const before = await db.occurrences.get(key);
  await expect(adjustBlockTime(key, "move", 120, 15, db)).rejects.toThrow();
  expect(await db.occurrences.get(key)).toEqual(before);
  expect(await db.exceptions.count()).toBe(0);
});
it("ordinary routines materialize only dates intersecting the requested local day", async () => {
  const db = database();
  const id = await createRoutine(input, db);
  await materializeDay("2026-10-20", "UTC", db);
  expect((await db.occurrences.toArray()).map((o) => o.id)).toEqual([
    occurrenceId(id, "2026-10-20"),
  ]);
});
it("removing a series does not remove exceptions belonging to another series", async () => {
  const db = database();
  const first = await createRoutine(input, db);
  const second = await createRoutine({ ...input, title: "Second" }, db);
  await skipDate(first, day, db);
  await skipDate(second, day, db);
  await deleteRoutine(first, db);
  expect(await db.exceptions.toArray()).toEqual([
    {
      id: exceptionId(second, day),
      definitionId: second,
      date: day,
      kind: "skip",
    },
  ]);
});
