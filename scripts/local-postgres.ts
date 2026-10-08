import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs, parseEnv } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { loadEnv } from "./env";

async function main() {
  const { values: options } = parseArgs({ options: { "with-app": { type: "boolean" }, "lan-address": { type: "string" } } });
  const lanAddress = options["lan-address"];
  if (lanAddress && (!options["with-app"] || isIP(lanAddress) !== 4 || !Object.values(networkInterfaces()).flat().some((address) => address && !address.internal && address.address === lanAddress))) {
    throw new Error("--lan-address wymaga --with-app oraz adresu IPv4 aktywnej karty sieciowej tego laptopa. Sprawdź adres przez ipconfig.");
  }
  if (process.env.NODE_ENV === "production") throw new Error("Wbudowany PostgreSQL jest dostępny wyłącznie do lokalnego rozwoju.");
  loadEnv();
  const port = Number(process.env.LOCAL_PG_PORT || "55432");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("LOCAL_PG_PORT musi być liczbą od 1024 do 65535.");
  const dataDir = resolve(process.env.LOCAL_PG_DATA || join(process.env.LOCALAPPDATA || join(homedir(), ".local", "share"), "IT-Hardware", "postgres"));
  const envFile = resolve(process.cwd(), ".env.local");
  const existing = existsSync(envFile) ? await readFile(envFile, "utf8") : "";
  const values = parseEnv(existing);
  const newCluster = !existsSync(join(dataDir, "PG_VERSION"));
  let password: string;
  if (process.env.DATABASE_URL) {
    const target = new URL(process.env.DATABASE_URL);
    if (target.hostname !== "127.0.0.1" || target.port !== String(port) || target.pathname !== "/ithardware" || target.username !== "ithardware_local") {
      throw new Error("DATABASE_URL wskazuje inną bazę. Dla istniejącego PostgreSQL uruchom npm run db:migrate oraz npm run dev. Lokalny start nie nadpisuje tej konfiguracji.");
    }
    password = decodeURIComponent(target.password);
    if (!password) throw new Error("Lokalna baza wymaga hasła.");
    values.DATABASE_URL = process.env.DATABASE_URL;
  } else {
    if (existsSync(join(dataDir, "PG_VERSION"))) throw new Error("Dane PostgreSQL już istnieją, ale brakuje DATABASE_URL z ich hasłem. Przywróć własny plik .env.local; nie usuwaj danych.");
    password = randomBytes(32).toString("base64url");
    values.DATABASE_URL = `postgresql://ithardware_local:${password}@127.0.0.1:${port}/ithardware`;
  }
  if (!process.env.APP_URL) values.APP_URL = "http://localhost:3000";
  if (!process.env.SETUP_TOKEN && newCluster) values.SETUP_TOKEN = randomBytes(32).toString("base64url");
  values.LOCAL_PG_PORT = String(port);
  // JSON string quoting is accepted by Node/Next dotenv parsers.
  const generated = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n");
  await writeFile(envFile, `# Lokalne dane uwierzytelniające. Nie udostępniaj tego pliku.\n${generated}\n`, { mode: 0o600 });
  loadEnv();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const database = new EmbeddedPostgres({
    databaseDir: dataDir, user: "ithardware_local", password, port,
    persistent: true, authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories="],
    // PostgreSQL can echo configuration details. Keep routine logs private.
    onLog: () => {}, onError: () => {},
  });
  if (newCluster) await database.initialise();
  await database.start();
  let app: ReturnType<typeof spawn> | undefined;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    app?.kill("SIGTERM");
    await database.stop();
  };
  process.on("SIGINT", () => { void stop().finally(() => process.exit(0)); });
  process.on("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
  try {
    const client = database.getPgClient();
    await client.connect();
    try {
      const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'ithardware'");
      if (!result.rowCount) await client.query("CREATE DATABASE ithardware");
    } finally {
      await client.end();
    }
    // This launcher may migrate only its validated local cluster, even if the
    // shell happens to contain a remote administrative connection string.
    const localEnvironment = { ...process.env, MIGRATION_DATABASE_URL: process.env.DATABASE_URL };
    const migration = spawn(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { stdio: "inherit", env: localEnvironment });
    await new Promise<void>((resolveMigration, reject) => {
      migration.on("error", reject);
      migration.on("exit", (code) => code === 0 ? resolveMigration() : reject(new Error("Migracja bazy nie powiodła się.")));
    });
    console.log(`Lokalny PostgreSQL gotowy na 127.0.0.1:${port}. Dane: ${dataDir}`);
    console.log("Konfigurację i token pierwszego administratora zapisano w prywatnym pliku .env.local. Zakończ pracę przez Ctrl+C.");
    if (process.argv.includes("--with-app")) {
      const appEnvironment = { ...process.env };
      // Use the same origin for login, writes and QR without changing .env.local.
      if (lanAddress) appEnvironment.APP_URL = `http://${lanAddress}:3000`;
      appEnvironment.MIGRATION_DATABASE_URL = ""; // Also prevents Next from loading this secret from .env.
      console.log(`Adres aplikacji: ${appEnvironment.APP_URL || "http://localhost:3000"}. Otwieraj ten sam adres również na laptopie.`);
      app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", lanAddress || "127.0.0.1", "--port", "3000"], { stdio: "inherit", env: appEnvironment });
      await new Promise<void>((resolveApp, reject) => {
        app!.on("error", reject);
        app!.on("exit", (code) => code === 0 ? resolveApp() : reject(new Error(`Aplikacja zakończyła pracę (${code}).`)));
      });
    } else {
      await new Promise<void>(() => {});
    }
  } finally {
    await stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Lokalny PostgreSQL nie wystartował.");
  process.exitCode = 1;
});
