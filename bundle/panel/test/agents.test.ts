// Own agents in the panel (B51's rest, 12 Nov 2026, agents.ts and views-agents.ts): a builder sees each own agent beside the shops, from the files the deployer writes
// (status/<agent>.json `own`, exports/<agent>/), with its Guards and their credentials' dates but never a credential; a partner sees none and gets a 404; the three
// actions write request files that hold a name and an id and nothing a command could run; no script on the page; and none of the words a page must not say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import { formatRupees, latestPriceList, paiseOf, chargeOf } from "../cost.ts";
import { flatWords, panelRows } from "../review.ts";
import { AGENT_SAMPLE_ARGS, AGENT_WORDS } from "../words-agents.ts";
import { NOW, boot, tokenOf } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const AT = new Date(NOW).toISOString();
const CREDENTIAL = `gg_${"c".repeat(32)}`; // what a credential looks like; the panel never has one, and the page must never show one

/** What the deployer writes for a deployed own agent (lib/status.ts, agent/requests.ts). */
function ownAgent(b: Boot, id = "my-agent", o: { held?: number; crash?: Record<string, unknown>; stopped?: boolean } = {}) {
  b.status(id, {
    shop: id, updatedAt: AT, deploy: { state: "applied", at: AT }, limits: { proven: 12, of: 12, unprovable: [], line: "12 of 12 limits proven to bite", perGuard: {} },
    versions: { pathway: "own-agent", bundle: "0.1.0", guard: "geo-guard:x", guards: {} }, backups: { lastCopyAt: null, lastDrillAt: null, drillOk: null },
    ...(o.stopped ? { stopped: { at: AT, by: "the builder", reason: "owner asked" } } : {}),
    licence: { state: "active", listed: true, paidThrough: "2026-12-01T00:00:00.000Z", windDownOn: null, stopOn: null, exportUntil: null, leaseIssuedAt: AT, extendedUntil: null, at: AT },
    own: {
      baseUrls: { razorpay: `https://shops.example.com/g/${id}/razorpay`, whatsapp: `https://shops.example.com/g/${id}/whatsapp` },
      credentials: { shared: false, guards: { razorpay: { since: AT, oldUntil: "2026-11-04T04:45:00.000Z" }, whatsapp: { since: AT } } },
      held: { calls: o.held ?? 0, at: AT },
    },
  });
  const dir = join(b.dir, "exports", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "record.json"), "[]");
  writeFileSync(join(dir, "bookings.json"), "[]");
  writeFileSync(join(dir, "crash-test.json"), JSON.stringify({ at: AT, version: "4f9c2e1", held: 11, of: 12, failed: ["The owner says no to a held refund"], notRun: [], goLive: false, by: "the command line", ...o.crash }));
  writeFileSync(join(dir, "in-service.json"), JSON.stringify({ version: "4f9c2e1", at: AT, held: 12, of: 12, code: "GL-7K2M" }));
}

