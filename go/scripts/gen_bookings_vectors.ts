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
//   templates-vectors.json     src/language (templates.ts render, meta-templates.ts bodies and parameters, check.ts checkMessage, interactive.ts lists and buttons)  (test/language.test.ts, meta-templates.test.ts, buttons.test.ts)
//   coerce-vectors.json        src/adapters (model.ts coerceIntent over what a model may say, reading.ts rulesAreSure, model-prompt.ts the prompt and schema)   (test/parser.test.ts, understanding.test.ts, model-llm.test.ts)
//   ondc-vectors.json          src/ondc.ts through modules/ondc: the catalogue and every booking state at every stage, for two shops   (test/ondc.test.ts)
//   scenarios-vectors.json     the agent run on scripted conversations with the in-memory stand-ins: what each message answers and what the record writes   (test/booking, adapters, record-decisions, language)
//   report-vectors.json        templates/commerce/bookings/report: the busy month's report data from the record, the owner's lines, the printable page, the WhatsApp message and the monthly certificate, in every language  (test/report-*.test.ts)
//   golive-vectors.json        the go-live certificate (report/certificate.ts), its signature and the checks of a signed file (modules/report/sign.ts, with a fixed Ed25519 key: its signatures are deterministic), and how the report reads a certificate (report/go-live.ts)  (test/report-go-live, -certificates, -sign)
//   router-vectors.json        the three-step router as Bookings uses it (src/adapters/understanding.ts): rules, then a decision model, then a language model, over scripted answers  (test/understanding.test.ts, step-breaker.test.ts)
//   standin-faults-vectors.json  the in-memory calendar, payments and messaging (what `fakes` mode must do in Go): the happy-path answers and every planned fault (op, mode, times, after)  (test/adapters.test.ts)
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
import { TEMPLATES, render } from "../../templates/commerce/bookings/src/language/templates.ts";
import type { TemplateId } from "../../templates/commerce/bookings/src/language/templates.ts";
import { META_TEMPLATES, exampleFacts, metaSubmissions, parametersFor } from "../../templates/commerce/bookings/src/language/meta-templates.ts";
import { checkMessage } from "../../templates/commerce/bookings/src/language/check.ts";
import { LABELS, serviceList, slotList, intentFromReply, buttonsFor } from "../../templates/commerce/bookings/src/language/interactive.ts";
import { fillBody, metaBody } from "../../modules/language/meta-templates.ts";
import { coerceIntent } from "../../templates/commerce/bookings/src/adapters/model.ts";
import { rulesAreSure } from "../../templates/commerce/bookings/src/adapters/reading.ts";
import { intentSchema, systemPrompt } from "../../templates/commerce/bookings/src/adapters/model-prompt.ts";
import { catalogueOf, bookingIn } from "../../templates/commerce/bookings/src/ondc.ts";
import { services as ondcServices } from "../../modules/ondc/index.ts";
import { statesOf, statusOf } from "../../modules/ondc/states.ts";
import { SAMPLE_CALLER } from "../../modules/ondc/verify.ts";
import { createStore, newDraft, register } from "../../templates/commerce/bookings/src/booking.ts";
import { createWorld, glowSalon } from "../../templates/commerce/bookings/src/harness.ts";
import { buildMonthlyReport } from "../../templates/commerce/bookings/report/data.ts";
import { at, runBusyMonth } from "../../templates/commerce/bookings/report/example-month.ts";
import { reportPage } from "../../templates/commerce/bookings/report/html.ts";
import { ownerText } from "../../templates/commerce/bookings/report/text.ts";
import { monthlyReportMessage, reportSubmissions } from "../../templates/commerce/bookings/report/whatsapp.ts";
import { buildMonthlyCertificate, monthlyCertificateText } from "../../templates/commerce/bookings/report/certificate.ts";
import { monthRange } from "../../modules/report/months.ts";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { buildGoLiveCertificate, goLiveSection, goLiveText, limitLines, summariseHandCheck } from "../../templates/commerce/bookings/report/certificate.ts";
import { readGoLiveCertificate } from "../../templates/commerce/bookings/report/go-live.ts";
import { envelopeFile, keyIdOf, publicKeyHex, verifyEnvelopeText } from "../../modules/report/sign.ts";
import { createRouter } from "../../templates/commerce/bookings/src/adapters/understanding.ts";
import { createModelParser } from "../../templates/commerce/bookings/src/adapters/model-llm.ts";
import { createSystemOne } from "../../modules/understanding/system-one.ts";
import { systemOneFetch, systemOneStandin } from "../../modules/standins/system-one.ts";
import type { Decider } from "../../modules/standins/system-one.ts";
import { createFakeCalendar } from "../../templates/commerce/bookings/src/adapters/calendar.ts";
import { createFakePayments } from "../../modules/payments/payments.ts";
import { createFakeMessaging } from "../../modules/messaging/messaging.ts";
import { fakeClock } from "../../modules/core/clock.ts";
import { seal } from "../../modules/report/sign.ts";

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

