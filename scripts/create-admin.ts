import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import { z } from "zod";
import { hashPassword } from "../src/server/passwords";
import { loadEnv } from "./env";

/** Password is read in raw mode; it never appears in terminal history or output. */
async function hiddenInput(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error("Interaktywny terminal jest wymagany do bezpiecznego podania hasła.");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); stdout.write("\n"); };
    const onData = (data: Buffer) => {
      for (const char of data.toString("utf8")) {
        if (char === "\u0003") { finish(); reject(new Error("Anulowano.")); return; }
        if (char === "\r" || char === "\n") { finish(); resolve(value); return; }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("Ustaw DATABASE_URL; następnie uruchom npm run db:migrate.");
  if (!stdin.isTTY) throw new Error("Uruchom ten skrypt ręcznie w interaktywnym terminalu. Możesz też użyć strony /setup z SETUP_TOKEN.");
  const reader = createInterface({ input: stdin, output: stdout });
  let name: string, email: string;
  try {
    name = (await reader.question("Imię i nazwisko administratora: ")).trim();
    email = (await reader.question("Adres e-mail: ")).trim().toLowerCase();
  } finally { reader.close(); }
  const password = await hiddenInput("Hasło (minimum 12 znaków; niewidoczne): ");
  const confirmation = await hiddenInput("Powtórz hasło: ");
  if (password !== confirmation) throw new Error("Hasła nie są zgodne.");
  const account = z.object({name: z.string().min(1).max(160), email: z.email().max(254), password: z.string().min(12).max(256)}).parse({name,email,password});
  const hash = await hashPassword(account.password);
  const client = new pg.Client({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:10_000});
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(78491329)");
    const existing = await client.query("SELECT 1 FROM users LIMIT 1");
    if (existing.rowCount) throw new Error("System posiada już użytkowników. Kolejne konta tworzy administrator w aplikacji.");
    const {rows} = await client.query<{id:string}>("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN') RETURNING id",[account.name,account.email,hash]);
    await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1::uuid,'CREATE_ADMIN','user',$1::text,'Utworzono pierwszego administratora przez CLI')",[rows[0].id]);
    await client.query("COMMIT");
    console.log("Utworzono pierwszego administratora. Usuń SETUP_TOKEN z konfiguracji po inicjalizacji.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { await client.end(); }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Nie udało się utworzyć administratora."); process.exitCode = 1; });
