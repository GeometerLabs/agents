// The three papers (B28 statement, B35 record of one case, B36 identity paper) on a real Bookings record: the busy month the report tests use, on stand-in
// services and test money. Run for real through scripts/papers.ts as well.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { headOf } from "../../../../modules/record/ledger.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { generateKeyFiles } from "../../../../modules/report/keys.ts";
import { envelopeFile, verifyEnvelopeText } from "../../../../modules/report/sign.ts";
import { buildDisputeRecord, disputePage } from "../../../../modules/papers/dispute.ts";
import { identityPage, newAgentId, sealIdentity } from "../../../../modules/papers/identity.ts";
import { buildStatement, sealStatement, statementPage } from "../../../../modules/papers/statement.ts";
import { buildGoLiveCertificate } from "../report/certificate.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { BOOKINGS_PAPERS, bookingCase, fromGoLive, limitFacts } from "../report/papers.ts";
import { buildMonthlyReport } from "../report/data.ts";

const month = await runBusyMonth();
const w = month.world;
const entries = w.record.entries();
const bookings = [...w.store.bookings.values()];
const cases = bookings.map((b) => bookingCase(b, w.settings));
const shop = { name: w.settings.name, timeZone: w.settings.timezone };
const refunded = entries.find((e) => e.action === "refund" && e.outcome === "confirmed")!;
const refundedBooking = bookings.find((b) => b.id === refunded.booking)!;
const customer = refundedBooking.customer;

test("a customer's statement: their own deposits and refunds, each once, in their language; no other customer's booking, payment or number", () => {
  const s = buildStatement({ template: BOOKINGS_PAPERS, shop, number: customer, entries, cases, now: at(12, 2, 10), tenant: "glow-salon" });
  const mine = new Set(bookings.filter((b) => b.customer === customer).map((b) => b.id));
  assert.deepEqual(s.person.cases, [...mine].sort());
  assert.equal(s.language, bookings.filter((b) => b.customer === customer).at(-1)!.language);
  const deposits = new Map(entries.filter((e) => e.action === "record_deposit" && e.outcome === "confirmed" && mine.has(e.booking!)).map((e) => [e.refs.paymentId, Number(e.refs.amountPaise)]));
  const refunds = new Map(entries.filter((e) => e.action === "refund" && e.outcome === "confirmed" && mine.has(e.booking!)).map((e) => [e.refs.refundId, Number(e.refs.amountPaise)]));
  assert.equal(s.totals.paidPaise, [...deposits.values()].reduce((a, b) => a + b, 0));
  assert.equal(s.totals.refundedPaise, [...refunds.values()].reduce((a, b) => a + b, 0));
  assert.ok(s.totals.refundedPaise > 0);
  const text = JSON.stringify(s);
  for (const b of bookings.filter((x) => x.customer !== customer)) assert.equal(text.includes(`"${b.id}"`) || text.includes(b.customer), false, `${b.id} is someone else's`);
  for (const e of entries.filter((x) => x.refs.paymentId && !mine.has(x.booking ?? ""))) assert.equal(text.includes(e.refs.paymentId), false);
  assert.deepEqual(s.anchor, headOf(entries, "glow-salon"));
});

test("the monthly report's anchor slot holds the record's head when a tenant is named, and stays null (old bytes) when not", () => {
  const { from, to } = { from: at(11, 1, 0), to: at(12, 1, 0) };
  const base = { settings: w.settings, entries, bookings, from, to, source: "stand-in" as const, madeAt: at(12, 2, 10) };
  assert.equal(buildMonthlyReport(base).anchor, null);
  assert.deepEqual(buildMonthlyReport({ ...base, ledger: { tenant: "glow-salon" } }).anchor, headOf(entries, "glow-salon"));
});

test("the record of the refunded booking, in every language: the services' ids, the owner's part, what was not checked, and no banned word", () => {
  for (const language of LANGUAGES) {
    const r = buildDisputeRecord({ template: BOOKINGS_PAPERS, shop, case: bookingCase(refundedBooking, w.settings), entries, language, now: at(12, 2, 10), tenant: "glow-salon" });
    assert.ok(r.rows.length > 3);
    assert.ok(r.rows.some((x) => x.services.some((s) => s.includes(refunded.refs.refundId))), "the refund's id as the payments service showed it");
    assert.ok(r.rows.every((x) => x.ledgerHash?.startsWith("sha256:")));
    assert.ok(r.rows.every((x) => entries[x.seq - 1].booking === refundedBooking.id));
    const page = disputePage({ format: "geometer-document/1", document: r, digest: "sha256:" + "0".repeat(64), code: "0000-0000", signature: null });
    assert.deepEqual(bannedIn(page, language), [], language);
  }
});

