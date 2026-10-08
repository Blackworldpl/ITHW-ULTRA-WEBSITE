import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

/** Scripts use the same precedence as Next: shell > .env.local > .env. */
export function loadEnv(): void {
  for (const name of [".env.local", ".env"]) {
    const file = resolve(process.cwd(), name);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
