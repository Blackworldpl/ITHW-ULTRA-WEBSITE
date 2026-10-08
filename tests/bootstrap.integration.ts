import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

test("Pierwszy administrator: token, sesja i równoległa inicjalizacja", {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(base.pathname.endsWith("_test"), "Wymagana odrębna baza testowa");
  const name = `ithardware_bootstrap_${randomBytes(6).toString("hex")}_test`;
  assert.match(name, /^ithardware_bootstrap_[a-f0-9]{12}_test$/);
  base.pathname = "/postgres";
  const administrator = new pg.Client({connectionString:base.toString()});
  await administrator.connect();
  let created = false;
  let pool:pg.Pool | undefined;
  try {
    await administrator.query(`CREATE DATABASE "${name}"`);
    created = true;
    base.pathname = `/${name}`;
    const target = base.toString();
    const migration = spawn(process.execPath,["--import","tsx","scripts/migrate.ts"],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:target,MIGRATION_DATABASE_URL:target}});
    let output = "";
    migration.stdout.on("data",chunk=>{output+=chunk.toString();});
    migration.stderr.on("data",chunk=>{output+=chunk.toString();});
    const exit = await new Promise<number|null>((resolve,reject)=>{migration.on("error",reject);migration.on("exit",resolve);});
    assert.equal(exit,0,output);
    process.env.DATABASE_URL = target;
    process.env.APP_URL = "http://localhost:3000";
    process.env.SETUP_TOKEN = randomBytes(32).toString("base64url");
    Object.assign(process.env,{NODE_ENV:"test"});
    const { NextRequest } = await import("next/server");
    const route = await import("../src/app/api/[...path]/route");
    const database = await import("../src/server/db");
    pool = database.pool;
    const password = randomBytes(24).toString("base64url");
    const call = (email:string, token = process.env.SETUP_TOKEN!) => route.POST(new NextRequest("http://localhost:3000/api/setup",{
      method:"POST",headers:{origin:"http://localhost:3000","content-type":"application/json"},
      body:JSON.stringify({name:"Administrator integracyjny",email,password,token}),
    }),{params:Promise.resolve({path:["setup"]})});
    const availability = () => route.GET(new NextRequest("http://localhost:3000/api/setup"),{params:Promise.resolve({path:["setup"]})});
    assert.equal((await (await availability()).json()).data.available,true);
    assert.equal((await call("invalid@test.invalid",randomBytes(32).toString("base64url"))).status,403,"Nieprawidłowy token blokuje inicjalizację");
    assert.equal((await database.query("SELECT count(*)::integer AS count FROM users")).rows[0].count,0);
    const concurrent = await Promise.all([call("first@test.invalid"),call("second@test.invalid")]);
    assert.deepEqual(concurrent.map(response=>response.status).sort(),[201,409],"Tylko jedna równoległa inicjalizacja może utworzyć konto");
    const success = concurrent.find(response=>response.status===201)!;
    const account = (await success.json()).data;
    assert.equal(account.role,"ADMIN");
    assert.ok(account.csrfToken);
    const cookie = success.headers.get("set-cookie")!;
    assert.match(cookie,/HttpOnly/i);
    assert.match(cookie,/SameSite=strict/i);
    const session = await route.GET(new NextRequest("http://localhost:3000/api/auth/me",{headers:{cookie:cookie.split(";")[0]}}),{params:Promise.resolve({path:["auth","me"]})});
    assert.equal(session.status,200);
    assert.equal((await session.json()).data.id,account.id);
    assert.equal((await call("third@test.invalid")).status,409,"Po pierwszym koncie inicjalizacja jest zamknięta");
    assert.equal((await call("bad-token@test.invalid",randomBytes(32).toString("base64url"))).status,403);
    assert.equal((await (await availability()).json()).data.available,false);
    const user = (await database.query("SELECT password_hash FROM users")).rows[0];
    assert.ok(user.password_hash.startsWith("scrypt:"));
    assert.notEqual(user.password_hash,password);
    assert.equal((await database.query("SELECT count(*)::integer AS count FROM users")).rows[0].count,1);
    assert.equal((await database.query("SELECT count(*)::integer AS count FROM sessions")).rows[0].count,1);
    assert.equal((await database.query("SELECT count(*)::integer AS count FROM audit_logs WHERE action='CREATE_ADMIN'")).rows[0].count,1);
  } finally {
    await pool?.end();
    // Only this test's randomly named database is dropped; operational data is never used.
    if (created) await administrator.query(`DROP DATABASE "${name}"`);
    await administrator.end();
  }
});
