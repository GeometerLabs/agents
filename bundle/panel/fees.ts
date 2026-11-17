// The phone setup for a Fees centre: what its two steps take from the form (the centre with its batches, fees and students; then the rules of the month), what they refuse
// in the person's own language, and how they become the settings a builder would write. Languages, accounts and checks are the same steps as Bookings' (setup.ts). The form
// is plain: a few rows for batches, one box with a student on each line, and the numbers. `validateSettings` of the Fees pathway is the last gate on everything.
import { providerById } from "../../modules/payments/providers/index.ts";
import type { Language } from "../../modules/language/languages.ts";
import { batchName, validateSettings } from "../../templates/education/fees/src/settings.ts";
import type { Settings } from "../../templates/education/fees/src/settings.ts";
import { limitLinesOf, limitsOf } from "../../templates/education/fees/report/certificate.ts";
import { payeeProblem, vpaProblem } from "../../modules/payments/providers/index.ts";
import { approversDraftOf, approversFromDraft, newPayment, normalizePhone, PREVIEW_PAYMENT, paymentBlock, paymentFromSettings, paymentModuleOf, whatsappDraftOf } from "./setup.ts";
import type { Body, Built, Draft, StepResult } from "./setup.ts";
import type { ShopMeta } from "./shops.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";
import { KEEP, keepHidden } from "./keep.ts";
import { dayNumber } from "../../templates/education/fees/src/classes/settings.ts";
import { classesWords } from "./words-classes.ts";

/** A phone form with room for this many batches and students. A centre with more is set up by a builder, who can write the file. */
export const MAX_BATCHES = 6;
export const MAX_STUDENTS = 300;

/** What the Fees form shows and sends back. Every value is text, as typed. */
export interface FeesForm {
  address: string;
  /** Always MAX_BATCHES rows; a row with no name and no fee is left out. */
  batches: { name: string; fee: string }[];
  /** One student on each line: name, the parent's number, the batch's name. */
  students: string;
  dueDay: string; graceDays: string; lateFee: string;
  /** "-3, 0, 5": days from the due day. */
  reminderDays: string; reminderHour: string; reminderMost: string;
  partAllowed: boolean; partMin: string;
  waiver: string; refund: string;
  /**
   * The Classes part (17 Nov, item 7): one class on each line, "batch, day, start time, minutes" ("Class 8, Mon, 16:00, 45"). Empty: the centre has no `classes` block. A draft from before
   * this has neither field.
   */
  timetable?: string;
  /** Classes: an old unpaid month also holds back the class link (`classes.oldDuesStopLink`). Written only when on; absent means off. */
  oldDuesStopLink?: boolean;
  /**
   * Kept from a centre being changed, never typed (17 Nov, item 7): the id each batch row had, by row, so a renamed batch is still the batch its students' dues and its timetable
   * belong to. The rest of what the form does not show is put back from the saved settings by keep.ts when the centre is saved.
   */
  keepIds?: string[];
}

const text = (v: string | undefined, max = 120) => (v ?? "").trim().slice(0, max);
const WHOLE = /^\d{1,9}$/u;
const SIGNED = /^-?\d{1,3}$/u;

/** How many class lines the box takes (the settings allow 14 a batch, and a form has 6 batches: 6 x 10 is more than a small centre writes). */
export const MAX_CLASS_LINES = 60;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * One class line as typed: "Class 8, Mon, 16:00, 45". The last three parts are the day, the start time and the minutes (the minutes may be left out: 60), so a batch's name may hold a
 * comma. Nothing is judged here; the steps and the build say what is wrong.
 */
export function timetableLine(line: string): { batch: string; day: string; time: string; minutes: string } | undefined {
  const parts = line.split(",").map((p) => p.trim());
  const withMinutes = parts.length >= 4 && /^\d{1,4}$/u.test(parts[parts.length - 1]);
  const rest = withMinutes ? parts.slice(0, -1) : parts;
  if (rest.length < 3) return undefined;
  const batch = rest.slice(0, -2).join(", ");
  return batch === "" ? undefined : { batch, day: rest[rest.length - 2], time: rest[rest.length - 1], minutes: withMinutes ? parts[parts.length - 1] : "60" };
}
const padTime = (t: string): string => (/^\d:\d{2}$/u.test(t) ? `0${t}` : t);
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;
const classLines = (v: string): string[] => v.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "");

