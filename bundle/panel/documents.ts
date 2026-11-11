// The papers the panel makes (the go-live certificate, the monthly reports and certificates) are kept in the panel's own store, so they are sealed
// with everything else when the panel has a data key. The report code writes files into a folder it is given; that folder is a temporary one, read
// straight back into the store and removed. A paper is served by opening it from the store.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "./store.ts";

export const DOC_NAME = /^[a-z0-9][a-z0-9._-]{0,80}\.(html|json|txt)$/u;

// Keeps generated papers in the panel store (sealed when there is a key) rather than loose files; report code writes into a temp folder that is read back and removed.
export function createDocuments(store: Store) {
  const base = (shop: string) => `documents/${shop}`;
  return {
    /** Run `write` with a scratch folder, keep every file it made under documents/<shop>/<folder>/, and remove the scratch folder. */
    make<T>(shop: string, folder: string, write: (scratch: string) => T): T {
      const scratch = mkdtempSync(join(tmpdir(), "geo-panel-doc-"));
      try {
        const result = write(scratch);
        for (const name of readdirSync(scratch)) if (DOC_NAME.test(name)) store.write(`${base(shop)}/${folder}/${name}`, readFileSync(join(scratch, name), "utf8"));
        return result;
      } finally { rmSync(scratch, { recursive: true, force: true }); }
    },
    /** "go-live" papers are `name`; "monthly" papers are `2026-11/name`. */
    list(shop: string, kind: "go-live" | "monthly"): string[] {
      if (kind === "go-live") return store.list(`${base(shop)}/go-live`);
      return store.list(`${base(shop)}/monthly`).flatMap((month) => store.list(`${base(shop)}/monthly/${month}`).map((f) => `${month}/${f}`));
    },
    get(shop: string, relative: string): string | undefined { return store.read<string>(`${base(shop)}/${relative}`); },
  };
}

export type Documents = ReturnType<typeof createDocuments>;
