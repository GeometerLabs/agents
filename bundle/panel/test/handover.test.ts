// Moving a shop to another partner or builder (B38): with the owner's agreement from their own number, the reason recorded, never to Geometer, and what moves and what does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { personLabel } from "../../../modules/record/fingerprint.ts";
import { handoverHash } from "../../../modules/approvals/handover.ts";
import { readShop } from "../../lib/server.ts";
import { WORDS } from "../languages.ts";
import { NOW, accountIdOf, boot } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const HOUR = 3_600_000;
const w = WORDS.en.handover;

function writeRecord(b: Boot, shop: string, entries: unknown[]): void {
  mkdirSync(join(b.dir, "exports", shop), { recursive: true });
  writeFileSync(join(b.dir, "exports", shop, "record.json"), JSON.stringify(entries));
  writeFileSync(join(b.dir, "exports", shop, "bookings.json"), "[]");
}
const ownerNumber = (b: Boot, shop: string): string => JSON.parse(readFileSync(join(b.dir, "shops", shop, "settings.json"), "utf8")).owner.whatsapp;
const agreed = (b: Boot, shop: string, code: string, at: number, o: { conversation?: string; action?: string; outcome?: string } = {}) => ({
  seq: 1, time: new Date(at).toISOString(), conversation: o.conversation ?? personLabel(b.personKey(shop), "c", ownerNumber(b, shop)), booking: null, action: o.action ?? "handover_agreed", inputsDigest: "0", outcome: o.outcome ?? "confirmed",
  decisions: [], language: "en", notes: "", refs: { command: "handover", handover: handoverHash(code) },
});
const codeOf = (page: string): string => /move ([A-Z2-9]{6})</u.exec(page)?.[1] ?? "";

async function setUp(extra: Partial<Parameters<typeof boot>[0]> = {}) {
  const b = await boot(extra);
  const arjun = await b.account("arjun", "builder");
  const divya = await b.account("divya", "partner");
  const meera = await b.account("meera", "partner");
  const kiran = await b.account("kiran", "partner");
  await b.account("geometer-team", "partner");
  b.addShop("glow-salon", { name: "Glow Salon", ownerId: accountIdOf(b, "divya"), ownerName: "DIVYA" });
  return { b, arjun, divya, meera, kiran };
}

test("the page says what moves, what stays, that keys are not carried across, and that a shop never goes to Geometer", async () => {
  const { b, divya } = await setUp();
  try {
    const page = (await divya.get("/shops/glow-salon/handover")).plain;
    for (const line of [w.intro, w.moves, w.stays, w.never, w.who, w.why, w.reasons.stopped_paying, w.reasons.stopped_serving, w.reasons.owner_request]) assert.ok(page.includes(line), line);
    assert.ok(/Keys are not carried across/u.test(page));
    assert.ok((await divya.get("/shops/glow-salon")).plain.includes(WORDS.en.handover.button), "the shop page has the way in");
  } finally { await b.close(); }
});

test("a move needs somebody on this server, a reason, and not Geometer, not the same person, and not two at once", async () => {
  const { b, divya } = await setUp();
  try {
    const ask = (to: string, reason: string) => divya.post("/shops/glow-salon/handover", { to, reason }, "/shops/glow-salon/handover");
    assert.ok((await ask("nobody-here", "owner_request")).plain.includes(w.problems.who));
    assert.ok((await ask("geometer-team", "owner_request")).plain.includes(w.problems.geometer));
    assert.ok((await ask("divya", "owner_request")).plain.includes(w.problems.same));
    assert.ok((await ask("meera", "")).plain.includes(w.problems.reason));
    assert.ok((await ask("meera", "because i said so")).plain.includes(w.problems.reason));
    assert.deepEqual(readdirSync(join(b.dir, "shops", "glow-salon")).filter((f) => f === "assignment.json"), []);
    const made = await ask("meera", "stopped_paying");
    assert.equal(made.status, 200);
    assert.ok(codeOf(made.plain).length === 6, made.plain.slice(0, 1500));
    assert.ok((await ask("kiran", "owner_request")).plain.includes(w.problems.waiting));
  } finally { await b.close(); }
});