function templatesVectors(): unknown {
  const out: unknown[] = [];
  for (const language of LANGUAGES) {
    const facts = exampleFacts(settings, language);
    for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) {
      let text: string | null = null;
      try { text = render(id, facts); } catch { /* a template that needs facts the example does not carry */ }
      out.push({ area: "render", name: `${language} ${id}`, input: { id, language }, output: { text, check: text === null ? null : checkMessage(text, facts) } });
    }
    for (const t of META_TEMPLATES) {
      const parameters = parametersFor(t, language, facts);
      out.push({ area: "meta", name: `${language} ${t.name}`, input: { name: t.name, language }, output: { body: metaBody(t.bodies[language]), parameters, filled: fillBody(metaBody(t.bodies[language]), parameters) } });
    }
    out.push({ area: "labels", name: `${language} labels`, input: { language }, output: clean(LABELS[language]) });
    out.push({ area: "serviceList", name: `${language} service list`, input: { language }, output: clean(serviceList(settings, language)) });
    const slots = [10, 10.5, 11, 15].map((h) => zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: Math.floor(h), minute: (h % 1) * 60 }, TZ));
    out.push({ area: "slotList", name: `${language} slot list`, input: { language, slots }, output: clean(slotList(slots, TZ, language)) });
    out.push({ area: "buttons", name: `${language} buttons`, input: { language }, output: clean(buttonsFor(language, ["yes", "no"])) });
  }
  for (const id of ["svc:haircut", "svc:massage", `slot:${zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 11, minute: 0 }, TZ)}`, "yes", "no", "cancel", "cancel_yes", "keep", "menu", "owner", "paid", "nonsense", ""]) out.push({ area: "reply", name: `reply ${id}`, input: { id }, output: clean(intentFromReply(id, settings)) });
  out.push({ area: "submissions", name: "meta submissions", input: {}, output: clean(metaSubmissions(settings)) });
  return out;
}