const blankBatches = (): FeesForm["batches"] => Array.from({ length: MAX_BATCHES }, () => ({ name: "", fee: "" }));
/** A Fees draft has no use for Bookings' form, but the shared steps read the centre's name from `form.name`, so that is where the name lives. */
const emptyShopForm = (): Draft["form"] => ({ name: "", language: "en", services: [], deposit: "", opens: "", closes: "", days: [] });

/** The settings of the template's example, as the form's starting point: its rules are the template's defaults; the centre, batches and students are the Operator's own. */
export function newFeesDraft(id: string, accountId: string, template: Template, example: Settings, now: string): Draft {
  return {
    id, accountId, template: template.id, createdAt: now, editing: false, saved: false,
    form: emptyShopForm(), windowHours: "", primaryLanguage: example.languages[0], otherLanguages: [], ownerLanguage: example.owner.language, ownerNumber: "",
    whatsapp: { businessNumber: "", numberId: "" }, calendar: { id: "" }, gateway: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: 0,
    fees: {
      address: "", batches: blankBatches(), students: "", timetable: "", oldDuesStopLink: false,
      dueDay: String(example.due.day), graceDays: String(example.due.graceDays), lateFee: String(example.lateFeeInr),
      reminderDays: example.reminders.daysFromDue.join(", "), reminderHour: String(example.reminders.hour), reminderMost: String(example.reminders.maxPerMonth),
      partAllowed: example.partPayments.allowed, partMin: String(example.partPayments.minInr), waiver: String(example.waiver.limitInr), refund: String(example.refund.limitInr),
    },
  };
}

/** A draft for a centre that already exists, so changing its settings is the same six steps. */
export function feesDraftFromShop(id: string, accountId: string, templateId: string, shopId: string, s: Settings, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft {
  const first = s.languages[0];
  const batches = blankBatches();
  s.batches.slice(0, MAX_BATCHES).forEach((b, i) => { batches[i] = { name: batchName(b, first), fee: String(b.monthlyFeeInr) }; });
  const students = s.students.map((x) => `${x.name}, ${x.parent}, ${batchName(s.batches.find((b) => b.id === x.batchId) ?? s.batches[0], first)}`).join("\n");
  // the Classes part, from the saved block: one line for each class, the batch by the name the form shows
  const timetable = s.batches.flatMap((b) => (s.classes?.timetable[b.id] ?? []).map((c) => `${batchName(b, first)}, ${DAY_SHORT[c.day]}, ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}, ${c.minutes}`)).join("\n");
  return {
    id, accountId, template: templateId, createdAt: now, shopId, editing: true, saved: true, form: { ...emptyShopForm(), name: s.name }, windowHours: "",
    primaryLanguage: first, otherLanguages: s.languages.slice(1), ownerLanguage: s.owner.language, ownerNumber: s.owner.whatsapp,
    ...approversDraftOf(s.approvers),
    whatsapp: whatsappDraftOf(meta, runtime),
    calendar: { id: "" }, gateway: { mode: meta.gateway?.mode ?? "live", keyId: meta.gateway?.keyId ?? "" }, payment: paymentFromSettings(s.payment), expectedBookings: "", done: Number.MAX_SAFE_INTEGER,
    fees: {
      address: s.address ?? "", batches, students,
      dueDay: String(s.due.day), graceDays: String(s.due.graceDays), lateFee: String(s.lateFeeInr), reminderDays: s.reminders.daysFromDue.join(", "), reminderHour: String(s.reminders.hour), reminderMost: String(s.reminders.maxPerMonth),
      partAllowed: s.partPayments.allowed, partMin: String(s.partPayments.minInr), waiver: String(s.waiver.limitInr), refund: String(s.refund.limitInr),
      timetable, oldDuesStopLink: (s.classes as { oldDuesStopLink?: boolean } | undefined)?.oldDuesStopLink === true,
      keepIds: s.batches.slice(0, MAX_BATCHES).map((b) => b.id),
    },
  };
}

/**
 * An id for each name: its name in lowercase letters, digits and dashes (the settings' rule), made unique. A name with none of those gets `<fallback>-<n>`. `fixed[i]` is an id the
 * i-th name already had (a shop being changed keeps the ids its orders refer to); it is used again, with a number added if an earlier name took it. Orders' menu and slots use this too.
 */
export function idsFrom(names: string[], fallback: string, fixed: (string | undefined)[] = []): string[] {
  const used = new Set<string>();
  return names.map((n, i) => {
    const base = fixed[i] ?? (n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 30).replace(/-+$/u, "") || `${fallback}-${i + 1}`);
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return id;
  });
}

