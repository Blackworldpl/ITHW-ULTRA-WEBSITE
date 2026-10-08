import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { loadEnv } from "./env";

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("Uruchom wcześniej lokalny PostgreSQL.");
  const target = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error("Skrypt przygotowuje wyłącznie lokalną bazę testową.");
  target.pathname = "/postgres";
  const client = new pg.Client({connectionString:target.toString(),connectionTimeoutMillis:10_000});
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname='ithardware_test'");
    if (!exists.rowCount) await client.query("CREATE DATABASE ithardware_test");
  } finally { await client.end(); }
  target.pathname = "/ithardware_test";
  const testUrl = target.toString();
  const directory = resolve(process.cwd(), ".local");
  await mkdir(directory, {recursive:true,mode:0o700});
  await writeFile(resolve(directory,"test.env"), `TEST_DATABASE_URL=${JSON.stringify(testUrl)}\n`, {mode:0o600});
  const migration = spawn(process.execPath,["--import","tsx","scripts/migrate.ts"],{stdio:"inherit",env:{...process.env,DATABASE_URL:testUrl,MIGRATION_DATABASE_URL:testUrl}});
  await new Promise<void>((resolveMigration,reject)=>{
    migration.on("error",reject);
    migration.on("exit", code => code===0 ? resolveMigration() : reject(new Error("Migracja testowej bazy nie powiodła się.")));
  });
  console.log("Oddzielna baza ithardware_test gotowa; prywatny URL zapisano w .local/test.env. Dane aplikacji nie zostały zmienione.");
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Nie udało się przygotować bazy testowej.");process.exitCode=1;});