function coerceVectors(): unknown {
  const ctx = { services: settings.services, languages: settings.languages };
  const raws: unknown[] = [
    null, "book it", 7, [], {}, { kind: "teleport" }, { kind: "book" }, { kind: "book", serviceId: "haircut", offerInr: 300 }, { kind: "book", serviceId: "massage" },
    { kind: "book", serviceId: "haircut", offerInr: -5 }, { kind: "book", serviceId: "haircut", offerInr: 0, overrideAttempt: true }, { kind: "book", serviceId: "haircut", offerInr: 1.5 }, { kind: "book", serviceId: "haircut", offerInr: "300" },
    { kind: "book", serviceId: "haircut", time: { hour: 6, minute: 0, period: "pm" } }, { kind: "book", serviceId: "haircut", time: { hour: 99, minute: 0, period: "am" } }, { kind: "book", serviceId: "haircut", time: { hour: 6, minute: 75, period: "pm" } },
    { kind: "book", serviceId: "haircut", time: { hour: 18, minute: 0, period: null } }, { kind: "book", serviceId: "haircut", time: { hour: 6, minute: 0, period: "noon" } },
    { kind: "book", serviceId: "haircut", date: { kind: "relative", offsetDays: 1 } }, { kind: "book", serviceId: "haircut", date: { kind: "relative", offsetDays: 9 } }, { kind: "book", serviceId: "haircut", date: { kind: "weekday", weekday: 2, which: "next" } },
    { kind: "book", serviceId: "haircut", date: { kind: "weekday", weekday: 9, which: "next" } }, { kind: "book", serviceId: "haircut", date: { kind: "calendar", day: 11, month: 11 } }, { kind: "book", serviceId: "haircut", date: { kind: "calendar", day: 32, month: 1 } },
    { kind: "cancel", language: "hi" }, { kind: "cancel", language: "fr" }, { kind: "yes" }, { kind: "no" }, { kind: "stop" }, { kind: "reschedule", date: { kind: "relative", offsetDays: 2 } }, { kind: "greeting", language: "en" }, { kind: "unknown" },
    { kind: "book", serviceId: "haircut", extra: "ignored" }, { kind: "book", serviceId: null, offerInr: null, date: null, time: null, language: null, overrideAttempt: false },
  ];
  const out: unknown[] = raws.map((raw) => ({ area: "coerce", name: JSON.stringify(raw) ?? "undefined", input: raw ?? null, output: clean(coerceIntent(raw, ctx)) }));
  for (const phrase of ["I want a haircut tomorrow at 6pm", "haircut", "hello", "tomorrow", "cancel my booking", "asdf qwer zxcv", "300 mein kar do", "STOP"]) {
    const intent = parseIntent(phrase, ctx);
    out.push({ area: "sure", name: phrase, input: phrase, output: { intent: clean(intent), rulesAreSure: rulesAreSure(intent) } });
  }
  out.push({ area: "prompt", name: "the shop's system prompt", input: {}, output: systemPrompt(ctx) });
  out.push({ area: "schema", name: "the shop's answer schema", input: {}, output: clean(intentSchema(ctx)) });
  return out;
}

function ondcVectors(): unknown {
  const NOW = Date.UTC(2026, 10, 17, 6, 30);
  const rental = parseSettings(JSON.parse(readFileSync(join(BOOKINGS, "settings", "equipment-rental.example.json"), "utf8")));
  const states = [...statesOf("bookings")].sort();
  const out: unknown[] = [];
  for (const [name, s] of [["glow salon", glowSalon()], ["equipment rental", rental]] as const) {
    out.push({ name: `${name} catalogue`, input: { shop: name, now: NOW }, output: clean(ondcServices.onSearch(catalogueOf(s, "client-1", NOW), SAMPLE_CALLER)) });
    for (const state of states) {
      const b = register(createStore(), newDraft("+919800000009", "en"));
      b.state = state as never; b.serviceId = s.services[0].id; b.startMs = Date.UTC(2026, 10, 18, 5, 0); b.endMs = b.startMs + s.services[0].durationMinutes * 60_000;
      const view = bookingIn(s, b, "client-1", NOW);
      const stage = statusOf("bookings", state).stage;
      const stages = state === "cancelled" || state === "expired" ? ["on_cancel"] : ["on_select", "on_init", "on_confirm", "on_status"];
      out.push({ name: `${name} ${state}`, input: { shop: name, state }, output: clean({ view, stage, messages: view ? stages.map((st) => ondcServices.bookingMessage(view, st as never, SAMPLE_CALLER)) : null }) });
    }
  }
  return out;
}

