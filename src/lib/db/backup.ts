import type { PlannerBackup } from "../../domain/backup";
import { validateBackup } from "../../domain/backup";
import { db, type TimeBlockDB } from "./database";
const tables = (database: TimeBlockDB) => [
  database.definitions,
  database.occurrences,
  database.exceptions,
  database.tasks,
  database.preferences,
  database.layouts,
];
async function snapshot(database: TimeBlockDB): Promise<PlannerBackup> {
  const [definitions, occurrences, exceptions, tasks, preferences, layouts] =
    await Promise.all([
      database.definitions.toArray(),
      database.occurrences.toArray(),
      database.exceptions.toArray(),
      database.tasks.toArray(),
      database.preferences.toArray(),
      database.layouts.toArray(),
    ]);
  return validateBackup({
    format: "timeblock",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { definitions, occurrences, exceptions, tasks, preferences, layouts },
  });
}
export function exportBackup(database: TimeBlockDB = db) {
  return database.transaction("r", tables(database), () => snapshot(database));
}
async function replace(backup: PlannerBackup, database: TimeBlockDB) {
  for (const table of tables(database)) await table.clear();
  await database.definitions.bulkPut(backup.data.definitions);
  await database.occurrences.bulkPut(backup.data.occurrences);
  await database.exceptions.bulkPut(backup.data.exceptions);
  await database.tasks.bulkPut(backup.data.tasks);
  await database.preferences.bulkPut(backup.data.preferences);
  await database.layouts.bulkPut(backup.data.layouts);
}
export async function restoreBackup(
  value: unknown,
  database: TimeBlockDB = db,
) {
  const backup = validateBackup(value);
  await database.transaction(
    "rw",
    [...tables(database), database.recovery],
    async () => {
      const previous = await snapshot(database);
      await database.recovery.put({
        id: "before-restore",
        savedAt: new Date().toISOString(),
        backup: previous,
      });
      await replace(backup, database);
    },
  );
}
export async function undoRestore(database: TimeBlockDB = db) {
  await database.transaction(
    "rw",
    [...tables(database), database.recovery],
    async () => {
      const recovery = await database.recovery.get("before-restore");
      if (!recovery) throw new Error("No restore recovery copy is available.");
      const previous = validateBackup(recovery.backup);
      const current = await snapshot(database);
      await replace(previous, database);
      // Swap snapshots so edits made after a restore remain recoverable too.
      await database.recovery.put({
        id: "before-restore",
        savedAt: new Date().toISOString(),
        backup: current,
      });
    },
  );
}
