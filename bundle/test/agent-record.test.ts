// The record of an agent someone else wrote, from what its Guards decided and what the services hold. The Guards' answers here are the REAL ones: test/fixtures/own-agent-facts.json
// was captured from the built geo-guard binary (production profile, the bundle's own specs) in front of the stand-ins, then the services' state read as the reading agent reads it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAgent } from "../agent/deploy.ts";
import { agentFromFlags } from "../agent/folder.ts";
import { collectFacts } from "../agent/facts.ts";
import type { Facts } from "../agent/facts.ts";
import { GRACE_MS, emptyRecord, foldFacts, waitingForOwner } from "../agent/record.ts";
import { recordAgent, skipOf } from "../agent/records.ts";
import { writeAgentReport } from "../agent/report.ts";
import { PHONE_NUMBER_ID, CALENDAR_ID } from "./helpers.ts";
import { world } from "./world.ts";

const facts = JSON.parse(readFileSync(new URL("./fixtures/own-agent-facts.json", import.meta.url), "utf8")) as Facts;
const settings = agentFromFlags("demo", { "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID }, () => "", new Date("2026-11-05T00:00:00Z")).settings;
const labelKey = Buffer.alloc(32, 9);
const options = (now = Date.parse(facts.at)) => ({ settings, agentId: "agent-demo", relayId: "relay-demo", now, labelKey });
const tally = (entries: readonly { action: string; outcome: string }[]) => Object.fromEntries(Object.entries(entries.reduce((m: Record<string, number>, e) => { const k = `${e.action}/${e.outcome}`; m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort());

test("every call the agent made is in the record as Guard decided it, 'done' is what the service holds, and the reading agent's own reads are not the agent's record", () => {
  const { state } = foldFacts(emptyRecord(), facts, options());
  assert.deepEqual(tally(state.entries), {
    "confirm_booking/blocked": 1,     // an event on another calendar: Guard refused it
    "confirm_booking/confirmed": 1,   // the calendar holds the event
    "create_deposit_link/blocked": 1, // a link for the wrong amount: refused
    "create_deposit_link/confirmed": 1,
    "owner_decision/confirmed": 1,
    "record_deposit/confirmed": 1,    // Razorpay's link shows the payment
    "refund/blocked": 1,              // one paisa above the deposit: refused, and nobody was asked
    "refund/confirmed": 1,            // Razorpay holds the refund
    "refund/held_for_owner": 2,       // the first hold, and the repeat after the refund had been made (a new approval)
    "send_message/confirmed": 1,
  });
  // the reading agent's reads, and its refused try at a refund, are not in it
  assert.ok(!state.entries.some((e) => e.notes.includes("record-demo")));
  const by = (action: string, outcome: string) => state.entries.filter((e) => e.action === action && e.outcome === outcome);
  assert.deepEqual(by("refund", "confirmed")[0].refs, { paymentId: "pay_2", amountPaise: "20000", refundId: "rfnd_5", approval: by("refund", "held_for_owner")[0].refs.approval }, "the refund id is the service's, and it is the approval the owner gave that released it");
  assert.equal(by("refund", "blocked")[0].decisions[0].ruleId, "refund-limit");
  assert.match(by("refund", "blocked")[0].decisions[0].reason, /^refund-at-most-deposit: amount 20001 is above the highest allowed value, 20000$/u);
  assert.deepEqual(by("record_deposit", "confirmed")[0].refs, { paymentId: "pay_2", linkId: "plink_1", amountPaise: "20000" });
  assert.equal(by("owner_decision", "confirmed")[0].refs.command, "approve");
  assert.equal(by("confirm_booking", "confirmed")[0].booking, "ev_1");
  // no customer's number is anywhere in it
  assert.ok(!JSON.stringify(state.entries).includes("919811111111"));
  assert.deepEqual(state.entries.map((e) => e.seq), state.entries.map((_, i) => i + 1));
});

test("the record is only added to: the same facts again add nothing, a thing the service shows late is added after it, and an unconfirmed entry waits out a grace period first", () => {
  const first = foldFacts(emptyRecord(), facts, options());
  const again = foldFacts(first.state, facts, options());
  assert.equal(again.added.length, 0);
  assert.deepEqual(again.state.entries, first.state.entries);

  // Razorpay does not (yet) show the refund the agent made: before the grace period nothing is written for it
  const behind: Facts = { ...facts, service: { ...facts.service, refunds: { pay_2: [] } } };
  const early = foldFacts(emptyRecord(), behind, options());
  assert.equal(early.state.entries.filter((e) => e.action === "refund" && e.outcome === "confirmed").length, 0);
  assert.equal(early.state.entries.filter((e) => e.action === "refund" && e.outcome === "unconfirmed").length, 0, "not written down as unconfirmed yet");
  // after it, it is: the service does not hold it, so it is not "done"
  const late = foldFacts(early.state, behind, options(Date.parse(facts.at) + GRACE_MS + 60_000));
  const unconfirmed = late.state.entries.filter((e) => e.action === "refund" && e.outcome === "unconfirmed");
  assert.equal(unconfirmed.length, 1);
  assert.deepEqual(late.state.entries.filter((e) => e.action === "refund" && e.outcome === "confirmed"), []);
  // and when the service shows it, a confirmed entry follows (the report marks the earlier one 'settled later')
  const caught = foldFacts(late.state, facts, options(Date.parse(facts.at) + GRACE_MS + 120_000));
  assert.equal(caught.added.length, 1);
  assert.deepEqual([caught.added[0].action, caught.added[0].outcome, caught.added[0].refs.refundId], ["refund", "confirmed", "rfnd_5"]);
  assert.equal(caught.added[0].seq, late.state.entries.length + 1);
  // a service that could not be asked is not the same as one that says no: neither confirms
  const unreadable: Facts = { ...facts, service: { links: { "b-1": null }, refunds: { pay_2: null }, events: null } };
  const none = foldFacts(emptyRecord(), unreadable, options(Date.parse(facts.at) + GRACE_MS + 60_000)).state.entries;
  for (const action of ["create_deposit_link", "refund", "confirm_booking"]) assert.equal(none.filter((e) => e.action === action && e.outcome === "confirmed").length, 0, `${action} is not confirmed by a service that could not be asked`);
  assert.equal(none.filter((e) => e.action === "record_deposit").length, 0, "no payment is shown if the link could not be read");
});

test("a gap is said, not hidden: when Guard's list of its 500 most recent decisions starts after the newest the record had read, calls fell out unread", () => {
  const first = foldFacts(emptyRecord(), facts, options());
  const newest = first.state.marks!.razorpay;
  assert.equal(newest, Math.max(...facts.guards.razorpay!.decisions.map((d) => Number(d.at_ms))));
  assert.deepEqual(first.gaps, [], "nothing missed on the first pass, or while the list reaches back far enough");
  // a later pass: the list is full and its oldest entry is newer than the last one read
  const later: Facts = JSON.parse(JSON.stringify(facts));
  later.guards.razorpay = { ...later.guards.razorpay!, decisions: later.guards.razorpay!.decisions.map((d, i) => ({ ...d, id: `later-${i}`, at_ms: String(newest + 10_000 + i) })), windowFull: true, oldestAtMs: newest + 10_000, newestAtMs: newest + 10_020 };
  const gapped = foldFacts(first.state, later, options(newest + 600_000));
  assert.equal(gapped.gaps.length, 1);
  assert.match(gapped.gaps[0], /^razorpay's Guard lists only its \d+ most recent decisions, and the oldest it showed .* is newer than the last this record had read .*missing from the record\.$/u);
  const entry = gapped.state.entries.find((e) => (e.action as string) === "record_gap")!;
  assert.equal(entry.outcome, "unconfirmed", "the report lists it among what could not be confirmed");
  // a full list that still reaches back to what was read is no gap
  const reaches: Facts = { ...later, guards: { ...later.guards, razorpay: { ...later.guards.razorpay!, oldestAtMs: newest - 1000 } } };
  assert.deepEqual(foldFacts(first.state, reaches, options(newest + 600_000)).gaps, []);
});

test("a reference the agent chose that looks like a phone number reaches neither the record nor the exports; it is kept as a short hash", () => {
  const phoneRef = "+91 98111 11111";
  const edited: Facts = JSON.parse(JSON.stringify(facts).replaceAll("b-1", phoneRef));
  const { state } = foldFacts(emptyRecord(), edited, options());
  const text = JSON.stringify(state.entries);
  assert.ok(!text.includes(phoneRef) && !text.includes("98111 11111"), "no number in the record");
  const hashed = state.entries.find((e) => e.action === "create_deposit_link" && e.outcome === "confirmed")!;
  assert.match(hashed.booking!, /^b-[0-9a-f]{12}$/u);
  assert.equal(hashed.refs.referenceId, hashed.booking);
  assert.ok(state.entries.filter((e) => e.booking === hashed.booking).length >= 3, "the same label everywhere, so the report still joins the link, the deposit, the hold and the refund");
  assert.deepEqual(skipOf(state).paid, [hashed.booking], "and the skip list uses the same label");
});

test("settled things are not asked of the services again, a calendar is read around the times booked (not its first page), and a changed event is asked for by its id", async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    const u = new URL(String(url)); const kind = u.hostname.split(".")[0];
    if (u.hostname.endsWith(".admin")) {
      const g = facts.guards[kind as "razorpay"]!;
      if (u.pathname === "/admin/decisions") return Response.json({ decisions: g.decisions });
      if (u.pathname === "/admin/intents") return Response.json({ intents: g.intents });
      if (u.pathname === "/admin/approvals") return Response.json({ approvals: g.approvals });
      return Response.json({ counts: g.counts });
    }
    seen.push(`${u.pathname}${u.search}`);
    if (u.pathname.endsWith("/events")) return Response.json({ items: facts.service.events!.map((e) => ({ id: e.id, summary: e.summary, start: { dateTime: e.start }, status: e.status })) });
    if (/\/events\/ev_9$/u.test(u.pathname)) return Response.json({ error: "gone" }, { status: 404 });
    return Response.json({});
  }) as typeof fetch;
  const cfg = { agentId: "agent-demo", relayId: "relay-demo", recordToken: "gg_reader", labelKey, calendarId: "c@group.calendar.google.com", guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, adminUrl: `http://${kind}.admin`, adminToken: "x", agentUrl: `http://${kind}.agent` })) };
  const now = new Date(facts.at);
  // nothing settled yet: the link, the payment's refunds and the calendar are all asked about
  const all = await collectFacts(cfg, now, fetchFn);
  assert.ok(seen.some((s) => s.startsWith("/v1/payment_links?reference_id=b-1")) && seen.some((s) => s.endsWith("/refunds")));
  const range = seen.find((s) => s.includes("/events?"))!;
  assert.match(range, /timeMin=.*&timeMax=.*&singleEvents=true&maxResults=250/u, "a window around the booked times, with recurring events opened up, not the first page of the whole calendar");
  assert.deepEqual(all.guards.razorpay!.windowFull, false);
  // the record has settled it all: the deployer passes that on, and the services are not asked
  seen.length = 0;
  const { state } = foldFacts(emptyRecord(), facts, options());
  const quiet = await collectFacts(cfg, now, fetchFn, skipOf(state));
  assert.deepEqual(seen, [], "nothing asked");
  assert.deepEqual(quiet.service.links, {});
  // a link nobody has paid yet, made a few hours ago, is asked about again; one made two days ago is not
  const unpaid = { settled: skipOf(state).settled, paid: [] as string[] };
  seen.length = 0; await collectFacts(cfg, now, fetchFn, unpaid);
  assert.deepEqual(seen.filter((s) => s.includes("reference_id")).length, 1);
  seen.length = 0; await collectFacts(cfg, new Date(now.getTime() + 2 * 86_400_000), fetchFn, unpaid);
  assert.deepEqual(seen.filter((s) => s.includes("reference_id")), []);
  // an event the agent changed or deleted is asked for by its id
  const changed: Facts = JSON.parse(JSON.stringify(facts));
  changed.guards.calendar!.decisions.push({ ...changed.guards.calendar!.decisions[0], id: "gd-del", operation: "delete", outcome: "allow", dispatched: true, principal: { workload: "agent-demo" }, arguments: { calendarId: ["str", "c"], eventId: ["str", "ev_9"] } });
  const fetchChanged = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    if (u.hostname.endsWith(".admin")) { const g = changed.guards[u.hostname.split(".")[0] as "razorpay"]!; return Response.json(u.pathname === "/admin/decisions" ? { decisions: g.decisions } : u.pathname === "/admin/intents" ? { intents: g.intents } : u.pathname === "/admin/approvals" ? { approvals: g.approvals } : { counts: g.counts }); }
    return fetchFn(url);
  }) as typeof fetch;
  const gone = await collectFacts(cfg, now, fetchChanged, { settled: skipOf(state).settled, paid: skipOf(state).paid });
  assert.deepEqual(gone.service.eventsById, { ev_9: "gone" });
  // and the delete is confirmed by the calendar saying there is no such event, not by the agent
  const cancelled = foldFacts(emptyRecord(), { ...changed, service: { ...changed.service, eventsById: gone.service.eventsById } }, options()).state.entries.filter((e) => e.action === "cancel_booking");
  assert.deepEqual(cancelled.map((e) => [e.booking, e.outcome]), [["ev_9", "confirmed"]]);
  const notAsked = foldFacts(emptyRecord(), { ...changed, service: { ...changed.service, eventsById: {} } }, options(Date.parse(facts.at) + GRACE_MS + 60_000)).state.entries.filter((e) => e.action === "cancel_booking");
  assert.deepEqual(notAsked.map((e) => e.outcome), ["unconfirmed"], "a delete the calendar was not asked about is not confirmed");
});

