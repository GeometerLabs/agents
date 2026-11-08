// The phone setup for a shop, as plain functions: what each step takes from the form, what it refuses (in the person's language), and how the steps
// become the same client folder a builder would write. The shop form is the demo's (templates/commerce/bookings/demo/personalise.ts), grown into five steps; it is
// not copied. It asks only for what the template's manifest says the template uses, and `validateSettings` is the last gate on everything.
import { validateSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import type { Language } from "../../modules/language/languages.ts";
import { formatInr } from "../../modules/language/format.ts";
import { MAX_SERVICES, formFromSettings, settingsFromForm } from "../../templates/commerce/bookings/demo/personalise.ts";
import type { ShopForm } from "../../templates/commerce/bookings/demo/personalise.ts";
import { normaliseVpa, payeeProblem, vpaProblem } from "../../modules/payments/upi/link.ts";
import type { PaymentSettings } from "../../modules/payments/upi/settings.ts";
import { KEY_ID, checkSecret } from "./secrets.ts";
import type { SecretName } from "./contract.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";
import type { ShopMeta } from "./shops.ts";

export type Body = Record<string, string | undefined>;

export interface Draft {
  id: string;
  accountId: string;
  template: string;
  createdAt: string;
  /** Chosen from the shop's name at step 1 for a new shop; the existing shop's id when editing. */
  shopId?: string;
  editing: boolean;
  saved: boolean;
  form: ShopForm;
  windowHours: string;
  primaryLanguage: string;
  otherLanguages: string[];
  ownerLanguage: string;
  ownerNumber: string;
  /** B37: up to MAX_PANEL_APPROVERS other people who approve refunds, and the amount above which two must. Optional; a draft from before has neither. */
  approvers?: { whatsapp: string; language: string }[];
  twoAboveInr?: string;
  whatsapp: { businessNumber: string; numberId: string };
  calendar: { id: string };
  razorpay: { mode: string; keyId: string };
  /** How customers pay (B33). A draft made before UPI has none, which is a Razorpay shop; a new shop starts on UPI. */
  payment?: PaymentDraft;
  expectedBookings: string;
  /** How many steps have been filled in (0 for a new draft). A later step and the save need the earlier ones. A draft made from an existing shop starts with all of them done. */
  done: number;
}

/** `explicit` is true when the shop's saved settings already carried a "payment" block, so saving them again writes the block back as it was. */
export interface PaymentDraft { module: "upi" | "razorpay"; upiId: string; payee: string; explicit?: boolean }

/** The module a draft takes: no choice recorded is a Razorpay shop, as every shop was before UPI. */
export const paymentModuleOf = (d: Draft): "upi" | "razorpay" => d.payment?.module ?? "razorpay";

/** A new shop starts on UPI (no gateway account, no gateway fee). */
export const newPayment = (): PaymentDraft => ({ module: "upi", upiId: "", payee: "" });

/** The draft of a shop that exists: its payment block when it has one, else Razorpay. */
export function paymentFromSettings(p: PaymentSettings | undefined): PaymentDraft {
  return p?.module === "upi" ? { module: "upi", upiId: p.upi.id, payee: p.upi.payee, explicit: true } : { module: "razorpay", upiId: "", payee: "", ...(p ? { explicit: true } : {}) };
}

/** The "payment" block the settings get, or undefined when they should not carry one (a Razorpay shop whose settings never did). `always` writes the Razorpay block too (Fees does). */
export function paymentBlock(d: Draft, always = false): PaymentSettings | undefined {
  const p = d.payment;
  if (p?.module === "upi") return { module: "upi", upi: { id: normaliseVpa(p.upiId), payee: p.payee.trim() } };
  return always || p?.explicit ? { module: "razorpay" } : undefined;
}

/** What the example settings of the template say, as the form's starting point. */
export function newDraft(id: string, accountId: string, template: Template, example: Settings, now: string): Draft {
  const form = formFromSettings(example);
  form.name = ""; // a new shop starts with no name and no prices of the example's: the partner writes their own
  form.services = form.services.map(() => ({ id: "", name: "", also: "", price: "", minutes: "30" }));
  form.deposit = "";
  return {
    id, accountId, template: template.id, createdAt: now, editing: false, saved: false, form, windowHours: String(example.cancellation.windowHours),
    primaryLanguage: example.languages[0], otherLanguages: [], ownerLanguage: example.owner.language, ownerNumber: "",
    whatsapp: { businessNumber: "", numberId: "" }, calendar: { id: "" }, razorpay: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: 0,
  };
}

/** A draft for a shop that already exists, so changing its settings is the same five steps. */
export function draftFromShop(id: string, accountId: string, templateId: string, shopId: string, settings: Settings, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft {
  return {
    id, accountId, template: templateId, createdAt: now, shopId, editing: true, saved: true, form: formFromSettings(settings), windowHours: String(settings.cancellation.windowHours),
    primaryLanguage: settings.languages[0], otherLanguages: settings.languages.slice(1), ownerLanguage: settings.owner.language, ownerNumber: settings.owner.whatsapp,
    ...approversDraftOf(settings.approvers),
    whatsapp: { businessNumber: meta.whatsapp?.businessNumber ?? "", numberId: String(runtime?.services?.messaging?.phoneNumberId ?? "") },
    calendar: { id: String(runtime?.services?.calendar?.calendarId ?? "") }, razorpay: { mode: meta.razorpay?.mode ?? "live", keyId: meta.razorpay?.keyId ?? "" },
    payment: paymentFromSettings(settings.payment),
    expectedBookings: meta.expectedBookings === undefined ? "" : String(meta.expectedBookings), done: Number.MAX_SAFE_INTEGER,
  };
}

const text = (v: string | undefined, max = 120) => (v ?? "").trim().slice(0, max);
const WHOLE = /^\d{1,9}$/u;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;
export const digitsOf = (s: string) => s.replace(/\D/gu, "");

/** "98765 43210", "+91 98765 43210", "09876543210", "919876543210" all become "+919876543210". Anything else is not a number we will message. */
export function normalizePhone(input: string): string | undefined {
  const raw = input.trim().replace(/[\s().-]/gu, "");
  if (/^\+\d{10,15}$/u.test(raw)) return raw;
  if (/^[6-9]\d{9}$/u.test(raw)) return `+91${raw}`;
  if (/^0[6-9]\d{9}$/u.test(raw)) return `+91${raw.slice(1)}`;
  if (/^91[6-9]\d{9}$/u.test(raw)) return `+${raw}`;
  return undefined;
}

export type StepResult = { problems: string[] };

// ---- step 1: the business ----------------------------------------------------------------------------------------------------------

export function applyBusiness(draft: Draft, body: Body, w: Words): StepResult {
  const s = w.setup.problems;
  const problems: string[] = [];
  const name = text(body.name, 80);
  const services = Array.from({ length: MAX_SERVICES }, (_, i) => ({
    id: text(body[`svc_id_${i}`], 40), name: text(body[`svc_name_${i}`], 80), also: text(body[`svc_also_${i}`], 200), price: text(body[`svc_price_${i}`], 12), minutes: text(body[`svc_minutes_${i}`], 6) || "30",
  }));
  if (name === "") problems.push(s.nameEmpty);
  let used = 0;
  services.forEach((r, i) => {
    if (r.name === "" && r.price === "") return;
    used++;
    if (r.name === "") problems.push(s.serviceNameEmpty(i + 1));
    if (!WHOLE.test(r.price) || Number(r.price) < 1) problems.push(s.priceBad(i + 1));
  });
  if (used === 0) problems.push(s.noService);
  const opens = text(body.opens, 5);
  const closes = text(body.closes, 5);
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => body[`day_${d}`] === "on");
  if (!CLOCK.test(opens) || !CLOCK.test(closes) || opens >= closes) problems.push(s.hoursBad);
  if (!days.some(Boolean)) problems.push(s.noDay);
  // Kept even when something is wrong, so the form comes back as it was typed.
  draft.form = { ...draft.form, name, services, opens, closes, days };
  return { problems };
}

// ---- step 2: deposit and cancellation -------------------------------------------------------------------------------------------------

export function applyDeposit(draft: Draft, body: Body, w: Words): StepResult {
  const s = w.setup.problems;
  const problems: string[] = [];
  const deposit = text(body.deposit, 12);
  const window = text(body.window, 4);
  if (!WHOLE.test(deposit) || Number(deposit) < 1) problems.push(s.depositBad);
  else {
    const prices = draft.form.services.filter((r) => WHOLE.test(r.price)).map((r) => Number(r.price));
    const cheapest = prices.length > 0 ? Math.min(...prices) : undefined;
    if (cheapest !== undefined && Number(deposit) > cheapest) problems.push(s.depositTooBig(formatInr(Number(deposit)), formatInr(cheapest)));
  }
  if (!/^\d{1,3}$/u.test(window) || Number(window) > 720) problems.push(s.windowBad);
  draft.form = { ...draft.form, deposit };
  draft.windowHours = window;
  return { problems };
}

// ---- step 3: languages and the owner's number ------------------------------------------------------------------------------------------

export function applyLanguages(draft: Draft, body: Body, w: Words): StepResult {
  const s = w.setup.problems;
  const problems: string[] = [];
  const known = (l: string | undefined) => (LANGUAGES as readonly string[]).includes(l ?? "");
  const primary = text(body.primary, 4);
  if (!known(primary)) problems.push(s.noLanguage);
  const others = LANGUAGES.filter((l) => body[`lang_${l}`] === "on" && l !== primary);
  const ownerLanguage = known(text(body.ownerLanguage, 4)) ? text(body.ownerLanguage, 4) : primary;
  const phone = normalizePhone(text(body.ownerNumber, 30));
  if (!phone) problems.push(s.ownerNumberBad);
  if (phone && draft.whatsapp.businessNumber && digitsOf(phone) === digitsOf(draft.whatsapp.businessNumber)) problems.push(s.sameNumber);
  if (known(primary)) { draft.primaryLanguage = primary; draft.otherLanguages = others; }
  draft.ownerLanguage = known(ownerLanguage) ? ownerLanguage : draft.primaryLanguage;
  draft.ownerNumber = phone ?? text(body.ownerNumber, 30);
  // B37: other people who approve refunds, each from their own phone, and the amount above which two of them must. Both optional.
  const approvers: { whatsapp: string; language: string }[] = [];
  const taken = new Set([phone, draft.whatsapp.businessNumber].filter((n): n is string => !!n).map(digitsOf));
  for (let i = 0; i < MAX_PANEL_APPROVERS; i++) {
    const given = text(body[`approver_${i}`], 30);
    if (given === "") continue;
    const number = normalizePhone(given);
    const language = known(text(body[`approverLang_${i}`], 4)) ? text(body[`approverLang_${i}`], 4) : draft.ownerLanguage;
    if (!number) problems.push(s.approverNumberBad(i + 1));
    else if (taken.has(digitsOf(number))) problems.push(s.approverNumberTaken(i + 1));
    else taken.add(digitsOf(number));
    approvers.push({ whatsapp: number ?? given, language });
  }
  const twoAbove = text(body.twoAbove, 9);
  if (twoAbove !== "" && !WHOLE.test(twoAbove)) problems.push(s.twoAboveBad);
  if (twoAbove !== "" && approvers.length === 0) problems.push(s.twoAboveAlone);
  draft.approvers = approvers;
  draft.twoAboveInr = twoAbove;
  return { problems };
}

/** How many other approvers the setup asks for. More can be written in the settings file by hand (modules/approvals/people.ts allows six). */
export const MAX_PANEL_APPROVERS = 2;

/** The approvers part of a draft, from saved settings (so editing a shop shows them). */
export function approversDraftOf(a: Settings["approvers"]): Pick<Draft, "approvers" | "twoAboveInr"> {
  return a ? { approvers: a.people.map((p) => ({ whatsapp: p.whatsapp, language: p.language })), twoAboveInr: a.twoAboveInr === undefined ? "" : String(a.twoAboveInr) } : {};
}

/** The approvers part of the settings, from a draft: each person gets the id `approver-<n>` (a name Guard and the relay can show), in the order given. */
export function approversFromDraft(d: Pick<Draft, "approvers" | "twoAboveInr">): { approvers?: { people: { id: string; whatsapp: string; language: string }[]; twoAboveInr?: number } } {
  const people = (d.approvers ?? []).filter((p) => p.whatsapp !== "").map((p, i) => ({ id: `approver-${i + 1}`, whatsapp: p.whatsapp, language: p.language }));
  if (people.length === 0) return {};
  return { approvers: { people, ...(d.twoAboveInr && WHOLE.test(d.twoAboveInr) ? { twoAboveInr: Number(d.twoAboveInr) } : {}) } };
}

// ---- step 4: the shop's accounts, and the secrets that go with them -----------------------------------------------------------------------

export interface SecretToWrite { name: SecretName; text: string }
export interface AccountsResult extends StepResult { secrets: SecretToWrite[]; clientEmail?: string }

/**
 * Every account the template uses, checked together. A secret left empty is kept if one already arrived (and a changed key id needs its secret
 * again). Nothing is returned for the page to show back: the caller writes `secrets` to the inbox only when `problems` is empty.
 */
export function applyAccounts(draft: Draft, body: Body, template: Template, meta: ShopMeta, calendarShared: boolean, w: Words): AccountsResult {
  const s = w.setup.problems;
  const problems: string[] = [];
  const secrets: SecretToWrite[] = [];
  let clientEmail: string | undefined;
  const label = w.setup.accounts;
  const take = (name: SecretName, value: string | undefined, what: string, required: boolean) => {
    const v = (value ?? "").trim();
    if (v === "") { if (required && meta.receipts[name] === undefined) problems.push(s.secretMissing(what)); return; }
    const checked = checkSecret(name, v);
    if (!checked.ok) { problems.push(name === "google_service_account.json" ? s.jsonBad : s.secretShape(what)); return; }
    secrets.push({ name, text: checked.text });
    if (checked.clientEmail) clientEmail = checked.clientEmail;
  };

  if (template.accounts.includes("whatsapp")) {
    const business = normalizePhone(text(body.waNumber, 30));
    if (!business) problems.push(s.businessNumberBad);
    else if (draft.ownerNumber && digitsOf(business) === digitsOf(draft.ownerNumber)) problems.push(s.sameNumber);
    const numberId = text(body.waNumberId, 30);
    if (!/^\d{6,20}$/u.test(numberId)) problems.push(s.numberIdBad);
    draft.whatsapp = { businessNumber: business ?? text(body.waNumber, 30), numberId };
    take("whatsapp_token", body.waToken, label.whatsapp.token, true);
    take("whatsapp_app_secret", body.waAppSecret, label.whatsapp.appSecret, true);
  }
  if (template.accounts.includes("calendar")) {
    const id = text(body.calId, 200);
    if (id === "" || /[\s/?#]/u.test(id)) problems.push(s.calendarIdBad);
    draft.calendar = { id };
    // A server with its own shared address needs nothing more; without one, the shop's own key file is needed once.
    take("google_service_account.json", body.calJson, label.calendar.json, !calendarShared);
  }
  if (template.accounts.includes("razorpay")) {
    // The choice comes from the form; a form without it (not a browser) is a Razorpay shop, as before UPI existed. Typed UPI boxes are kept when the form is sent back.
    const module = body.payMod === "upi" ? "upi" : "razorpay";
    const before = draft.payment;
    draft.payment = { module, upiId: body.upiId === undefined ? before?.upiId ?? "" : text(body.upiId, 80), payee: body.upiPayee === undefined ? before?.payee ?? "" : text(body.upiPayee, 80), ...(before?.explicit ? { explicit: true } : {}) };
    if (module === "upi") problems.push(...upiProblems(draft.payment.upiId, draft.payment.payee, w));
    else {
      const mode = text(body.rzpMode, 5);
      const keyId = text(body.rzpKeyId, 60);
      if (mode !== "live" && mode !== "test") problems.push(s.modeBad);
      if (!KEY_ID.test(keyId)) problems.push(s.keyIdBad);
      else if ((mode === "live" || mode === "test") && !keyId.startsWith(`rzp_${mode}_`)) problems.push(w.setup.checks.razorpay.wrongMode);
      draft.razorpay = { mode: mode === "test" ? "test" : "live", keyId: KEY_ID.test(keyId) ? keyId : text(body.rzpKeyId, 60) };
      const secret = (body.rzpKeySecret ?? "").trim();
      const keyChanged = meta.razorpay?.keyId !== keyId;
      if (secret === "" && (keyChanged || meta.receipts.razorpay_key === undefined)) problems.push(s.secretMissing(label.razorpay.keySecret));
      else if (secret !== "" && KEY_ID.test(keyId)) {
        const checked = checkSecret("razorpay_key", `${keyId}:${secret}`);
        if (checked.ok) secrets.push({ name: "razorpay_key", text: checked.text }); else problems.push(s.secretShape(label.razorpay.keySecret));
      }
      take("razorpay_webhook_secret", body.rzpWebhook, label.razorpay.webhookSecret, true);
    }
  }
  const expected = text(body.expectedBookings, 6);
  if (expected !== "" && !WHOLE.test(expected)) problems.push(s.expectedBad);
  draft.expectedBookings = WHOLE.test(expected) ? expected : "";
  return { problems, secrets, ...(clientEmail ? { clientEmail } : {}) };
}

/** The shop's UPI ID and payee name, refused in the person's language. The shared checks (modules/payments/upi/link.ts) decide; this only picks the sentence that says why. */
export function upiProblems(id: string, payee: string, w: Words): string[] {
  const u = w.upi.problems;
  const out: string[] = [];
  if (vpaProblem(id) !== null) out.push(id.trim() === "" ? u.idEmpty : !id.includes("@") ? u.idNoAt(id.trim()) : u.idShape(id.trim()));
  if (payeeProblem(payee) !== null) out.push(payee.trim() === "" ? u.payeeEmpty : /[\p{Cc}\n\r\t]/u.test(payee) ? u.payeeOneLine : u.payeeLong);
  return out;
}

// ---- the settings, and the folder ---------------------------------------------------------------------------------------------------------

export type Built = { ok: true; settings: Settings } | { ok: false; errors: string[] };

/** The demo's own form-to-settings, then this step's languages, owner and window on top; validateSettings is the last word. */
export function buildSettings(draft: Draft, example: Settings): Built {
  const first = settingsFromForm({ ...draft.form, language: draft.primaryLanguage }, example);
  if (!first.ok) return first;
  const s = first.settings;
  const deposit = s.deposit.amountInr;
  const languages: Language[] = [draft.primaryLanguage as Language, ...(draft.otherLanguages as Language[])];
  const payment = paymentBlock(draft);
  const raw = {
    ...s,
    ...(payment ? { payment } : {}),
    languages,
    owner: { whatsapp: draft.ownerNumber, language: draft.ownerLanguage },
    ...approversFromDraft(draft),
    cancellation: { windowHours: WHOLE.test(draft.windowHours) ? Number(draft.windowHours) : s.cancellation.windowHours, refundLimitInr: Math.max(example.cancellation.refundLimitInr, deposit) },
  };
  return validateSettings(raw);
}

/** runtime.json: who things are. Where they are (hosts, ports, token files) is the deployer's. */
export function runtimeFor(calendarId: string, phoneNumberId: string, serverModel?: { wire: string; model: string }): Record<string, unknown> {
  return {
    mode: "live", tickSeconds: 30,
    services: { payments: {}, calendar: { calendarId }, messaging: { phoneNumberId }, timeoutMs: 20_000 },
    ...(serverModel ? { parser: { wire: serverModel.wire, model: serverModel.model } } : {}),
  };
}
