import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { TimeBlockDB } from "./database";
import {
  adjustBlockTime,
  moveTask,
  orderedTasks,
  reorderTask,
  saveTask,
  updateBlock,
  addTask,
  createBlock,
  initialize,
  removeBlock,
} from "./repository";
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
it("persists tasks and preferences after reopening the database", async () => {
  const db = database();
  await initialize(db);
  await addTask("Write proposal", null, db);
  const task = (await db.tasks.toArray())[0];
  await db.tasks.update(task.id, { completed: true });
  db.close();
  await db.open();
  expect((await db.tasks.get(task.id))?.completed).toBe(true);
  expect(await db.preferences.count()).toBe(1);
  await initialize(db);
  expect(await db.preferences.count()).toBe(1);
});
it("creates independent dated tasks and preserves them when a block is removed", async () => {
  const db = database();
  const input = {
    title: "Study",
    start: "09:00",
    end: "10:00",
    timezone: "UTC",
    color: "sage" as const,
    icon: "book" as const,
  };
  const first = await createBlock({ ...input, date: "2026-10-15" }, db);
  const second = await createBlock({ ...input, date: "2026-10-16" }, db);
  await addTask("Read", first, db);
  await addTask("Read", second, db);
  const tasks = await db.tasks.toArray();
  const firstTask = tasks.find((t) => t.occurrenceId === first)!;
  await db.tasks.update(firstTask.id, { completed: true });
  expect(
    (await db.tasks.where("occurrenceId").equals(second).first())?.completed,
  ).toBe(false);
  await removeBlock(first, db);
  expect((await db.tasks.get(firstTask.id))?.occurrenceId).toBe(null);
  expect(await db.occurrences.count()).toBe(1);
  expect(await db.definitions.count()).toBe(1);
});
it("rejects invalid blocks without partial writes", async () => {
  const db = database();
  await expect(
    createBlock(
      {
        title: "Bad",
        date: "2026-10-15",
        start: "09:00",
        end: "09:00",
        timezone: "UTC",
        color: "sage",
        icon: "book",
      },
      db,
    ),
  ).rejects.toThrow();
  expect(await db.definitions.count()).toBe(0);
  expect(await db.occurrences.count()).toBe(0);
});

it("moves tasks transactionally, preserving notes, estimates, and completion", async () => {
  const db = database();
  const destination = await createBlock(
    {
      title: "Work",
      date: "2026-10-15",
      start: "10:00",
      end: "12:00",
      timezone: "UTC",
      color: "blue",
      icon: "briefcase",
    },
    db,
  );
  await addTask("First", null, db);
  await addTask("Second", null, db);
  await addTask("Existing", destination, db);
  const first = (await db.tasks.toArray()).find((t) => t.title === "First")!;
  const existing = (await db.tasks.toArray()).find(
    (t) => t.title === "Existing",
  )!;
  await db.tasks.update(first.id, { completed: true });
  await saveTask(
    first.id,
    { title: "Renamed", notes: "Read chapter 2", estimatedMinutes: 25 },
    destination,
    db,
  );
  await moveTask(first.id, destination, existing.id, db);
  db.close();
  await db.open();
  expect(
    orderedTasks(
      (await db.tasks.toArray()).filter((t) => t.occurrenceId === destination),
    ).map((t) => [t.title, t.order]),
  ).toEqual([
    ["Renamed", 0],
    ["Existing", 1],
  ]);
  expect(await db.tasks.get(first.id)).toMatchObject({
    notes: "Read chapter 2",
    estimatedMinutes: 25,
    completed: true,
    occurrenceId: destination,
  });
  await saveTask(
    first.id,
    { title: "Renamed", notes: "", estimatedMinutes: undefined },
    null,
    db,
  );
  expect((await db.tasks.get(first.id))?.estimatedMinutes).toBeUndefined();
  expect(
    orderedTasks(
      (await db.tasks.toArray()).filter((t) => t.occurrenceId === null),
    ).map((t) => t.title),
  ).toEqual(["Second", "Renamed"]);
});
it("reorders in both directions and leaves boundary actions unchanged", async () => {
  const db = database();
  for (const name of ["A", "B", "C"]) await addTask(name, null, db);
  const b = (await db.tasks.toArray()).find((t) => t.title === "B")!;
  const names = async () =>
    orderedTasks(await db.tasks.toArray()).map((t) => t.title);
  await reorderTask(b.id, -1, db);
  expect(await names()).toEqual(["B", "A", "C"]);
  await reorderTask(b.id, -1, db);
  expect(await names()).toEqual(["B", "A", "C"]);
  await reorderTask(b.id, 1, db);
  await reorderTask(b.id, 1, db);
  expect(await names()).toEqual(["A", "C", "B"]);
  await reorderTask(b.id, 1, db);
  expect(await names()).toEqual(["A", "C", "B"]);
});
it("rolls back task edits when a destination has disappeared", async () => {
  const db = database();
  await addTask("Original", null, db);
  const task = (await db.tasks.toArray())[0];
  await expect(
    saveTask(
      task.id,
      { title: "Changed", notes: "", estimatedMinutes: 5 },
      "missing",
      db,
    ),
  ).rejects.toThrow();
  expect(await db.tasks.get(task.id)).toEqual(task);
  await expect(moveTask(task.id, null, "missing", db)).rejects.toThrow();
  expect(await db.tasks.get(task.id)).toEqual(task);
});
it("rejects invalid task estimates before writing", async () => {
  const db = database();
  await addTask("Read", null, db);
  const task = (await db.tasks.toArray())[0];
  for (const estimatedMinutes of [0, -1, 1.5, 1441, NaN])
    await expect(
      saveTask(
        task.id,
        { title: "Read", notes: "", estimatedMinutes },
        null,
        db,
      ),
    ).rejects.toThrow();
  expect(await db.tasks.get(task.id)).toEqual(task);
});
it("changes block timing without changing identity or associated tasks", async () => {
  const db = database();
  const id = await createBlock(
    {
      title: "Late work",
      date: "2026-10-15",
      start: "23:00",
      end: "01:00",
      timezone: "UTC",
      color: "blue",
      icon: "briefcase",
    },
    db,
  );
  await addTask("Finish", id, db);
  const original = await db.occurrences.get(id);
  await adjustBlockTime(id, "move", 90, 15, db);
  expect(await db.occurrences.get(id)).toMatchObject({
    id,
    definitionId: original!.definitionId,
    date: "2026-10-15",
    start: "2026-10-16T00:30:00Z",
    end: "2026-10-16T02:30:00Z",
    overridden: true,
  });
  expect((await db.tasks.toArray())[0].occurrenceId).toBe(id);
});
it("rolls back invalid block edits", async () => {
  const db = database();
  const id = await createBlock(
    {
      title: "Work",
      date: "2026-10-15",
      start: "09:00",
      end: "10:00",
      timezone: "UTC",
      color: "blue",
      icon: "briefcase",
    },
    db,
  );
  const original = (await db.occurrences.get(id))!;
  await expect(
    updateBlock(id, { ...original, end: original.start }, db),
  ).rejects.toThrow();
  expect(await db.occurrences.get(id)).toEqual(original);
});
it("appends rescued tasks after the inbox with unique order values", async () => {
  const db = database();
  await addTask("Inbox", null, db);
  const id = await createBlock(
    {
      title: "Work",
      date: "2026-10-15",
      start: "09:00",
      end: "10:00",
      timezone: "UTC",
      color: "blue",
      icon: "briefcase",
    },
    db,
  );
  await addTask("Rescued", id, db);
  await removeBlock(id, db);
  expect(
    orderedTasks(await db.tasks.toArray()).map((t) => [
      t.title,
      t.order,
      t.occurrenceId,
    ]),
  ).toEqual([
    ["Inbox", 0, null],
    ["Rescued", 1, null],
  ]);
});