const feesOf = (draft: Draft): FeesForm => draft.fees as FeesForm;

// ---- step 1: the centre, its batches and its students -------------------------------------------------------------------------------

// Fees step 1: the centre, its batches, fees and students into the draft, with problems in the person's language.
export function applyFeesBusiness(draft: Draft, body: Body, w: Words): StepResult {
  const s = w.setup.problems;
  const f = w.setup.fees.problems;
  const problems: string[] = [];
  const name = text(body.name, 80);
  const address = text(body.address, 120);
  const batches = Array.from({ length: MAX_BATCHES }, (_, i) => ({ name: text(body[`batch_name_${i}`], 60), fee: text(body[`batch_fee_${i}`], 9) }));
  const students = (body.students ?? "").slice(0, 40_000);
  const timetable = (body.timetable ?? "").slice(0, 8000);
  const oldDuesStopLink = body.oldDuesStopLink === "on";
  if (name === "") problems.push(s.nameEmpty);
  let used = 0;
  batches.forEach((b, i) => {
    if (b.name === "" && b.fee === "") return;
    used++;
    if (b.name === "") problems.push(f.batchNameEmpty(i + 1));
    if (!WHOLE.test(b.fee) || Number(b.fee) < 1 || Number(b.fee) > 1_000_000) problems.push(f.feeBad(i + 1));
  });
  if (used === 0) problems.push(f.noBatch);
  // Kept even when something is wrong, so the form comes back as it was typed.
  draft.form = { ...draft.form, name };
  draft.fees = { ...feesOf(draft), address, batches, students, timetable, oldDuesStopLink };
  const lines = students.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) problems.push(f.noStudents);
  else if (lines.length > MAX_STUDENTS) problems.push(f.tooMany(MAX_STUDENTS));
  else {
    const known = new Set(batches.filter((b) => b.name !== "").map((b) => b.name.toLowerCase()));
    lines.forEach((line, i) => {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 3 || parts[0] === "" || parts[1] === "" || parts.slice(2).join(",") === "") { problems.push(f.studentBad(i + 1)); return; }
      if (!normalizePhone(parts[1])) problems.push(f.studentNumber(i + 1));
      if (!known.has(parts.slice(2).join(",").toLowerCase())) problems.push(f.studentBatch(i + 1, parts.slice(2).join(",").slice(0, 60)));
    });
  }
  problems.push(...classProblems(timetable, new Set(batches.filter((b) => b.name !== "").map((b) => b.name.toLowerCase())), w));
  return { problems };
}

/** The Classes box: each line refused in the person's language, with its row. An empty box is fine (no Classes). */
function classProblems(timetable: string, known: Set<string>, w: Words): string[] {
  const c = classesWords(w).problems;
  const rows = classLines(timetable);
  if (rows.length > MAX_CLASS_LINES) return [c.tooMany(MAX_CLASS_LINES)];
  const problems: string[] = [];
  const seen = new Set<string>();
  rows.forEach((line, i) => {
    const x = timetableLine(line);
    if (!x) { problems.push(c.lineBad(i + 1)); return; }
    if (!known.has(x.batch.toLowerCase())) problems.push(c.batch(i + 1, x.batch.slice(0, 60)));
    const day = dayNumber(x.day);
    if (day === undefined) problems.push(c.day(i + 1));
    if (!CLOCK.test(padTime(x.time))) problems.push(c.time(i + 1));
    if (!WHOLE.test(x.minutes) || Number(x.minutes) < 10 || Number(x.minutes) > 240) problems.push(c.minutes(i + 1));
    const key = `${x.batch.toLowerCase()}|${day}|${padTime(x.time)}`;
    if (seen.has(key)) problems.push(c.twice(i + 1));
    seen.add(key);
  });
  return problems;
}