test("a provider answer that is not 2xx is 'failed', never 'confirmed', even if the call went out", () => {
  const edited: Facts = JSON.parse(JSON.stringify(facts));
  for (const d of edited.guards.razorpay!.decisions) if (d.operation === "create_link" && d.outcome === "allow") d.reasons = ["every applicable rule allows the call", "dispatched once; the provider answered 502"];
  const { state } = foldFacts(emptyRecord(), edited, options());
  assert.equal(state.entries.filter((e) => e.action === "create_deposit_link" && e.outcome === "failed").length, 1);
});

test("a refund Guard is holding is 'waiting for the owner' in the report's bookings file, and one that has run out is not", () => {
  const waiting = waitingForOwner(facts, Date.parse(facts.at)) as { pending: unknown[] }[];
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].pending.length, 1);
  assert.equal(waitingForOwner(facts, Date.parse(facts.at) + 3 * 86_400_000).length, 0);
});

test("the report counts it the way it counts a template's record: the deposit, the refund the owner approved, what was refused; and it says which agent it is of", async () => {
  const w = world({}); const out = mkdtempSync(join(tmpdir(), "geo-agent-report-"));
  try {
    addAgent(w.root, "demo", { "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID }, () => "", new Date("2026-11-05T00:00:00Z"));
    const ctx = { ...w.ctx, now: () => new Date(facts.at) };
    const r = await recordAgent(ctx, "demo", facts);
    assert.deepEqual([r.added, r.total], [11, 11]);
    assert.equal((await recordAgent(ctx, "demo", facts)).added, 0, "a second pass adds nothing");
    assert.ok(existsSync(join(w.paths.exportsOf("demo"), "record.json")) && existsSync(join(w.paths.exportsOf("demo"), "bookings.json")));
    assert.ok(!readFileSync(join(w.paths.exportsOf("demo"), "record.json"), "utf8").includes("+919811111111"));
    const written = writeAgentReport(w.root, "demo", { month: "2026-11", out, language: "en", source: "stand-in", now: Date.parse(facts.at) });
    const report = JSON.parse(readFileSync(join(out, "report-2026-11.json"), "utf8")).document;
    assert.equal(report.pathway.name, "own-agent");
    assert.deepEqual(report.money.deposits, { count: 1, paise: 20000 });
    assert.deepEqual(report.money.refunds.count, 1);
    assert.equal(report.money.refunds.paise, 20000);
    assert.deepEqual(report.owner, { asked: 1, approved: 1, denied: 0, retried: 0 });
    assert.equal(report.bookings.made, 1);
    assert.equal(report.stopped.byRule["refund-limit"], 1, "the refund above the deposit that Guard refused");
    assert.equal(report.atReportTime.waitingForOwner, 1, "the repeat refund Guard is holding");
    assert.ok(report.notTested.includes("no-go-live-certificate"), "no crash test has run on this agent, and the report says so");
    assert.ok(written.files.some((f) => f.endsWith("certificate-2026-11.json")));
    assert.match(readFileSync(join(out, "report-2026-11-en.html"), "utf8"), /own-agent/u);
  } finally { w.done(); rmSync(out, { recursive: true, force: true }); }
});
