// Writes go/internal/bookings/testdata/*.json: what the TypeScript Bookings functions answer for the cases the unit tests use, so the Go Bookings runtime's unit tests (wave 2) are
// proved equal on the SAME inputs, and the TypeScript unit tests can then be deleted with the TypeScript runtime (decision 61). Run from the repository root:
//   node go/scripts/gen_bookings_vectors.ts            (add --check to only compare with the committed files; templates/commerce/listings/contract/words-fresh.test.ts calls `staleFiles`)
// One file per area; each case is {name, input, output}, or for the parser the phrase and what was read. Nothing here is typed twice: phrases are TAKEN from the unit tests'
// own source (parser.test.ts's parse("...") calls and crash-test/says.ts), the rest are the grids the unit tests walk (hours by half hour over a week, the refund limit around its
// boundary, every move between booking states) and the settings the tests change.
//   parser-vectors.json        src/adapters/rule-parser.ts parseIntent                     (test/parser.test.ts, test/language.test.ts's sentences)
//   limits-vectors.json        src/limits.ts (price, hours, no-double-booking, refund limit, stop) and src/booking.ts canMove, reminderSchedule  (test/limits.test.ts, booking.test.ts, capacity.test.ts)
//   guard-spec-vectors.json    src/guard-limits.ts gatewayLimitsSpec and the paise numbers    (test/guard-limits.test.ts)
//   settings-vectors.json      src/settings.ts validateSettings: what is accepted and the plain-words errors for each mutation of the example   (test/settings.test.ts, config.test.ts)
//   runner-vectors.json        modules/runtime/tasks.ts createRunner over the real store: the queue's cases, and /readyz's store reason  (test/runtime.test.ts, server.test.ts)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseIntent } from "../../templates/commerce/bookings/src/adapters/rule-parser.ts";
import { checkNoDoubleBooking, checkNoMessageAfterStop, checkPriceAtOrAboveList, checkRefundLimit, checkWithinHours } from "../../templates/commerce/bookings/src/limits.ts";
import { canMove, reminderSchedule } from "../../templates/commerce/bookings/src/booking.ts";
import type { BookingState } from "../../templates/commerce/bookings/src/booking.ts";
import { gatewayLimitsSpec, paymentNumbers } from "../../templates/commerce/bookings/src/guard-limits.ts";
import { parseSettings, validateSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { SAYS } from "../../templates/commerce/bookings/crash-test/says.ts";
import { zonedToMs } from "../../modules/core/time.ts";
import { createRunner } from "../../modules/runtime/tasks.ts";
import { openStore } from "../../modules/runtime/store.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const BOOKINGS = join(ROOT, "templates", "commerce", "bookings");
export const OUT = join(here, "..", "internal", "bookings", "testdata");
const TZ = "Asia/Kolkata";
const example = JSON.parse(readFileSync(join(BOOKINGS, "settings", "glow-salon.example.json"), "utf8")) as Record<string, any>;
const settings = parseSettings(example);
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === undefined ? null : x)));
const decisionOf = (d: { verdict: string; ruleId: string }) => ({ verdict: d.verdict, ruleId: d.ruleId });

function parserVectors(): unknown {
  const source = readFileSync(join(BOOKINGS, "test", "parser.test.ts"), "utf8");
  const phrases = new Set<string>();
  for (const m of source.matchAll(/parse\("((?:[^"\\]|\\.)*)"\)/gu)) phrases.add(JSON.parse(`"${m[1]}"`) as string);
  for (const l of LANGUAGES) for (const v of Object.values(SAYS[l])) if (typeof v === "string") phrases.add(v);
  const ctx = { services: settings.services, languages: settings.languages };
  return [...phrases].sort().map((text) => ({ name: text, input: text, output: clean(parseIntent(text, ctx)) }));
}