type Step = ["say", string, string?] | ["tap", string, string?] | ["pay"] | ["advance", number] | ["owner", string];
const SCENARIOS: { name: string; steps: Step[]; settings?: Record<string, unknown> }[] = [
  { name: "a booking in English, paid, confirmed", steps: [["say", "I want a haircut tomorrow at 6pm"], ["pay"]] },
  { name: "a booking in Hindi", steps: [["say", SAYS.hi.book], ["pay"]] },
  { name: "a booking in Malayalam", steps: [["say", SAYS.ml.book], ["pay"]] },
  { name: "a booking in Kannada", steps: [["say", SAYS.kn.book], ["pay"]] },
  { name: "a customer haggles, then pushes", steps: [["say", SAYS.en.haggle], ["say", SAYS.en.push], ["say", SAYS.en.cantGoLower]] },
  { name: "a customer tries to override the rules", steps: [["say", SAYS.en.trick], ["say", SAYS.en.trickFollowUp]] },
  { name: "hello, then a service tap, then a time tap", steps: [["say", "hello"], ["tap", "svc:haircut"]] },
  { name: "cancelled in time: the deposit comes back", steps: [["say", "I want a haircut day after tomorrow at 6pm"], ["pay"], ["say", "please cancel my booking"]] },
  { name: "cancelled late: the owner is asked", steps: [["say", "I want a haircut tomorrow at 6pm"], ["pay"], ["advance", 20 * 60], ["say", "please cancel my booking"]] },
  { name: "a hold nobody pays ends", steps: [["say", "I want a haircut tomorrow at 6pm"], ["advance", 20]] },
  { name: "a reminder before the booking, then the booking is over", steps: [["say", "I want a haircut tomorrow at 6pm"], ["pay"], ["advance", 16 * 60], ["advance", 24 * 60]] },
  { name: "STOP ends every message", steps: [["say", "hello"], ["say", "STOP"], ["say", "hello again"], ["advance", 60]] },
  { name: "the owner's words are not a customer's", steps: [["say", "hello"], ["owner", "help"]] },
  { name: "a refund limit of 100 holds a refund for the owner", steps: [["say", "I want a haircut day after tomorrow at 6pm"], ["pay"], ["say", "please cancel my booking"]], settings: { cancellation: { windowHours: 24, refundLimitInr: 100 } } },
];
function scenarioVectors(): unknown {
  return SCENARIOS.map((sc) => {
    const w = createWorld(sc.settings ? { settings: parseSettings({ ...example, ...sc.settings }) } : {});
    const seen = new Map<string, number>();
    const cursor = { record: 0 };
    const sentSince = (who: string): unknown[] => { const all = w.messaging.sentTo(who); const from = seen.get(who) ?? 0; seen.set(who, all.length); return all.slice(from).map((m) => clean({ kind: m.kind, templateName: m.templateName ?? null, text: m.text, interactive: m.interactive ?? null })) as unknown[]; };
    const results: unknown[] = [];
    const run = async () => {
      for (const step of sc.steps) {
        if (step[0] === "say") await w.say(step[1], step[2] ? { from: step[2] } : {});
        else if (step[0] === "tap") await w.tap(step[1], step[2] ? { from: step[2] } : {});
        else if (step[0] === "pay") { const l = w.payments.links().at(-1)!; w.payments.customerPays(l.id); await w.deliverPaymentEvents(); }
        else if (step[0] === "advance") await w.advance(step[1]);
        else await w.say(step[1], { from: w.owner });
        const entries = w.record.entries().slice(cursor.record); cursor.record = w.record.entries().length;
        results.push({ step, customer: sentSince("+919811111111"), owner: sentSince(w.owner),
          record: entries.map((e) => clean({ action: e.action, outcome: e.outcome, booking: e.booking, decisions: (e.decisions ?? []).map((d: { ruleId: string; verdict: string }) => ({ ruleId: d.ruleId, verdict: d.verdict })), refs: Object.fromEntries(Object.entries(e.refs ?? {}).filter(([k]) => !/id$|Id$|digest|fingerprint/u.test(k))) })) });
      }
    };
    return run().then(() => ({ name: sc.name, input: { steps: sc.steps, settings: sc.settings ?? null }, output: results, finalBookings: [...w.store.bookings.values()].map((b) => ({ id: b.id, state: b.state })) }));
  });
}