test("the shop moves only when the owner's own number has sent the code: not from another number, not another code, not before the ask, not after it ran out", async () => {
  const { b, divya, meera, arjun } = await setUp();
  try {
    const made = await divya.post("/shops/glow-salon/handover", { to: "meera", reason: "stopped_paying" }, "/shops/glow-salon/handover");
    const code = codeOf(made.plain);
    assert.ok(code);
    // the panel keeps the code's hash, never the code
    const kept = readFileSync(join(b.dir, "panel", "data", "handover", "glow-salon.json"), "utf8");
    assert.ok(!kept.includes(code) && kept.includes(handoverHash(code)));
    assert.ok(!(await meera.get("/shops")).plain.includes("Glow Salon"), "nothing has moved yet");
    writeRecord(b, "glow-salon", [
      agreed(b, "glow-salon", code, NOW + HOUR, { conversation: personLabel(b.personKey("glow-salon"), "c", "+919800099999") }), // a customer's number, not the owner's
      agreed(b, "glow-salon", "ZZZZZZ", NOW + HOUR), // another code
      agreed(b, "glow-salon", code, NOW - HOUR), // before the ask
      agreed(b, "glow-salon", code, NOW + 80 * HOUR), // after it ran out
      agreed(b, "glow-salon", code, NOW + HOUR, { outcome: "blocked" }), // not a confirmed line
      agreed(b, "glow-salon", code, NOW + HOUR, { action: "owner_decision" }), // not the agreement
    ]);
    assert.ok(!(await meera.get("/shops")).plain.includes("Glow Salon"));
    assert.ok((await divya.get("/shops/glow-salon/handover")).plain.includes(w.waiting("MEERA")));
    writeRecord(b, "glow-salon", [agreed(b, "glow-salon", code, NOW + HOUR)]);
    assert.ok((await meera.get("/shops")).plain.includes("Glow Salon"), "the owner's own number sent the code: the shop is Meera's now");
    assert.equal((await divya.get("/shops/glow-salon")).status, 404, "and no longer Divya's");
    assert.equal((await divya.post("/shops/glow-salon/handover", { to: "kiran", reason: "owner_request" }, "/shops")).status, 404);
    // what was written: the new person, the reason, the owner's agreement; owner.json (who set it up) is as it was
    const assignment = JSON.parse(readFileSync(join(b.dir, "shops", "glow-salon", "assignment.json"), "utf8"));
    assert.equal(assignment.current.accountName, "MEERA");
    assert.equal(assignment.history.length, 1);
    assert.equal(assignment.history[0].reason, "stopped_paying");
    assert.equal(assignment.history[0].from.accountName, "DIVYA");
    assert.equal(assignment.history[0].ownerAgreed.codeHash, handoverHash(code));
    assert.equal(JSON.parse(readFileSync(join(b.dir, "shops", "glow-salon", "owner.json"), "utf8")).accountName, "DIVYA");
    // the builder sees the history; the code is used up: the same line cannot move the shop again
    const page = (await arjun.get("/shops/glow-salon/handover")).plain;
    assert.ok(page.includes(w.historyLine("DIVYA", "MEERA", "", w.reasons.stopped_paying).split(",")[0]));
    const again = await meera.post("/shops/glow-salon/handover", { to: "kiran", reason: "owner_request" }, "/shops");
    assert.equal(again.status, 200, "Meera can now move it on");
    assert.ok(codeOf(again.plain) && codeOf(again.plain) !== code);
    assert.ok((await meera.get("/shops/glow-salon")).status === 200, "the old agreement does not move it to Kiran");
  } finally { await b.close(); }
});