function limitsVectors(): unknown {
  const out: { area: string; name: string; input: unknown; output: unknown }[] = [];
  for (const [list, proposed] of [[450, 449], [450, 450], [450, 451], [250, 0], [900, 300]] as const) out.push({ area: "price", name: `${list} vs ${proposed}`, input: { serviceName: "haircut", listInr: list, proposedInr: proposed }, output: decisionOf(checkPriceAtOrAboveList({ serviceName: "haircut", listInr: list, proposedInr: proposed })) });
  // hours: every half hour of one week (Mon 2 Nov 2026 to Sun 8 Nov), each service, a closed day added once
  for (const service of settings.services) for (let day = 2; day <= 8; day++) for (let m = 0; m < 24 * 60; m += 30) {
    const startMs = zonedToMs({ year: 2026, month: 11, day }, { hour: Math.floor(m / 60), minute: m % 60 }, TZ);
    const closedDays = day === 5 ? ["2026-11-05"] : undefined;
    out.push({ area: "hours", name: `${service.id} 2026-11-${day} ${m}`, input: { service: service.id, startMs, ...(closedDays ? { closedDays } : {}) }, output: decisionOf(checkWithinHours({ settings, service, startMs, ...(closedDays ? { closedDays } : {}) })) });
  }
  // no double booking: the scenarios of test/limits.test.ts and capacity.test.ts, on a grid of overlaps
  const H = 3_600_000, M = 60_000;
  for (const units of [undefined, 1, 2, 3]) for (const buffer of [0, 10]) for (const [os, oe] of [[10, 11], [9, 10], [11, 12], [10.5, 11.5], [8, 9], [12, 13]] as const) for (const count of [1, 2]) for (const tentative of [false, true]) {
    const others = Array.from({ length: count }, (_, i) => ({ start: os * H, end: oe * H, bookingRef: `o${i}`, ...(tentative ? { tentativeUntil: 5 * M } : {}) }));
    const input = { startMs: 10 * H, endMs: 11 * H, bufferMinutes: buffer, ownBookingRef: "me", others, nowMs: 10 * M, ...(units !== undefined ? { units } : {}) };
    out.push({ area: "double", name: `units ${units} buffer ${buffer} other ${os}-${oe} x${count}${tentative ? " tentative" : ""}`, input, output: decisionOf(checkNoDoubleBooking(input)) });
  }
  for (const [resource, others] of [["pump", [{ start: 10 * H, end: 11 * H, bookingRef: "a", resource: "tractor" }]], ["tractor", [{ start: 10 * H, end: 11 * H, bookingRef: "a", resource: "tractor" }]], ["pump", [{ start: 10 * H, end: 11 * H, bookingRef: "foreign" }]]] as const) {
    const input = { startMs: 10 * H, endMs: 11 * H, bufferMinutes: 0, ownBookingRef: "me", others: [...others], nowMs: 0, resource };
    out.push({ area: "double", name: `resource ${resource} ${others[0].bookingRef}`, input, output: decisionOf(checkNoDoubleBooking(input)) });
  }
  for (const limit of [100, 199, 200, 201]) for (const amount of [99, 100, 199, 200, 201, 500]) for (const ownerApproved of [false, true]) for (const inCancellationWindow of [true, false]) {
    const input = { amountInr: amount, limitInr: limit, ownerApproved, inCancellationWindow };
    out.push({ area: "refund", name: `limit ${limit} amount ${amount} approved ${ownerApproved} window ${inCancellationWindow}`, input, output: decisionOf(checkRefundLimit(input)) });
  }
  for (const isReminder of [false, true]) for (const bookingConfirmed of [false, true]) for (const customerOptedOut of [false, true]) {
    const input = { isReminder, bookingConfirmed, customerOptedOut };
    out.push({ area: "stop", name: JSON.stringify(input), input, output: decisionOf(checkNoMessageAfterStop(input)) });
  }
  const states: BookingState[] = ["enquiry", "confirming_details", "awaiting_deposit", "needs_owner", "confirmed", "cancelled", "completed", "expired"];
  for (const from of states) for (const to of states) out.push({ area: "move", name: `${from} to ${to}`, input: { from, to }, output: canMove(from, to) });
  const start = zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 18, minute: 0 }, TZ);
  for (const hoursAhead of [-1, 1, 3, 25, 49, 24 * 10]) out.push({ area: "reminders", name: `now ${hoursAhead}h before`, input: { startMs: start, nowMs: start - hoursAhead * H }, output: clean(reminderSchedule(settings, start, start - hoursAhead * H)) });
  return out;
}

