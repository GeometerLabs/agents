// Drift: the monorepo's Guard templates (deploy/pathways/bookings) are now a FIXTURE, and the generator is the source. This compares the shapes that must
// not drift (routes, rule ids and kinds, limits, intents, the guard.toml keys and the headers) and ignores the numbers and the ids that are a shop's own.
// It reads the monorepo from a sibling path and skips, saying why, when that is not there (the open repository is used alone).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { guardDef, guardToml } from "../generate/guards.ts";
import { planModelGuard, planShop } from "../generate/shop.ts";
import { panelRuntime, serverConfig, tempServer } from "./helpers.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CANDIDATES = [process.env.GEOMETER_MONOREPO, join(ROOT, "..", "monorepo"), join(ROOT, "..", "..", "monorepo"), join(ROOT, "..", "..", "geometer", "monorepo"), join(ROOT, "..", "geometer", "monorepo")].filter((x): x is string => !!x);
const TEMPLATES = CANDIDATES.map((c) => join(c, "deploy", "pathways", "bookings")).find((c) => existsSync(join(c, "razorpay", "spec.json")));
const skip = TEMPLATES ? false : "the monorepo's deploy/pathways/bookings templates are not at a sibling path (set GEOMETER_MONOREPO to its folder to run this)";

/**
 * What the bundle adds to the fixtures on purpose: the panel's read-only routes and the exact-id rule beside each, and in `[licence]` the recipient field written out
 * (`to`, Guard's own default, so the file says which field the owner's exception reads). Anything else that differs is drift.
 */
const ADDED = { routes: ["read_number", "get_calendar"], rules: ["own-number-read", "own-calendar-get-calendar"], licence: ["recipient_field"] };

const read = (dir: string, file: string) => readFileSync(join(TEMPLATES!, dir, file), "utf8");
const shape = (spec: any) => ({
  schema: spec.schema, tool: spec.tool,
  routes: spec.routes.map((r: any) => [r.method, r.path, r.operation]),
  rules: spec.rules.map((r: any) => [r.id, r.kind, r.operation, r.field ?? r.amount_field ?? null, r.match ?? null, r.units ?? null]),
  limits: spec.limits.map((l: any) => [l.id, l.kind, l.operation, l.amount_field ?? null, l.scope, l.window_seconds]),
  intents: spec.intents, fail_policy: spec.fail_policy,
});

/** A guard.toml's keys: the top-level ones, the tables, and the lines whose values are not a shop's own (in `[licence]`: the paths and the two lists). */
function tomlShape(text: string) {
  const top = new Map<string, string>(); const tables = new Set<string>(); const headers = new Map<string, string>(); const licence = new Map<string, string>();
  let table = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const t = /^\[+([^\]]+)\]+$/u.exec(line);
    if (t) { table = t[1]; tables.add(table); continue; }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/u.exec(line);
    if (!kv) continue;
    // anthropic-version is a date the request shape is written for: the generator writes the parser's own (Explanation.md says why it differs).
    if (table === "") top.set(kv[1], kv[2]); else if (table === "upstream_headers") headers.set(kv[1], kv[1] === "anthropic-version" ? "(a version)" : kv[2]);
    else if (table === "licence" && !ADDED.licence.includes(kv[1])) licence.set(kv[1], ["deployment", "shop", "owner_numbers"].includes(kv[1]) ? "(the server's, the shop's)" : kv[2]);
  }
  const same = ["schema", "profile", "listen", "admin_listen", "health_listen", "mode", "upstream", "upstream_timeout_ms", "state", "bundle", "unlisted_tools"];
  return { keys: [...top.keys()].sort(), values: same.map((k) => [k, top.get(k)]), tables: [...tables].sort(), headers: [...headers.entries()].sort(), licence: [...licence.entries()].sort() };
}

function generatedToml(kind: "razorpay" | "whatsapp" | "calendar" | "model", model = serverConfig().model) {
  const t = tempServer({ "glow-salon": panelRuntime() });
  try {
    const server = serverConfig({ model });
    const g = kind === "model" ? planModelGuard(server) : planShop(server, t.shop("glow-salon")).guards.find((x) => x.kind === kind)!;
    // a per-shop Guard is given `[licence]` when geometer.json pins a key and the image reads it (deploy.ts licenceFor); the monorepo's templates carry it (ADR-0062)
    const licence = kind === "model" ? {} : { licence: { deployment: server.id, shop: "glow-salon", ownerNumbers: ["+919000000000"] } };
    return { g, toml: guardToml({ def: guardDef(kind, model), tenant: g.tenant, deployment: g.deployment, bundleDigest: "sha256:" + "0".repeat(64), upstream: { host: g.def.upstream, tls: true }, adminSha: "0".repeat(64), agents: [{ id: "runtime-glow-salon", sha: "0".repeat(64) }], ...(kind === "razorpay" ? { approver: { id: "owner-glow-salon", secretFile: "/run/secrets/owner_notify_secret" } } : {}), ...licence }) };
  } finally { t.done(); }
}

for (const [kind, dir, model] of [
  ["razorpay", "razorpay", undefined],
  ["whatsapp", "whatsapp-cloud", undefined],
  ["calendar", "google-calendar", undefined],
  ["model", "model-openai", { wire: "openai", model: "gpt-4o-mini" } as const],
  ["model", "model-anthropic", { wire: "anthropic", model: "claude-haiku-4-5" } as const],
] as const) {
  test(`the generated ${dir} spec and guard.toml have the shape of the monorepo template`, { skip }, () => {
    const { g, toml } = generatedToml(kind, model);
    const generated = shape(g.spec);
    generated.routes = generated.routes.filter((r: string[]) => !ADDED.routes.includes(r[2]));
    generated.rules = generated.rules.filter((r: unknown[]) => !ADDED.rules.includes(r[0] as string));
    assert.deepEqual(generated, shape(JSON.parse(read(dir, "spec.json"))), `${dir}/spec.json drifted from the generator`);
    assert.deepEqual(tomlShape(toml), tomlShape(read(dir, "guard.toml")), `${dir}/guard.toml drifted from the generator`);
  });
}