// a fixed Ed25519 key (the seed is bytes 1 to 32): a signature is then the same every run
const SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const fixedKey = () => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), SEED]), format: "der", type: "pkcs8" });
const otherKey = () => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(Array.from({ length: 32 }, (_, i) => 100 + i))]), format: "der", type: "pkcs8" });

function goLiveVectors(): unknown {
  const out: unknown[] = [];
  const issuedAt = Date.parse("2027-02-04T10:30:00+05:30");
  const upi = parseSettings({ ...example, payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } });
  const hand = { held: 33, total: 33, checks: 196, failedTitles: [] as string[] };
  const cases: [string, typeof settings, typeof hand & { notRun?: string[]; ranOn?: string }][] = [
    ["glow salon, all held", settings, hand], ["glow salon, two failed", settings, { ...hand, held: 31, failedTitles: ["Cancellation after the window", "Late cancellation"] }],
    ["a UPI shop", upi, hand], ["glow salon, two not run", settings, { ...hand, notRun: ["Cancellation after the window", "Late cancellation"] }],
  ];
  for (const [name, s, h] of cases) {
    const cert = buildGoLiveCertificate({ settings: s, handCheck: h as never, issuedAt, preparedBy: "Divya, local Operator" });
    out.push({ area: "certificate", name, input: { shop: name, handCheck: h, issuedAt }, output: clean(cert) });
    const env = seal(cert);
    for (const l of LANGUAGES) { out.push({ area: "text", name: `${name} text ${l}`, input: { language: l }, output: goLiveText(env, l) }); out.push({ area: "section", name: `${name} section ${l}`, input: { language: l }, output: goLiveSection(env, l) }); out.push({ area: "limits", name: `${name} limits ${l}`, input: { language: l }, output: limitLines(cert, l) }); }
  }
  // signatures and the checks of a file: round trip, a changed byte, someone else's key, naming a trusted key, a file that is not a document
  const doc = buildGoLiveCertificate({ settings, handCheck: hand as never, issuedAt, preparedBy: "Divya, local Operator" });
  const key = fixedKey();
  const pub = publicKeyHex(key);
  const signed = envelopeFile(seal(doc, key));
  const unsigned = envelopeFile(seal(doc));
  const other = envelopeFile(seal(doc, otherKey()));
  const verified = (text: string, trust: string[] = []) => clean(verifyEnvelopeText(text, trust));
  out.push({ area: "verify", name: "signed, no trusted key", input: { text: signed, trust: [] }, output: verified(signed) });
  out.push({ area: "verify", name: "signed, the key named by its raw hex", input: { text: signed, trust: [pub] }, output: verified(signed, [pub]) });
  out.push({ area: "verify", name: "signed, the key named by its id", input: { text: signed, trust: [keyIdOf(pub)] }, output: verified(signed, [keyIdOf(pub)]) });
  out.push({ area: "verify", name: "unsigned", input: { text: unsigned, trust: [] }, output: verified(unsigned) });
  out.push({ area: "verify", name: "signed by someone else's key, naming ours", input: { text: other, trust: [pub] }, output: verified(other, [pub]) });
  out.push({ area: "verify", name: "one byte changed (the deposit)", input: { text: signed.replace('"depositInr":200', '"depositInr":201'), trust: [] }, output: verified(signed.replace('"depositInr":200', '"depositInr":201')) });
  out.push({ area: "verify", name: "not JSON", input: { text: "{ half", trust: [] }, output: verified("{ half") });
  out.push({ area: "verify", name: "another format", input: { text: signed.replace("geometer-document/1", "something-else/1"), trust: [] }, output: verified(signed.replace("geometer-document/1", "something-else/1")) });
  out.push({ area: "key", name: "the fixed key", input: { seed: SEED.toString("hex") }, output: { publicKey: pub, keyId: keyIdOf(pub) } });
  // how the monthly report reads a certificate it was given
  const reading = (text: string, s: typeof settings) => clean(readGoLiveCertificate(text, s));
  const own = (s: typeof settings, h: object = hand) => envelopeFile(seal(buildGoLiveCertificate({ settings: s, handCheck: h as never, issuedAt }), key));
  out.push({ area: "reading", name: "a certificate made for this shop", input: { shop: "glow salon" }, output: reading(own(settings), settings) });
  out.push({ area: "reading", name: "a certificate made for another shop's settings", input: { shop: "glow salon read as UPI" }, output: reading(own(settings), upi) });
  out.push({ area: "reading", name: "a UPI shop's own", input: { shop: "upi" }, output: reading(own(upi), upi) });
  out.push({ area: "reading", name: "checks that were not all run", input: { shop: "glow salon" }, output: reading(own(settings, { ...hand, notRun: ["Late cancellation"] }), settings) });
  out.push({ area: "reading", name: "a torn file", input: { text: "{ half" }, output: reading("{ half", settings) });
  return out;
}

