// The phone setup for a Fees centre: what its two steps take from the form (the centre with its batches, fees and students; then the rules of the month), what they refuse
// in the person's own language, and how they become the settings a builder would write. Languages, accounts and checks are the same steps as Bookings' (setup.ts). The form
// is plain: a few rows for batches, one box with a student on each line, and the numbers. `validateSettings` of the Fees pathway is the last gate on everything.
import { providerById } from "../../modules/payments/providers/index.ts";
import type { Language } from "../../modules/language/languages.ts";
import { batchName, validateSettings } from "../../templates/education/fees/src/settings.ts";
import type { Settings } from "../../templates/education/fees/src/settings.ts";
import { limitLinesOf, limitsOf } from "../../templates/education/fees/report/certificate.ts";
import { payeeProblem, vpaProblem } from "../../modules/payments/providers/index.ts";
import { approversDraftOf, approversFromDraft, newPayment, normalizePhone, PREVIEW_PAYMENT, paymentBlock, paymentFromSettings, paymentModuleOf } from "./setup.ts";
import type { Body, Built, Draft, StepResult } from "./setup.ts";
import type { ShopMeta } from "./shops.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";

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
}

const text = (v: string | undefined, max = 120) => (v ?? "").trim().slice(0, max);
const WHOLE = /^\d{1,9}$/u;
const SIGNED = /^-?\d{1,3}$/u;

const blankBatches = (): FeesForm["batches"] => Array.from({ length: MAX_BATCHES }, () => ({ name: "", fee: "" }));
/** A Fees draft has no use for Bookings' form, but the shared steps read the centre's name from `form.name`, so that is where the name lives. */
const emptyShopForm = (): Draft["form"] => ({ name: "", language: "en", services: [], deposit: "", opens: "", closes: "", days: [] });

/** The settings of the template's example, as the form's starting point: its rules are the template's defaults; the centre, batches and students are the partner's own. */
export function newFeesDraft(id: string, accountId: string, template: Template, example: Settings, now: string): Draft {
  return {
    id, accountId, template: template.id, createdAt: now, editing: false, saved: false,
    form: emptyShopForm(), windowHours: "", primaryLanguage: example.languages[0], otherLanguages: [], ownerLanguage: example.owner.language, ownerNumber: "",
    whatsapp: { businessNumber: "", numberId: "" }, calendar: { id: "" }, gateway: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: 0,
    fees: {
      address: "", batches: blankBatches(), students: "",
      dueDay: String(example.due.day), graceDays: String(example.due.graceDays), lateFee: String(example.lateFeeInr),
      reminderDays: example.reminders.daysFromDue.join(", "), reminderHour: String(example.reminders.hour), reminderMost: String(example.reminders.maxPerMonth),
      partAllowed: example.partPayments.allowed, partMin: String(example.partPayments.minInr), waiver: String(example.waiver.limitInr), refund: String(example.refund.limitInr),
    },
  };
}