test("a builder sees each own agent beside the shops; a partner sees none, and its page is a 404 to them", async () => {
  const b = await boot(); try {
    b.addShop("glow-salon");
    ownAgent(b, "my-agent", { held: 1 });
    const builder = await b.account("asha", "builder");
    const shops = await builder.get("/shops");
    assert.equal(shops.status, 200);
    assert.match(shops.plain, /Your own agents/u);
    assert.match(shops.text, /href="\/agents\/my-agent"/u);
    assert.match(shops.plain, /1 call is waiting for the owner's answer on WhatsApp\./u);
    assert.ok(!shops.text.includes('href="/shops/my-agent"'), "an agent is not listed as a shop");
    const partner = await b.account("divya", "partner");
    const theirs = await partner.get("/shops");
    assert.ok(!theirs.plain.includes("Your own agents") && !theirs.text.includes("/agents/my-agent"));
    assert.equal((await partner.get("/agents/my-agent")).status, 404);
    assert.equal((await builder.get("/agents/glow-salon")).status, 404, "a shop is not an agent");
    assert.equal((await builder.get("/agents/nobody")).status, 404);
  } finally { await b.close(); }
});

test("the agent's page: its Guards and their credentials' dates (never a credential), health, held calls, unfinished work, the last crash test, go-live, the licence line from the price list; no script", async () => {
  const b = await boot(); try {
    ownAgent(b, "my-agent", { held: 2 });
    const builder = await b.account("asha", "builder");
    const page = await builder.get("/agents/my-agent");
    assert.equal(page.status, 200);
    const p = page.plain;
    for (const line of ["my-agent: your own agent", "Razorpay", "WhatsApp", "https://shops.example.com/g/my-agent/razorpay", "12 of 12 limits proven to bite on the running Guards",
      "2 calls are waiting for the owner's answer on WhatsApp.", "Nothing is unfinished.", "Held 11 of 12.", "The owner says no to a held refund",
      "Version 4f9c2e1 is in service", "Certificate GL-7K2M.", "secrets/agents/my-agent/credentials.env", "the old credential still works until"]) assert.ok(p.includes(line), `the page says: ${line}`);
    const prices = latestPriceList()!;
    const licence = formatRupees(paiseOf(chargeOf(prices, null, true)!.fee!.value));
    assert.ok(p.includes(`Builder licence: ${licence} a month for each live client business`), "the licence's price is the price list's, in the panel's own words for it");
    assert.ok(!/gg_[0-9a-f]{32}/u.test(page.text) && !page.text.includes(CREDENTIAL), "no credential on the page");
    assert.ok(!/<script/iu.test(page.text), "no JavaScript");
    assert.match(page.text, /<meta name="viewport" content="width=device-width/u, "the panel's phone-width layout");
    assert.ok(p.includes("not even a refund"), "the kill switch is said as it is: Guard refuses everything, refunds too");
    for (const action of ["/agents/my-agent/stop", "/agents/my-agent/crash-test", "/agents/my-agent/rotate"]) assert.ok(page.text.includes(`action="${action}"`), `${action} is offered`);
    assert.ok(!/action="[^"]*remove/u.test(page.text), "removing is not offered here");
    assert.match(p, /geometer agent remove <name>/u, "it says where it is done");
  } finally { await b.close(); }
});

test("the three actions write request files with a name and an id only, which the deployer carries out; a Guard the agent does not have is a 404", async () => {
  const b = await boot(); try {
    ownAgent(b);
    const builder = await b.account("asha", "builder");
    const form = async (path: string, extra: Record<string, string> = {}) => builder.req("POST", path, { _csrf: tokenOf((await builder.get("/agents/my-agent")).text), ...extra });
    assert.equal((await form("/agents/my-agent/crash-test")).status, 303);
    assert.equal((await form("/agents/my-agent/rotate", { guard: "whatsapp" })).status, 303);
    assert.equal((await form("/agents/my-agent/stop")).status, 303);
    const requests = join(b.dir, "requests");
    const crash = JSON.parse(readFileSync(join(requests, "my-agent.crash-test.json"), "utf8"));
    const rotate = JSON.parse(readFileSync(join(requests, "my-agent.rotate.json"), "utf8"));
    const stop = JSON.parse(readFileSync(join(requests, "my-agent.stop.json"), "utf8"));
    assert.deepEqual(Object.keys(crash).sort(), ["agent", "requestId", "requestedAt", "requestedBy", "schema"], "a name and an id, and who asked: nothing a command could run");
    assert.deepEqual([rotate.agent, rotate.guard], ["my-agent", "whatsapp"]);
    assert.equal(stop.shop, "my-agent", "the stop is the same request a shop's is");
    const after = await builder.get("/agents/my-agent");
    assert.match(after.plain, /A crash test is asked for\./u);
    assert.match(after.plain, /New credentials asked\./u);
    assert.match(after.plain, /Stop asked\./u);
    assert.equal((await form("/agents/my-agent/rotate", { guard: "calendar" })).status, 404, "this agent has no calendar Guard");
    assert.ok(!b.logs.some((l) => /gg_/u.test(l)), "the log never holds a credential");
  } finally { await b.close(); }
});

test("a running crash test, one that could not run, and a stopped agent read as such", async () => {
  const b = await boot(); try {
    ownAgent(b, "my-agent", { crash: { running: true }, stopped: true });
    const builder = await b.account("asha", "builder");
    const page = (await builder.get("/agents/my-agent")).plain;
    assert.match(page, /A crash test is running\./u);
    assert.ok(!page.includes("Run a new crash test"), "no second one while one runs");
    assert.match(page, /It is stopped\./u);
    ownAgent(b, "my-agent", { crash: { error: "my-agent has no command to start it with." } });
    assert.match((await builder.get("/agents/my-agent")).plain, /The crash test could not run: my-agent has no command to start it with\./u);
  } finally { await b.close(); }
});

test("the own-agent words: four languages of one shape, on the review sheets, and none of the words a page must not say", () => {
  const banned = /\b(safe|guaranteed?|proves|certified)\b|100%/iu;
  for (const l of LANGUAGES) for (const [id, text] of flatWords({ agents: AGENT_WORDS[l] }, AGENT_SAMPLE_ARGS)) assert.ok(!banned.test(text), `${l} ${id}: ${text}`);
  const en = [...flatWords({ agents: AGENT_WORDS.en }, AGENT_SAMPLE_ARGS).keys()];
  for (const l of LANGUAGES) assert.deepEqual([...flatWords({ agents: AGENT_WORDS[l] }, AGENT_SAMPLE_ARGS).keys()], en, `${l} has every line`);
  for (const l of ["ml", "kn"] as const) assert.ok(panelRows(l).some((r) => r.id === "agents.heading"), `the ${l} review sheet lists them`);
  assert.ok(existsSync(new URL("../../../templates/commerce/bookings/REVIEW-ml.md", import.meta.url)));
});
