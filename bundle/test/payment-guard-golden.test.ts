// What a shop that chose a gateway gets from Guard must come out the same bytes after the provider code moved into its own folder (B71). This pins, from one file made before
// the move: the gateway limits spec for every template and example, the whole plan (spec, runtime) of a shop and of an own agent, the guard.toml, and the compose file with its
// addresses. Change the golden file only on purpose: `GOLDEN_WRITE=1 node --test test/payment-guard-golden.test.ts` from bundle/.
//
// Compared both ways: stableJson is what is hashed and deployed; JSON.stringify keeps array order and insertion order, which anything reading the spec directly can see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAgent } from "../agent/folder.ts";
import { addAgent } from "../agent/deploy.ts";
import { planAgent } from "../agent/plan.ts";
import { composeServer, yaml } from "../generate/compose.ts";
import type { AgentDeploy, ShopDeploy } from "../generate/compose.ts";
import { guardToml } from "../generate/guards.ts";
import { planShop } from "../generate/shop.ts";
import { KINDS } from "../lib/kinds.ts";
import { stableJson } from "../lib/util.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, panelRuntime, serverConfig, tempServer } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, "fixtures", "payment-guard-golden.json");
const repo = join(here, "..", "..");
const NOW = new Date("2026-11-05T09:00:00Z");

interface Entry { stable: string; json: string }
const entry = (v: unknown): Entry => ({ stable: stableJson(v), json: JSON.stringify(v) });

/** One example's settings, read as a shop that chose the gateway. The block is added here so the same input is used before and after the default flips to UPI. */
function settings(kind: string, file: string): unknown {
  const raw = JSON.parse(readFileSync(join(repo, file), "utf8")) as Record<string, unknown>;
  const checked = KINDS[kind].validateSettings({ ...raw, payment: { module: "razorpay" } });
  if (!checked.ok) throw new Error(`${file}: ${checked.errors.join("; ")}`);
  return checked.settings;
}

function build(): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  const examples: [string, string, string][] = [
    ["bookings", "templates/commerce/bookings/settings/glow-salon.example.json", "glow-salon"],
    ["bookings", "templates/commerce/bookings/settings/equipment-rental.example.json", "equipment-rental"],
    ["fees", "templates/education/fees/settings/bright-tuition.example.json", "bright-tuition"],
    ["fees", "templates/education/fees/settings/maths-circle.example.json", "maths-circle"],
    ["orders", "templates/commerce/orders/settings/annapurna-tiffins-razorpay.example.json", "annapurna"],
    ["orders", "templates/commerce/orders/settings/sweet-crumbs.example.json", "sweet-crumbs"],
  ];
  for (const [kind, file, name] of examples) {
    const s = settings(kind, file);
    const id = { tenant: name, name: `${name}-razorpay`, version: 1, reviewedBy: "golden" };
    out[`${name}/spec/defaults`] = entry(KINDS[kind].razorpaySpec(s, id, { approvalTtlSeconds: 86_400 }));
    out[`${name}/spec/caps`] = entry(KINDS[kind].razorpaySpec(s, { ...id, version: 7 }, { approvalTtlSeconds: 21_600, caps: { refundPaisePerDay: 900_000, refundsPerDay: 5, linksPerHour: 11 } }));
  }

  const server = serverConfig();
  const t = tempServer({ "glow-salon": panelRuntime() });
  try {
    const plan = planShop(server, t.shop("glow-salon"));
    assert.deepEqual(plan.problems, []);
    out["shop/runtime"] = entry(plan.runtime);
    out["shop/notes"] = entry(plan.notes);
    for (const g of plan.guards) out[`shop/guard/${g.kind}`] = entry({ kind: g.kind, service: g.service, deployment: g.deployment, def: g.def, upstream: g.upstream, specText: g.specText });
    for (const g of plan.guards) {
      out[`shop/toml/${g.kind}`] = entry(guardToml({ def: g.def, tenant: g.tenant, deployment: g.deployment, bundleDigest: `sha256:${"a".repeat(64)}`, upstream: g.upstream, adminSha: "b".repeat(64), agents: [{ id: `runtime-${g.tenant}`, sha: "c".repeat(64) }, { id: `panel-${g.tenant}`, sha: "d".repeat(64) }], ...(g.kind === "razorpay" ? { approver: { id: `owner-${g.tenant}`, secretFile: "/run/secrets/owner_notify_secret" } } : {}) }));
    }
    const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", backups: "/srv/backups" } as Parameters<typeof composeServer>[1];
    const shop: ShopDeploy = { name: "glow-salon", index: 1, pathwayDir: "/repo/templates/commerce/bookings", guards: plan.guards.map((g) => ({ kind: g.kind, service: g.service })) as ShopDeploy["guards"] };
    const composed = composeServer(serverConfig({ panel: { enabled: true } }), dirs, [shop], { panel: { user: "501:20", shareAddress: "calendar@x.iam.gserviceaccount.com" } } as Parameters<typeof composeServer>[3]);
    out["compose/text"] = { stable: composed.compose, json: composed.compose };
    out["compose/caddyfile"] = { stable: composed.caddyfile, json: composed.caddyfile };

    addAgent(t.root, "own", { "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID, "refund-inr-per-day": "9000", "refunds-per-day": "4", "links-per-hour": "13", upstreams: "razorpay,whatsapp,calendar" }, () => { throw new Error("no file"); }, NOW);
    const agentFolder = readAgent(t.root, "own");
    const agentPlan = planAgent(server, agentFolder);
    assert.deepEqual(agentPlan.problems, []);
    for (const g of agentPlan.guards) out[`agent/guard/${g.kind}`] = entry({ kind: g.kind, service: g.service, deployment: g.deployment, def: g.def, upstream: g.upstream, specText: g.specText });
    const agentDeploy: AgentDeploy = { name: "own", index: 2, guards: agentPlan.guards.map((g) => ({ kind: g.kind, service: g.service })) as AgentDeploy["guards"] } as AgentDeploy;
    out["agent/compose"] = entry(yaml(composeServer(serverConfig({ panel: { enabled: true } }), dirs, [], { agents: [agentDeploy], opsUser: "501:20" } as Parameters<typeof composeServer>[3]).compose as never));
  } finally { t.done(); }
  return out;
}

test("a shop that chose the gateway: its Guard spec, plan, guard.toml and compose file are byte-identical to before providers moved into their folders", () => {
  const now = build();
  if (process.env.GOLDEN_WRITE === "1") { writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`); return; }
  assert.ok(existsSync(GOLDEN), "the golden file is checked in; make it once with GOLDEN_WRITE=1");
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Entry>;
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  for (const [key, want] of Object.entries(golden)) {
    assert.equal(now[key].stable, want.stable, `${key}: stableJson changed`);
    assert.equal(now[key].json, want.json, `${key}: JSON.stringify changed (array or key order)`);
  }
});
