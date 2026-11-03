// The templates the panel can set up, found on their own: any folder in pathways/ with a template.json. A contributed template appears in setup
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
  /** Which phone form sets it up. Only "bookings" exists; any other template is listed but set up by a builder. */
  setup: string;
  steps: StepId[];
  accounts: AccountKind[];
  folder: string;
  settingsExample: string;
}

export function discoverTemplates(pathwaysDir: string): Template[] {
  if (!existsSync(pathwaysDir)) return [];
  const found: Template[] = [];
  for (const entry of readdirSync(pathwaysDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = join(pathwaysDir, entry.name);
    try {
      const m: unknown = JSON.parse(readFileSync(join(folder, "template.json"), "utf8"));
      if (!isObj(m) || m.schema !== 1 || typeof m.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/u.test(m.id) || typeof m.setup !== "string") continue;
      const accounts = Array.isArray(m.accounts) ? m.accounts.filter((a): a is AccountKind => a === "whatsapp" || a === "calendar" || a === "razorpay") : [];
      const steps = Array.isArray(m.steps) ? STEP_IDS.filter((s) => (m.steps as unknown[]).includes(s)) : [...STEP_IDS];
      const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { version?: string };
      found.push({ id: m.id, version: pkg.version ?? "0.0.0", setup: m.setup, steps, accounts, folder, settingsExample: typeof m.settingsExample === "string" ? m.settingsExample : "" });
    } catch { /* a folder without a readable manifest is not a template the panel can set up */ }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