it("persists task timing, checklist and Markdown, clears timing on rescue, and never loses notes", async () => {
  const { scheduleTask, toggleChecklistItem } = await import("./repository");
  const db = database();
  const block = await createBlock(
    {
      title: "Work",
      date: "2026-10-15",
      start: "13:00",
      end: "18:00",
      timezone: "UTC",
      color: "sage",
      icon: "briefcase",
    },
    db,
  );
  await addTask("Feature", block, db);
  const task = (await db.tasks.toArray())[0];
  await saveTask(
    task.id,
    {
      title: task.title,
      notes: "## Decisions\n\n[Reference](https://example.com)",
      notesFormat: "markdown",
      checklist: [{ id: "step", title: "Review", completed: false }],
    },
    block,
    db,
  );
  await scheduleTask(
    task.id,
    block,
    { offsetMinutes: 180, durationMinutes: 60 },
    db,
  );
  await toggleChecklistItem(task.id, "step", db);
  db.close();
  await db.open();
  expect((await db.tasks.get(task.id))?.schedule).toEqual({
    offsetMinutes: 180,
    durationMinutes: 60,
  });
  expect((await db.tasks.get(task.id))?.checklist?.[0].completed).toBe(true);
  await expect(
    scheduleTask(
      task.id,
      block,
      { offsetMinutes: 290, durationMinutes: 30 },
      db,
    ),
  ).rejects.toThrow("fit");
  expect((await db.tasks.get(task.id))?.schedule?.offsetMinutes).toBe(180);
  await removeBlock(block, db);
  const rescued = await db.tasks.get(task.id);
  expect(rescued?.schedule).toBeUndefined();
  expect(rescued?.occurrenceId).toBeNull();
  expect(rescued?.notes).toContain("[Reference]");
});
it("unschedules on cross-block move but retains timing when reordering within a block", async () => {
  const { scheduleTask } = await import("./repository");
  const db = database();
  const block = await createBlock(
    {
      title: "Work",
      date: "2026-10-15",
      start: "13:00",
      end: "18:00",
      timezone: "UTC",
      color: "sage",
      icon: "briefcase",
    },
    db,
  );
  await addTask("A", block, db);
  await addTask("B", block, db);
  const [a, b] = orderedTasks(await db.tasks.toArray());
  await scheduleTask(
    a.id,
    block,
    { offsetMinutes: 0, durationMinutes: 30 },
    db,
  );
  await moveTask(a.id, block, b.id, db);
  expect((await db.tasks.get(a.id))?.schedule).toBeDefined();
  await moveTask(a.id, null, null, db);
  expect((await db.tasks.get(a.id))?.schedule).toBeUndefined();
});
