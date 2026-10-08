import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadEnv } from "./env";

async function migrate() {
  loadEnv();
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Ustaw DATABASE_URL lub MIGRATION_DATABASE_URL przed migracją.");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    // Session lock serializes even migrations initiated by separate processes.
    await client.query("SELECT pg_advisory_lock(734902103)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = resolve(process.cwd(), "migrations");
    const names = (await readdir(directory)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
    const { rows } = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
    const applied = new Map(rows.map((row) => [row.name, row.checksum]));
    for (const [name] of applied) {
      if (!names.includes(name)) throw new Error(`Brakuje wcześniej zastosowanej migracji: ${name}`);
    }
    for (const name of names) {
      const sql = await readFile(resolve(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new Error(`Zmieniono zastosowaną migrację ${name}. Dodaj nowy plik migracji.`);
        continue;
      }
      if (rows.some((row) => row.name > name)) throw new Error(`Migracja ${name} jest poza kolejnością. Nadaj jej kolejny numer.`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
        await client.query("COMMIT");
        console.log(`Zastosowano migrację: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    console.log("Baza danych jest aktualna.");
  } finally {
    await client.end(); // Also releases the advisory lock on failure.
  }
}

migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migracja nie powiodła się.");
  process.exitCode = 1;
});