// ---- step 2: the rules of the month ----------------------------------------------------------------------------------------------------

// Fees step 2: the rules of the month (due dates, reminders, limits) into the draft; validateSettings of the Fees pathway still has the last word.
export function applyFeesRules(draft: Draft, body: Body, w: Words): StepResult {
  const f = w.setup.fees.problems;
  const problems: string[] = [];
  const fees = feesOf(draft);
  const cheapest = Math.min(...fees.batches.filter((b) => WHOLE.test(b.fee) && Number(b.fee) >= 1).map((b) => Number(b.fee)), Number.POSITIVE_INFINITY);
  const cap = Number.isFinite(cheapest) ? `₹${cheapest.toLocaleString("en-IN")}` : "";
  const whole = (v: string, min: number, max: number) => WHOLE.test(v) && Number(v) >= min && Number(v) <= max;
  const next: FeesForm = {
    ...fees,
    dueDay: text(body.dueDay, 3), graceDays: text(body.graceDays, 3), lateFee: text(body.lateFee, 9), reminderDays: text(body.reminderDays, 60), reminderHour: text(body.reminderHour, 3), reminderMost: text(body.reminderMost, 3),
    partAllowed: body.partAllowed === "on", partMin: text(body.partMin, 9), waiver: text(body.waiver, 9), refund: text(body.refund, 9),
  };
  if (!whole(next.dueDay, 1, 28)) problems.push(f.dueBad);
  if (!whole(next.graceDays, 0, 30)) problems.push(f.graceBad);
  const max = Number.isFinite(cheapest) ? cheapest : 1_000_000;
  if (!whole(next.lateFee, 0, max)) problems.push(f.lateBad(cap));
  const days = next.reminderDays.split(",").map((d) => d.trim());
  if (days.length === 0 || !days.every((d) => SIGNED.test(d) && Number(d) >= -14 && Number(d) <= 60) || new Set(days.map(Number)).size !== days.length) problems.push(f.daysBad);
  if (!whole(next.reminderHour, 6, 21)) problems.push(f.hourBad);
  if (!whole(next.reminderMost, 1, 12)) problems.push(f.mostBad);
  if (next.partAllowed && !whole(next.partMin, 1, max)) problems.push(f.partBad(cap));
  if (!whole(next.waiver, 0, max)) problems.push(f.waiverBad(cap));
  if (!whole(next.refund, 0, 1_000_000)) problems.push(f.refundBad);
  draft.fees = next;
  return { problems };
}

// ---- the settings, and the folder ---------------------------------------------------------------------------------------------------------

/**
 * The form, the languages and the owner become the Fees settings; `validateSettings` is the last word. `saved` is the centre's settings.json as written, for a centre being
 * changed: everything the form does not show (a student's `backDues`, `joined` and `adult`, the `classes` block's other keys, `joiningMidMonth`, a batch's other names) is put
 * back from it by keepHidden before the check (keep.ts). Left out (a new centre, a preview): built from the form alone.
 */
