// Nothing outside a provider's folder names a provider (B71, owner 10 Nov: "I don't like the idea of having our agents limited to razorpay"). The places that have been
// made neutral are held to it here: a file in them that names a gateway, or imports a provider's folder instead of the registry, fails, so the seam cannot quietly
// close again. Each exception is listed with the reason it stays; an exception that no longer names one fails too, so the list only ever shrinks.
//
// Not yet held to it (bundle/Deferred.md, B71): the deployer's secret file names and the inbox's webhook route, the own agent's record and relay, the crash test of
// an own agent on a gateway, the templates' reports and stand-ins. Those still say "razorpay" where the gateway's id belongs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { GATEWAYS } from "../index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
/** Where the rule holds: the panel, the payments flow and the owner-marked module, the shared Guard and approvals code, the templates' agents. */
const HELD = [/^bundle\/panel\//u, /^modules\/payments\/(?!providers\/)/u, /^modules\/messaging\//u, /^modules\/approvals\/(clients|relay)\.ts$/u, /^modules\/standins\//u, /^templates\/[a-z]+\/[a-z-]+\/src\//u];
const EXCEPT: Record<string, string> = {
  "templates/education/fees/src/language/templates.ts": "owner_link_failed (\"... Please check Razorpay\") is the text of a Meta-approved message template; changing it needs Meta's re-review, so it waits for the owner (B71 report)",
  "templates/commerce/orders/src/harness.ts": "the test harness names its gateway example by the example's own file name (annapurna-tiffins-razorpay.example.json)",
};
const isTest = (rel: string) => /(^|\/)test\//u.test(rel) || /\.test\.ts$/u.test(rel);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|js)$/u.test(name)) out.push(path);
  }
  return out;
}

const held = [...files(join(ROOT, "modules")), ...files(join(ROOT, "bundle", "panel")), ...files(join(ROOT, "templates"))]
  .map((p) => relative(ROOT, p).split("\\").join("/")).filter((rel) => !isTest(rel) && HELD.some((r) => r.test(rel)));

test("the neutral places name no gateway: a gateway's name, key shape or id is only in its own folder", () => {
  const names = GATEWAYS.flatMap((g) => [g.id, g.displayName]);
  assert.ok(names.length > 0);
  const pattern = new RegExp(`${[...new Set(names)].join("|")}|rzp_`, "iu");
  const naming = held.filter((rel) => pattern.test(readFileSync(join(ROOT, rel), "utf8")));
  assert.deepEqual(naming.filter((rel) => !Object.hasOwn(EXCEPT, rel)), [], "these name a gateway outside its folder: ask the registry (modules/payments/providers/index.ts) instead");
  assert.deepEqual(Object.keys(EXCEPT).filter((rel) => !naming.includes(rel)), [], "these no longer name one: take them off the list");
});

test("the neutral places import a provider through the registry, never from its folder", () => {
  const direct = held.filter((rel) => /from "[^"]*\/providers\/(?!index\.ts|runtime\.ts|types\.ts)[a-z-]+\//u.test(readFileSync(join(ROOT, rel), "utf8")));
  assert.deepEqual(direct, []);
});