/** A draft for a centre that already exists, so changing its settings is the same five steps. */
export function feesDraftFromShop(id: string, accountId: string, templateId: string, shopId: string, s: Settings, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft {
  const first = s.languages[0];
  const batches = blankBatches();
  s.batches.slice(0, MAX_BATCHES).forEach((b, i) => { batches[i] = { name: batchName(b, first), fee: String(b.monthlyFeeInr) }; });
  const students = s.students.map((x) => `${x.name}, ${x.parent}, ${batchName(s.batches.find((b) => b.id === x.batchId) ?? s.batches[0], first)}`).join("\n");
  return {
    id, accountId, template: templateId, createdAt: now, shopId, editing: true, saved: true, form: { ...emptyShopForm(), name: s.name }, windowHours: "",
    primaryLanguage: first, otherLanguages: s.languages.slice(1), ownerLanguage: s.owner.language, ownerNumber: s.owner.whatsapp,
    ...approversDraftOf(s.approvers),
    whatsapp: { businessNumber: meta.whatsapp?.businessNumber ?? "", numberId: String(runtime?.services?.messaging?.phoneNumberId ?? "") },
    calendar: { id: "" }, gateway: { mode: meta.gateway?.mode ?? "live", keyId: meta.gateway?.keyId ?? "" }, payment: paymentFromSettings(s.payment), expectedBookings: "", done: Number.MAX_SAFE_INTEGER,
    fees: {
      address: s.address ?? "", batches, students,
      dueDay: String(s.due.day), graceDays: String(s.due.graceDays), lateFee: String(s.lateFeeInr), reminderDays: s.reminders.daysFromDue.join(", "), reminderHour: String(s.reminders.hour), reminderMost: String(s.reminders.maxPerMonth),
      partAllowed: s.partPayments.allowed, partMin: String(s.partPayments.minInr), waiver: String(s.waiver.limitInr), refund: String(s.refund.limitInr),
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
  draft.fees = { ...feesOf(draft), address, batches, students };
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
  return { problems };
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

/** The form, the languages and the owner become the Fees settings; `validateSettings` is the last word. */
export function buildFeesSettings(draft: Draft, example: Settings): Built {
  const fees = feesOf(draft);
  const languages: Language[] = [draft.primaryLanguage as Language, ...(draft.otherLanguages as Language[])];
  const rows = fees.batches.filter((b) => b.name !== "" && b.fee !== "");
  const ids = idsFrom(rows.map((b) => b.name), "batch");
  const names = (n: string) => Object.fromEntries(languages.map((l) => [l, [n]]));
  const lookup = new Map(rows.map((b, i) => [b.name.toLowerCase(), ids[i]]));
  const students = fees.students.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "").map((line) => {
    const parts = line.split(",").map((p) => p.trim());
    return { name: parts[0], parent: normalizePhone(parts[1] ?? "") ?? parts[1], batch: lookup.get(parts.slice(2).join(",").toLowerCase()) ?? parts.slice(2).join(","), ...(languages.length > 1 ? { language: languages[0] } : {}) };
  });
  const whole = (v: string) => (WHOLE.test(v) ? Number(v) : Number.NaN);
  // The rules step shows the centre's limits before the accounts step has asked for the UPI ID: until it is given, the lines are worked out with a stand-in UPI ID
  // (PREVIEW_PAYMENT; they do not depend on it), never as a gateway centre.
  // The save cannot be reached before the accounts step has checked the UPI ID.
  const upi = !providerById(paymentModuleOf(draft))?.gateway;
  const payment = upi && (vpaProblem(draft.payment?.upiId) !== null || payeeProblem(draft.payment?.payee) !== null) ? PREVIEW_PAYMENT : paymentBlock(draft);
  const raw = {
    name: draft.form.name, ...(fees.address !== "" ? { address: fees.address } : {}), timezone: example.timezone, languages,
    batches: rows.map((b, i) => ({ id: ids[i], names: names(b.name), monthlyFeeInr: whole(b.fee) })),
    students,
    due: { day: whole(fees.dueDay), graceDays: whole(fees.graceDays) }, lateFeeInr: whole(fees.lateFee),
    reminders: { daysFromDue: fees.reminderDays.split(",").map((d) => Number(d.trim())), hour: whole(fees.reminderHour), maxPerMonth: whole(fees.reminderMost) },
    partPayments: { allowed: fees.partAllowed, minInr: fees.partAllowed ? whole(fees.partMin) : Math.min(...rows.map((b) => whole(b.fee)), 100) },
    waiver: { limitInr: whole(fees.waiver) }, refund: { limitInr: whole(fees.refund) },
    payment,
    owner: { whatsapp: draft.ownerNumber, language: draft.ownerLanguage },
    ...approversFromDraft(draft),
  };
  const checked = validateSettings(raw);
  // `raw` is the shape a builder writes (and `shop add --template fees` takes): the checked settings name a student's batch differently.
  return checked.ok ? ({ ok: true, settings: checked.settings as never, raw } as Built) : { ok: false, errors: checked.errors };
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
    services: { ...(gateway ? { payments: {} } : {}), messaging: { phoneNumberId }, timeoutMs: 20_000 },
    ...(serverModel ? { parser: { wire: serverModel.wire, model: serverModel.model } } : {}),
  };
}