test("a request runs out after 72 hours and can be asked again; a request can be cancelled", async () => {
  const { b, divya } = await setUp();
  try {
    await divya.post("/shops/glow-salon/handover", { to: "meera", reason: "owner_request" }, "/shops/glow-salon/handover");
    const file = join(b.dir, "panel", "data", "handover", "glow-salon.json");
    const pending = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(Date.parse(pending.expiresAt) - Date.parse(pending.requestedAt), 72 * HOUR, "72 hours");
    writeFileSync(file, JSON.stringify({ ...pending, expiresAt: new Date(NOW - HOUR).toISOString() }));
    assert.ok((await divya.get("/shops/glow-salon/handover")).plain.includes(w.expired));
    const second = await divya.post("/shops/glow-salon/handover", { to: "kiran", reason: "stopped_serving" }, "/shops/glow-salon/handover");
    assert.ok(codeOf(second.plain), "an expired request does not block a new one");
    await divya.post("/shops/glow-salon/handover/cancel", {}, "/shops/glow-salon/handover");
    assert.ok(!(await divya.get("/shops/glow-salon/handover")).plain.includes(w.askTitle));
    assert.ok(!readdirSync(join(b.dir, "panel", "data")).includes("handover") || readdirSync(join(b.dir, "panel", "data", "handover")).length === 0);
  } finally { await b.close(); }
});

test("a partner who does not serve the shop cannot see, ask for or cancel its move; the keys the shop was given stay where they are and no key is in what the move writes", async () => {
  const { b, divya, meera, kiran } = await setUp();
  try {
    mkdirSync(join(b.dir, "secrets-inbox", "glow-salon"), { recursive: true });
    writeFileSync(join(b.dir, "secrets-inbox", "glow-salon", "razorpay_key"), "rzp_test_SENTINELKEYID:SENTINELSECRET99");
    for (const other of [meera, kiran]) {
      assert.equal((await other.get("/shops/glow-salon/handover")).status, 404);
      assert.equal((await other.post("/shops/glow-salon/handover", { to: "kiran", reason: "owner_request" }, "/shops")).status, 404);
      assert.equal((await other.post("/shops/glow-salon/handover/cancel", {}, "/shops")).status, 404);
    }
    const code = codeOf((await divya.post("/shops/glow-salon/handover", { to: "meera", reason: "owner_request" }, "/shops/glow-salon/handover")).plain);
    writeRecord(b, "glow-salon", [agreed(b, "glow-salon", code, NOW + HOUR)]);
    await meera.get("/shops");
    const written = readFileSync(join(b.dir, "shops", "glow-salon", "assignment.json"), "utf8");
    assert.ok(!/SENTINEL|rzp_/u.test(written));
    assert.equal(readFileSync(join(b.dir, "secrets-inbox", "glow-salon", "razorpay_key"), "utf8"), "rzp_test_SENTINELKEYID:SENTINELSECRET99", "nothing touched the shop's keys");
  } finally { await b.close(); }
});

test("after a move the owner's monthly report names the new person: the deployer reads assignment.json first", async () => {
  const { b, divya, meera } = await setUp();
  try {
    assert.equal(readShop(b.dir, "glow-salon").preparedBy, "DIVYA, local partner");
    const code = codeOf((await divya.post("/shops/glow-salon/handover", { to: "meera", reason: "stopped_serving" }, "/shops/glow-salon/handover")).plain);
    writeRecord(b, "glow-salon", [agreed(b, "glow-salon", code, NOW + HOUR)]);
    await meera.get("/shops");
    const after = readShop(b.dir, "glow-salon");
    assert.deepEqual([after.preparedBy, after.preparedBySource], ["MEERA, local partner", "assignment.json"]);
    // a report.json written by hand does not keep the old name on the owner's report
    writeFileSync(join(b.dir, "shops", "glow-salon", "report.json"), JSON.stringify({ schema: 1, preparedBy: "Divya, Kochi partner" }));
    assert.equal(readShop(b.dir, "glow-salon").preparedBy, "MEERA, local partner");
  } finally { await b.close(); }
});

test("the page reads in all four languages and the code is shown as given", async () => {
  const { b, divya } = await setUp();
  try {
    const code = codeOf((await divya.post("/shops/glow-salon/handover", { to: "meera", reason: "owner_request" }, "/shops/glow-salon/handover")).plain);
    for (const l of ["hi", "ml", "kn"] as const) {
      await divya.get(`/lang/${l}?next=/shops`);
      const page = (await divya.get("/shops/glow-salon/handover")).plain;
      assert.ok(page.includes(WORDS[l].handover.waiting("MEERA")), l);
      assert.ok(!page.includes(code), "the code is shown once and not again");
    }
  } finally { await b.close(); }
});
