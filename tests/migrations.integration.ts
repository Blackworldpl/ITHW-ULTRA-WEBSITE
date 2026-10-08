import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import pg from "pg";

test("Migracje: blokada, checksum i rollback na odrębnej bazie", {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const project = process.cwd();
  const base = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(base.pathname.endsWith("_test"), "Wymagana osobna baza testowa");
  const name = `ithardware_migrations_${randomBytes(6).toString("hex")}_test`;
  assert.match(name, /^ithardware_migrations_[a-f0-9]{12}_test$/);
  base.pathname = "/postgres";
  const administrator = new pg.Client({connectionString:base.toString()});
  await administrator.connect();
  let created = false;
  let database:pg.Client | undefined;
  try {
    await administrator.query(`CREATE DATABASE "${name}"`);
    created = true;
    base.pathname = `/${name}`;
    const target = base.toString();
    database = new pg.Client({connectionString:target});
    await database.connect();
    const directory = await mkdtemp(join(tmpdir(),"ithardware-migration-test-"));
    await mkdir(join(directory,"migrations"));
    const first = join(directory,"migrations","001_marker.sql");
    const initial = "CREATE TABLE marker(id integer PRIMARY KEY); INSERT INTO marker VALUES(1);";
    await writeFile(first,initial,"utf8");
    const require = createRequire(resolve(project,"package.json"));
    const loader = pathToFileURL(require.resolve("tsx")).href;
    const run = () => new Promise<{code:number|null;output:string}>((resolveRun,reject)=>{
      const child = spawn(process.execPath,["--import",loader,resolve(project,"scripts/migrate.ts")],{cwd:directory,env:{...process.env,DATABASE_URL:target,MIGRATION_DATABASE_URL:target}});
      let output = "";
      child.stdout.on("data",chunk=>{output+=chunk.toString();});
      child.stderr.on("data",chunk=>{output+=chunk.toString();});
      child.on("error",reject);
      child.on("exit",code=>resolveRun({code,output}));
    });
    const results = await Promise.all([run(),run()]);
    for (const result of results) assert.equal(result.code,0,result.output);
    assert.equal((await database.query("SELECT count(*)::integer AS count FROM marker")).rows[0].count,1,"Równoległe procesy zastosowały migrację tylko raz");
    await writeFile(first,initial+"\n-- changed", "utf8");
    const checksum = await run();
    assert.equal(checksum.code,1);
    assert.match(checksum.output,/Zmieniono zastosowaną migrację/);
    await writeFile(first,initial,"utf8");
    const second = join(directory,"migrations","002_transaction.sql");
    await writeFile(second,"CREATE TABLE rollback_marker(id integer); SELECT 1/0;","utf8");
    assert.equal((await run()).code,1);
    assert.equal((await database.query("SELECT to_regclass('public.rollback_marker') AS marker")).rows[0].marker,null,"Błąd wycofał DDL");
    assert.equal((await database.query("SELECT count(*)::integer AS count FROM schema_migrations")).rows[0].count,1,"Błędna migracja nie została oznaczona jako zastosowana");
    await writeFile(second,"CREATE TABLE rollback_marker(id integer);","utf8");
    const repaired = await run();
    assert.equal(repaired.code,0,repaired.output);
    assert.equal((await database.query("SELECT count(*)::integer AS count FROM schema_migrations")).rows[0].count,2);
    // Test SQL artifacts remain in the OS temporary directory for inspection.
  } finally {
    await database?.end();
    // Only the random database created in this test may be removed.
    if (created) await administrator.query(`DROP DATABASE "${name}"`);
    await administrator.end();
  }
});