export function buildFeesSettings(draft: Draft, example: Settings, saved?: unknown): Built {
  const fees = feesOf(draft);
  const languages: Language[] = [draft.primaryLanguage as Language, ...(draft.otherLanguages as Language[])];
  const filled = fees.batches.map((b, row) => ({ b, row })).filter(({ b }) => b.name !== "" && b.fee !== "");
  const rows = filled.map(({ b }) => b);
  const ids = idsFrom(rows.map((b) => b.name), "batch", filled.map(({ row }) => fees.keepIds?.[row]));
  const names = (n: string) => Object.fromEntries(languages.map((l) => [l, [n]]));
  const lookup = new Map(rows.map((b, i) => [b.name.toLowerCase(), ids[i]]));
  const students = fees.students.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "").map((line) => {
    const parts = line.split(",").map((p) => p.trim());
    return { name: parts[0], parent: normalizePhone(parts[1] ?? "") ?? parts[1], batch: lookup.get(parts.slice(2).join(",").toLowerCase()) ?? parts.slice(2).join(","), ...(languages.length > 1 ? { language: languages[0] } : {}) };
  });
  const whole = (v: string) => (WHOLE.test(v) ? Number(v) : Number.NaN);
  // The Classes part: the lines that read become the timetable by batch id; a form with no class line has no `classes` block (keep.ts then drops a saved one: the Operator emptied the box)
  const timetable: Record<string, { day: string; time: string; minutes: number }[]> = {};
  for (const line of classLines(fees.timetable ?? "")) {
    const x = timetableLine(line);
    const id = x ? lookup.get(x.batch.toLowerCase()) : undefined;
    const day = x ? dayNumber(x.day) : undefined;
    if (x && id && day !== undefined) (timetable[id] ??= []).push({ day: DAY_KEYS[day], time: padTime(x.time), minutes: whole(x.minutes) });
  }
  const classes = Object.keys(timetable).length > 0 ? { timetable, ...(fees.oldDuesStopLink ? { oldDuesStopLink: true } : {}) } : undefined;
  // The rules step shows the centre's limits before the accounts step has asked for the UPI ID: until it is given, the lines are worked out with a stand-in UPI ID
  // (PREVIEW_PAYMENT; they do not depend on it), never as a gateway centre.
  // The save cannot be reached before the accounts step has checked the UPI ID.
  const upi = !providerById(paymentModuleOf(draft))?.gateway;
  const payment = upi && (vpaProblem(draft.payment?.upiId) !== null || payeeProblem(draft.payment?.payee) !== null) ? PREVIEW_PAYMENT : paymentBlock(draft);
  const raw = {
    name: draft.form.name, ...(fees.address !== "" ? { address: fees.address } : {}), timezone: (saved as { timezone?: string } | undefined)?.timezone ?? example.timezone, languages,
    batches: rows.map((b, i) => ({ id: ids[i], names: names(b.name), monthlyFeeInr: whole(b.fee) })),
    students,
    due: { day: whole(fees.dueDay), graceDays: whole(fees.graceDays) }, lateFeeInr: whole(fees.lateFee),
    reminders: { daysFromDue: fees.reminderDays.split(",").map((d) => Number(d.trim())), hour: whole(fees.reminderHour), maxPerMonth: whole(fees.reminderMost) },
    partPayments: { allowed: fees.partAllowed, minInr: fees.partAllowed ? whole(fees.partMin) : Math.min(...rows.map((b) => whole(b.fee)), 100) },
    waiver: { limitInr: whole(fees.waiver) }, refund: { limitInr: whole(fees.refund) },
    payment,
    owner: { whatsapp: draft.ownerNumber, language: draft.ownerLanguage },
    ...approversFromDraft(draft),
    ...(classes ? { classes } : {}),
  };
  const written = saved === undefined ? raw : keepHidden(raw, saved, KEEP.fees);
  const checked = validateSettings(written);
  // `written` is the shape a builder writes (and `shop add --template fees` takes): the checked settings name a student's batch differently.
  return checked.ok ? ({ ok: true, settings: checked.settings as never, raw: written } as Built) : { ok: false, errors: checked.errors };
}

/** The centre's limits as one sentence each, in the person's language: the same lines the go-live certificate prints. From the draft when it builds, nothing when it does not yet. */
export function feesLimitLines(draft: Draft, example: Settings, language: Language, saved?: Settings): string[] {
  // The owner's number comes in a later step than the rules, and the lines do not show it: until it is given, the example's stands in so the lines can be shown with the rules.
  const asked = draft.ownerNumber === "" ? { ...draft, ownerNumber: example.owner.whatsapp } : draft;
  const settings = saved ?? (() => { const built = buildFeesSettings(asked, example); return built.ok ? (built.settings as unknown as Settings) : undefined; })();
  return settings ? limitLinesOf(limitsOf(settings), language) : [];
}

/** runtime.json for a Fees centre: who things are. It has messaging and no calendar (the runtime refuses a calendar it does not use), and payments only for a centre that chose a gateway (B71). */
export function runtimeForFees(phoneNumberId: string, serverModel?: { wire: string; model: string }, gateway = false): Record<string, unknown> {
  return {
    mode: "live", tickSeconds: 30,
    services: { ...(gateway ? { payments: {} } : {}), ...(phoneNumberId !== "" ? { messaging: { phoneNumberId } } : {}), timeoutMs: 20_000 },
    ...(serverModel ? { parser: { wire: serverModel.wire, model: serverModel.model } } : {}),
  };
}