function guardSpecVectors(): unknown {
  const variants: { name: string; patch: Record<string, unknown> }[] = [];
  for (const limit of [50, 100, 199, 200]) variants.push({ name: `refund limit ${limit}`, patch: { cancellation: { windowHours: 24, refundLimitInr: limit } } });
  for (const deposit of [100, 200, 250]) variants.push({ name: `deposit ${deposit}`, patch: { deposit: { amountInr: deposit, holdMinutes: 15 }, cancellation: { windowHours: 24, refundLimitInr: deposit } } });
  return variants.map((v) => {
    const s = parseSettings({ ...example, ...v.patch });
    return { name: v.name, input: v.patch, output: { numbers: clean(paymentNumbers(s)), spec: clean(gatewayLimitsSpec(s, { tenant: "vectors", version: 1, reviewedBy: "vectors" })) } };
  });
}

function settingsVectors(): unknown {
  const mutations: { name: string; mutate: (s: Record<string, any>) => void }[] = [
    { name: "the example as it is", mutate: () => undefined },
    { name: "no name", mutate: (s) => { delete s.name; } },
    { name: "a bad timezone", mutate: (s) => { s.timezone = "Mars/Olympus"; } },
    { name: "no services", mutate: (s) => { s.services = []; } },
    { name: "a service with a fraction of a rupee", mutate: (s) => { s.services[0].priceInr = 450.5; } },
    { name: "a service that lasts 25 hours", mutate: (s) => { s.services[0].durationMinutes = 25 * 60; } },
    { name: "a service that lasts a whole day", mutate: (s) => { s.services[0].durationMinutes = 24 * 60; } },
    { name: "two services with one id", mutate: (s) => { s.services[1].id = s.services[0].id; } },
    { name: "opening hours that close before they open", mutate: (s) => { s.openingHours.mon = { open: "20:00", close: "10:00" }; } },
    { name: "opening hours with a bad time", mutate: (s) => { s.openingHours.tue = { open: "25:00", close: "26:00" }; } },
    { name: "a slot of 0 minutes", mutate: (s) => { s.slotMinutes = 0; } },
    { name: "a deposit above the cheapest price", mutate: (s) => { s.deposit.amountInr = 1000; } },
    { name: "a refund limit above the deposit", mutate: (s) => { s.cancellation.refundLimitInr = 300; } },
    { name: "a language the shop does not speak", mutate: (s) => { s.languages = ["fr"]; } },
    { name: "an owner number that is not a number", mutate: (s) => { s.owner.whatsapp = "not a number"; } },
    { name: "a payment module that does not exist", mutate: (s) => { s.payment = { module: "bitcoin" }; } },
    { name: "UPI without an id", mutate: (s) => { s.payment = { module: "upi", upi: { payee: "Glow Salon" } }; } },
    { name: "UPI on its own list", mutate: (s) => { s.payment = { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }; s.calendar = { module: "own" }; } },
    { name: "two chairs", mutate: (s) => { s.resources = { shop: 2 }; } },
    { name: "a resource that is not listed", mutate: (s) => { s.services[0].resource = "tractor"; } },
    { name: "a resource with no units", mutate: (s) => { s.resources = { shop: 0 }; } },
    { name: "an unknown key", mutate: (s) => { s.colour = "red"; } },
  ];
  return mutations.map((m) => {
    const s = JSON.parse(JSON.stringify(example)) as Record<string, any>;
    m.mutate(s);
    const r = validateSettings(s);
    return { name: m.name, input: s, output: clean(r.ok ? { ok: true } : { ok: false, errors: r.errors }) };
  });
}