async function routerVectors(): Promise<unknown> {
  const ctx = { services: settings.services, languages: settings.languages };
  const NOON = Date.UTC(2026, 10, 5);
  const out: unknown[] = [];
  const deciders: [string, Decider | "down"][] = [
    ["no decision model", "down"], ["sure: greeting", (n) => ({ choice: n === "intent" ? "greeting" : n === "service" ? "no_service" : "no_slot", p: 0.95 })],
    ["sure: book a haircut", (n) => ({ choice: n === "intent" ? "book" : n === "service" ? "haircut" : "no_slot", p: 0.95 })],
    ["unsure", (n) => ({ choice: n === "intent" ? "greeting" : n === "service" ? "no_service" : "no_slot", p: 0.4 })],
  ];
  const models: [string, string | "down" | "none"][] = [["no language model", "none"], ["a language model that says book", JSON.stringify({ kind: "book", language: "en", serviceId: "haircut", offerInr: null, date: null, time: null, overrideAttempt: false })], ["a language model that is down", "down"], ["a language model that talks nonsense", "I am sorry"]];
  const phrases = ["hello", "I want a haircut tomorrow at 6pm", "asdf qwer zxcv", "300 mein kar do", "cancel my booking", "STOP"];
  for (const [dn, decider] of deciders) for (const [mn, model] of models) for (const text of phrases) {
    const standin = systemOneStandin({ decider: decider === "down" ? undefined : decider });
    const viaStandin = systemOneFetch(standin, { down: () => decider === "down" });
    const modelFetch = (async () => {
      if (model === "down") throw new TypeError("the connection failed");
      return new Response(JSON.stringify({ id: "x", choices: [{ index: 0, message: { role: "assistant", content: model }, finish_reason: "stop" }], usage: { prompt_tokens: 2000, completion_tokens: 150 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const router = createRouter({
      decision: { client: createSystemOne({ baseUrl: "http://decision.test", model: "laya", kind: "laya", timeoutMs: 1000 }, viaStandin) },
      ...(model === "none" ? {} : { model: { parser: createModelParser({ wire: "openai", baseUrl: "http://model.test/v1", model: "deepseek-ai/DeepSeek-V4.1-Flash", timeoutMs: 1000 }, modelFetch), provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash" } }),
      now: () => NOON,
    });
    const result = await router.parseDetailed(text, ctx);
    out.push({ name: `${dn} / ${mn} / ${text}`, input: { decision: dn, model: mn, text }, output: clean(result) });
  }
  return out;
}

/** What each in-memory service answers, and what every planned fault does, over three calls of one operation. */
async function standinFaultVectors(): Promise<unknown> {
  const out: unknown[] = [];
  const clock = fakeClock(Date.UTC(2026, 10, 3, 4, 30));
  const describe = async (f: () => Promise<unknown>): Promise<unknown> => {
    try { const r = await f(); return { ok: true, result: clean(r) }; } catch (e) { const x = e as { name?: string; status?: number; message?: string }; return { ok: false, name: x.name ?? "Error", status: x.status ?? null, message: String(x.message ?? e) }; }
  };
  const plans = [{ times: 1 }, { times: 2, after: 1 }, {}];
  const payOps: Record<string, (p: ReturnType<typeof createFakePayments>, ids: { link: string; payment: string }, n: number) => Promise<unknown>> = {
    createRequest: (p, _i, n) => p.createRequest({ amount: 20000, reference_id: `b-${n}`, description: "Glow Salon deposit" }), fetchRequest: (p, i) => p.fetchRequest(i.link), listRequests: (p) => p.listRequests({ reference_id: "b-0" }),
    cancelRequest: (p, i) => p.cancelRequest(i.link), fetchPayment: (p, i) => p.fetchPayment(i.payment), refund: (p, i, n) => p.refund(i.payment, { amount: 20000, receipt: `b-0:${i.payment}:${n}` }), listRefunds: (p, i) => p.listRefunds(i.payment),
  };
  for (const [op, call] of Object.entries(payOps)) for (const mode of ["lostReply", "error", "guardUnavailable", "uncertainHold", "outcomeUnknown", "guardRefused", "serverError", "declined", null] as const) for (const plan of mode === null ? [{}] : plans) {
    const p = createFakePayments(clock);
    const link = await p.createRequest({ amount: 20000, reference_id: "b-0", description: "Glow Salon deposit" });
    const payment = p.customerPays(link.id);
    if (mode) p.inject(op as never, mode, plan as never);
    const results = []; for (let n = 1; n <= 3; n++) results.push(await describe(() => call(p, { link: link.id, payment: payment.id }, n)));
    out.push({ service: "payments", name: `${op} ${mode ?? "no fault"} ${JSON.stringify(plan)}`, input: { op, mode, plan }, output: { results, links: clean(p.links()), refunds: clean(p.refunds()) } });
  }
  const start = Date.UTC(2026, 10, 4, 5, 30);
  const calOps: Record<string, (c: ReturnType<typeof createFakeCalendar>, id: string, n: number) => Promise<unknown>> = {
    insert: (c, _i, n) => c.insert({ summary: `hold ${n}`, start: start + n * 3_600_000, end: start + n * 3_600_000 + 2_700_000, status: "tentative", bookingRef: `b-${n}` } as never), get: (c, id) => c.get(id), list: (c) => c.list({ bookingRef: "b-0" }),
    update: (c, id, n) => c.update(id, { status: "confirmed", summary: `c${n}` }), delete: (c, id) => c.delete(id), freeBusy: (c) => c.freeBusy(start - 3_600_000, start + 8 * 3_600_000), conflicts: (c) => c.conflicts(start, start + 2_700_000),
  };
  for (const [op, call] of Object.entries(calOps)) for (const mode of ["silentFailure", "lostReply", "conflict", "error", null] as const) for (const plan of mode === null ? [{}] : plans) {
    const c = createFakeCalendar();
    const first = await c.insert({ summary: "hold 0", start, end: start + 2_700_000, status: "tentative", bookingRef: "b-0" } as never);
    if (mode) c.inject(op as never, mode, plan as never);
    const results = []; for (let n = 1; n <= 3; n++) results.push(await describe(() => call(c, first.id, n)));
    out.push({ service: "calendar", name: `${op} ${mode ?? "no fault"} ${JSON.stringify(plan)}`, input: { op, mode, plan }, output: { results, events: clean(c.events()) } });
  }
  const msgOps: Record<string, (m: ReturnType<typeof createFakeMessaging>, n: number) => Promise<unknown>> = {
    sendText: (m, n) => m.sendText("+919811111111", `hello ${n}`),
    sendTemplate: (m, n) => m.sendTemplate("+919811111111", { name: "booking_update", language: "en", body: `update ${n}`, parameters: [`p${n}`] } as never),
    sendInteractive: (m, n) => m.sendInteractive!("+919811111111", { body: `pick ${n}`, buttons: [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }] } as never),
  };
  for (const [op, call] of Object.entries(msgOps)) for (const mode of ["lostReply", "error", null] as const) for (const plan of mode === null ? [{}] : plans) {
    const m = createFakeMessaging(clock);
    m.receive("+919811111111", "hi"); // opens the customer's 24-hour window
    if (mode) m.inject(op as never, mode, plan as never);
    const results = []; for (let n = 1; n <= 3; n++) results.push(await describe(() => call(m, n)));
    out.push({ service: "messaging", name: `${op} ${mode ?? "no fault"} ${JSON.stringify(plan)}`, input: { op, mode, plan }, output: { results, outbox: clean(m.outbox().map((x) => ({ to: x.to, kind: x.kind, text: x.text, templateName: x.templateName ?? null }))) } });
  }
  return out;
}

/** The busy month of the report tests (report/example-month.ts) made into a report, and every layer of it drawn: data, owner's lines, page, WhatsApp message, certificate. */
async function reportVectors(): Promise<unknown> {
  const { world } = await runBusyMonth();
  const { from, to } = monthRange("2026-11", settings.timezone);
  const out: unknown[] = [];
  for (const source of ["stand-in", "test-mode", "live"] as const) {
    const report = buildMonthlyReport({ settings, entries: world.record.entries(), bookings: [...world.store.bookings.values()], from, to, source, madeAt: at(12, 2, 10), preparedBy: "Divya, local Operator", innovator: false } as never);
    out.push({ area: "data", name: `report data, ${source}`, input: { month: "2026-11", source }, output: clean(report) });
    if (source !== "stand-in") continue;
    const env = seal(report);
    for (const l of LANGUAGES) {
      out.push({ area: "owner", name: `owner's lines ${l}`, input: { language: l }, output: ownerText(report, l) });
      out.push({ area: "page", name: `page ${l}`, input: { language: l }, output: reportPage(env, l) });
      out.push({ area: "whatsapp", name: `whatsapp ${l}`, input: { language: l, link: "https://reports.example/r/abc" }, output: clean(monthlyReportMessage(env, l, { link: "https://reports.example/r/abc" })) });
      out.push({ area: "certificate", name: `monthly certificate ${l}`, input: { language: l }, output: monthlyCertificateText(seal(buildMonthlyCertificate(env, at(12, 2, 10))), l) });
    }
    out.push({ area: "certificate", name: "monthly certificate data", input: {}, output: clean(buildMonthlyCertificate(env, at(12, 2, 10))) });
  }
  out.push({ area: "submissions", name: "report template submissions", input: {}, output: clean(reportSubmissions()) });
  return out;
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
  await scenario("a task whose only try was started when the process died is failed, not run again: it cannot loop across restarts", [msg("m1", "a"), msg("m2", "b")], [], {}, true);
  await scenario("a task that always fails with no retries is failed after one try", [msg("m1", "a")], [], { "message:m1": "fail" });
  {
    const data2 = join(dir, "saves-nothing"); mkdirSync(data2, { recursive: true });
    const db2 = openStore(data2);
    db2.saveEvents([msg("m1", "poison")], 1000);
    let tries = 0;
    const runner2 = createRunner({ db: db2, retryDelaysMs: [1], log: () => undefined, now: () => 1000, step: async () => { tries++; throw new Error("fails after the work"); } });
    runner2.kick(); await runner2.idle();
    const state = db2.loadState();
    out.push({ name: "a step that fails after its work saves nothing: no state, no record line, the task is failed", input: { retryDelaysMs: [1] }, output: { tries, counts: db2.taskCounts(), snapshot: state.snapshot, record: state.record.length } });
    db2.close();
  }
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
  put("templates-vectors.json", templatesVectors());
  put("coerce-vectors.json", coerceVectors());
  put("ondc-vectors.json", ondcVectors());
  put("scenarios-vectors.json", await Promise.all(scenarioVectors() as Promise<unknown>[]));
  put("report-vectors.json", await reportVectors());
  put("golive-vectors.json", goLiveVectors());
  put("router-vectors.json", await routerVectors());
  put("standin-faults-vectors.json", await standinFaultVectors());
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
