// The panel's own small files: JSON, written whole by writing a temporary file beside it and renaming it over, and sealed by the vault when
// the panel has a data key. One process owns the folder, so a read after a write sees it. A file that cannot be opened is an error with a plain
// sentence, never an empty default: a tampered accounts file must not quietly become "no accounts".
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Vault } from "./vault.ts";

export interface Store {
  readonly encrypted: boolean;
  read<T>(name: string): T | undefined;
  write(name: string, value: unknown): void;
  remove(name: string): void;
  list(folder: string): string[];
  /** Where it all lives, so a test can look at the bytes. */
  dir: string;
}

const SAFE_NAME = /^[a-z0-9][a-z0-9._/-]{0,120}$/u;

// The panel's file store over one folder: whole-file writes through a temp file and rename (a crash never leaves half a file), sealed by the vault when there is a key.
export function createStore(dir: string, vault: Vault): Store {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = (name: string) => {
    if (!SAFE_NAME.test(name) || name.includes("..") || name.includes("//")) throw new Error(`"${name}" is not a name the panel keeps data under.`);
    return join(dir, name);
  };
  return {
    encrypted: vault.encrypted,
    dir,
    read<T>(name: string): T | undefined {
      const file = path(name);
      if (!existsSync(file)) return undefined;
      return JSON.parse(vault.open(readFileSync(file, "utf8"), name)) as T;
    },
    write(name, value) {
      const file = path(name);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = join(dirname(file), `.${randomBytes(6).toString("hex")}.tmp`);
      writeFileSync(tmp, vault.seal(JSON.stringify(value), name), { mode: 0o600 });
      renameSync(tmp, file);
    },
    remove(name) { rmSync(path(name), { force: true }); },
    list(folder) {
      const d = path(folder);
      return existsSync(d) ? readdirSync(d).filter((f) => !f.startsWith(".")).sort() : [];
    },
  };
}