/** The queue's cases over the real store (modules/runtime/tasks.ts): each scenario scripts what a step does on each try of each task and records the order of tries and the final rows. */
async function runnerVectors(): Promise<unknown> {
  const out: unknown[] = [];
  const dir = mkdtempSync(join(tmpdir(), "bookings-runner-"));
  const msg = (id: string, text: string) => ({ kind: "message" as const, message: { id, from: "+919811111111", text, timestamp: 1 } });
  async function scenario(name: string, events: ReturnType<typeof msg>[], retryDelaysMs: number[], steps: Record<string, "ok" | "fail">, restartRunning = false) {
    const data = join(dir, name.replace(/\W+/gu, "-"));
    mkdirSync(data, { recursive: true });
    let db = openStore(data);
    const tries: string[] = [];
    db.saveEvents(events, 1000);
    if (restartRunning) { const first = db.nextPending()!; db.startAttempt(first.id); db.close(); db = openStore(data); }
    const runner = createRunner({ db, retryDelaysMs, log: () => undefined, now: () => 1000, step: async (event, taskId) => {
      const id = taskId ?? "";
      tries.push(id);
      if (steps[id] === "fail") throw new Error("this one always fails");
      if (taskId) db.commitStep({ taskId, snapshot: "{}", entries: [], nowMs: 1000 });
    } });
    runner.kick();
    await runner.idle();
    const counts = db.taskCounts();
    const rows = (db as unknown as { loadTasks?: () => unknown }).loadTasks?.();
    db.close();
    out.push({ name, input: { events: events.map((e) => e.message.id), retryDelaysMs, steps, restartRunning }, output: { tries, counts, ...(rows ? { rows: clean(rows) } : {}) } });
  }
  await scenario("a failing step is tried again, then failed, and the queue moves on", [msg("m1", "poison"), msg("m2", "hello")], [1, 1], { "message:m1": "fail" });
  await scenario("tasks run one at a time in the order they arrived", [msg("m1", "a"), msg("m2", "b"), msg("m3", "c")], [1], {});
  await scenario("a task whose try was started when the process died is tried again (the try was counted first), and the queue finishes", [msg("m1", "a"), msg("m2", "b")], [1, 1], {}, true);
  await scenario("a task that always fails with no retries is failed after one try", [msg("m1", "a")], [], { "message:m1": "fail" });
  // /readyz: the store's own answer when it cannot be read (modules/runtime/core.ts ready())
  const data = join(dir, "ready"); mkdirSync(data, { recursive: true });
  const db = openStore(data);
  let before: string; try { db.ping(); before = "ok"; } catch (e) { before = (e as Error).message; }
  db.close();
  let after: string; try { db.ping(); after = "ok"; } catch (e) { after = (e as Error).message; }
  out.push({ name: "readyz: the store cannot be read", input: { closed: true }, output: { whileOpen: before, whenClosed: after === "ok" ? "ok" : "error", reasonStartsWith: "The store cannot be read: ", status: 503 } });
  rmSync(dir, { recursive: true, force: true });
  return out;
}

export async function generate(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const put = (name: string, v: unknown) => files.set(name, JSON.stringify(v, null, 1) + "\n");
  put("parser-vectors.json", parserVectors());
  put("limits-vectors.json", limitsVectors());
  put("guard-spec-vectors.json", guardSpecVectors());
  put("settings-vectors.json", settingsVectors());
  put("runner-vectors.json", await runnerVectors());
  return files;
}

/** The files in `dir` that differ from a fresh render (or are missing). */
export async function staleFiles(dir: string): Promise<string[]> {
  const stale: string[] = [];
  for (const [name, text] of await generate()) if (!existsSync(join(dir, name)) || readFileSync(join(dir, name), "utf8") !== text) stale.push(name);
  return stale;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const stale = await staleFiles(OUT);
    if (stale.length > 0) { console.error(`out of date: ${stale.join(", ")}  (run: node go/scripts/gen_bookings_vectors.ts)`); process.exit(1); }
    console.log("the Bookings vectors are fresh");
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of await generate()) writeFileSync(join(OUT, name), text);
    console.log(`wrote ${readdirSync(OUT).length} files in ${OUT}`);
  }
}