test("the identity paper from the shop's go-live certificate: held N of M, the limits in plain words, and no customer's number", () => {
  const cert = buildGoLiveCertificate({ settings: w.settings, handCheck: { held: 38, total: 38, checks: 120, failedTitles: [] }, issuedAt: at(10, 27, 10) });
  const { limits, checks } = fromGoLive(cert, "hi");
  assert.ok(limits.length >= 4);
  assert.equal(checks.held, 38);
  const { full, public: pub } = sealIdentity({ template: BOOKINGS_PAPERS, agentId: newAgentId(new Uint8Array(13)), language: "hi", operator: { name: "Divya", role: "partner" }, shop, limits, checks, entries,
    history: [{ at: "2026-10-27T05:00:00.000Z", by: null, settings: w.settings }, { at: "2026-11-10T05:00:00.000Z", by: { name: "Divya", role: "partner" }, settings: { ...w.settings, cancellation: { ...w.settings.cancellation, refundLimitInr: w.settings.cancellation.refundLimitInr + 300 } } }],
    limitFacts, tenant: "glow-salon", now: at(12, 2, 10) });
  const changes = (full.document.limitChanges as { changes: { by: string }[] }).changes;
  assert.equal(changes.length, 1);
  assert.match(changes[0].by, /Divya/);
  for (const env of [full, pub]) {
    const text = envelopeFile(env) + identityPage(env);
    for (const b of bookings) assert.equal(text.includes(b.customer), false);
    assert.deepEqual(bannedIn(text, "hi"), []);
  }
});

test("scripts/papers.ts writes the statement, the record of one case, the identity paper and the evidence pack into --out only, signed, and they verify", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geometer-papers-"));
  writeFileSync(join(dir, "record.json"), JSON.stringify(entries));
  writeFileSync(join(dir, "bookings.json"), JSON.stringify(bookings));
  copyFileSync(fileURLToPath(new URL("../settings/glow-salon.example.json", import.meta.url)), join(dir, "settings.json"));
  const cert = buildGoLiveCertificate({ settings: w.settings, handCheck: { held: 38, total: 38, checks: 120, failedTitles: [] }, issuedAt: at(10, 27, 10) });
  const { privateKey } = generateKeyPairSync("ed25519");
  const { seal } = await import("../../../../modules/report/sign.ts");
  writeFileSync(join(dir, "go-live.json"), envelopeFile(seal(cert, privateKey)));
  const keys = generateKeyFiles(join(dir, "keys"));
  const common = ["--settings", join(dir, "settings.json"), "--record", join(dir, "record.json"), "--key", keys.privateKeyPath, "--tenant", "glow-salon", "--now", "2026-12-02T10:00:00+05:30"];
  const run = (...args: string[]) => spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/papers.ts", import.meta.url)), ...args], { encoding: "utf8" });
  const out = join(dir, "out");
  for (const args of [["statement", "--number", customer, "--cases", join(dir, "bookings.json")], ["dispute", "--case", refundedBooking.id, "--cases", join(dir, "bookings.json")],
    ["identity", "--agent-id", newAgentId(new Uint8Array(13)), "--operator", "Divya", "--role", "partner", "--go-live", join(dir, "go-live.json")], ["ledger"]]) {
    const r = run(...args, ...common, "--out", out);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const files = readdirSync(out).sort();
  for (const f of ["statement.json", `case-${refundedBooking.id}.json`, "identity.json", "identity-public.json", "pack.json", "anchor.json"]) assert.ok(files.includes(f), `${f} in ${files}`);
  for (const f of files.filter((x) => x.endsWith(".json") && !["pack.json", "anchor.json"].includes(x))) {
    const v = verifyEnvelopeText(readFileSync(join(out, f), "utf8"), [keys.keyId]);
    assert.equal(v.unchanged && v.trusted, true, `${f}: ${v.summary}`);
  }
  const bad = run("dispute", "--case", "b-999", "--cases", join(dir, "bookings.json"), ...common, "--out", join(dir, "out2"));
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /There is no case b-999/);
  assert.ok(statementPage(sealStatement({ template: BOOKINGS_PAPERS, shop, number: customer, entries, cases, now: at(12, 2, 10) })).includes("<!doctype html>"));
});
