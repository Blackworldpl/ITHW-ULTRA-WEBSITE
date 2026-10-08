import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { loadEnv } from "./env";

async function main() {
  loadEnv();
  const file = resolve(process.cwd(), ".local", "test.env");
  const testUrl = process.env.TEST_DATABASE_URL || (existsSync(file) ? parseEnv(await readFile(file,"utf8")).TEST_DATABASE_URL : undefined);
  if (!testUrl) throw new Error("Wymagana osobna TEST_DATABASE_URL. Uruchom npm run db:test:prepare lub ustaw ją jawnie.");
  const target = new URL(testUrl);
  if (!target.pathname.endsWith("_test")) throw new Error("Nazwa bazy integracyjnej musi kończyć się _test.");
  if (process.env.DATABASE_URL) {
    const operational = new URL(process.env.DATABASE_URL);
    const host = (url:URL) => ['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? 'loopback' : url.hostname;
    if (host(target)===host(operational) && (target.port || '5432')===(operational.port || '5432') && target.pathname===operational.pathname) {
      throw new Error("Testy nie mogą używać bazy aplikacji.");
    }
  }
  const tests = (await readdir(resolve(process.cwd(),"tests"))).filter(name=>name.endsWith(".integration.ts")).map(name=>`tests/${name}`);
  if (!tests.length) throw new Error("Brak testów integracyjnych.");
  // Suites share a synthetic database and some assert complete report totals.
  // Keep suites isolated in time; explicit concurrency tests still run in each suite.
  const child = spawn(process.execPath,["--import","tsx","--test","--test-concurrency=1",...tests],{stdio:"inherit",env:{...process.env,TEST_DATABASE_URL:testUrl}});
  child.on("error",error=>{console.error(error.message);process.exitCode=1;});
  child.on("exit",code=>{process.exitCode=code ?? 1;});
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Testy nie wystartowały.");process.exitCode=1;});
