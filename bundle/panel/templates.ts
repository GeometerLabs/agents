// The templates the panel can set up, found on their own: any folder in templates/<domain>/ with a template.json. A contributed template appears in setup
// without a change here. The manifest says which accounts the template uses, so setup never asks for a key the template does not need.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isObj } from "./contract.ts";
import type { AccountKind } from "./contract.ts";

export type StepId = "business" | "deposit" | "languages" | "accounts" | "checks";
export const STEP_IDS: readonly StepId[] = ["business", "deposit", "languages", "accounts", "checks"];

export interface Template {
  id: string;
  version: string;
  /** Which phone form sets it up: "bookings", or a template with its own forms (a row in setups.ts: "fees", "orders"). Any other template is listed but set up by a builder. */
  setup: string;
  steps: StepId[];
  accounts: AccountKind[];
  folder: string;
  settingsExample: string;
}

/** `templatesDir` is the folder with the domain folders in it (templates/), each holding templates: templates/<domain>/<name>/template.json. */
export function discoverTemplates(templatesDir: string): Template[] {
  if (!existsSync(templatesDir)) return [];
  const found: Template[] = [];
  const folders = readdirSync(templatesDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    .flatMap((domain) => readdirSync(join(templatesDir, domain.name), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(templatesDir, domain.name, e.name)));
  for (const folder of folders) {
    try {
      const m: unknown = JSON.parse(readFileSync(join(folder, "template.json"), "utf8"));
      if (!isObj(m) || m.schema !== 1 || typeof m.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/u.test(m.id) || typeof m.setup !== "string") continue;
      const accounts = Array.isArray(m.accounts) ? m.accounts.filter((a): a is AccountKind => a === "whatsapp" || a === "calendar" || a === "payment") : [];
      const steps = Array.isArray(m.steps) ? STEP_IDS.filter((s) => (m.steps as unknown[]).includes(s)) : [...STEP_IDS];
      const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { version?: string };
      found.push({ id: m.id, version: pkg.version ?? "0.0.0", setup: m.setup, steps, accounts, folder, settingsExample: typeof m.settingsExample === "string" ? m.settingsExample : "" });
    } catch { /* a folder without a readable manifest is not a template the panel can set up */ }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
