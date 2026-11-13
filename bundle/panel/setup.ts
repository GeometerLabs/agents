// The phone setup for a shop, as plain functions: what each step takes from the form, what it refuses (in the person's language), and how the steps
// become the same client folder a builder would write. The shop form is the demo's (templates/commerce/bookings/demo/personalise.ts), grown into five steps; it is
// not copied. It asks only for what the template's manifest says the template uses, and `validateSettings` is the last gate on everything.
import { calendarModule, validateSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import type { Language } from "../../modules/language/languages.ts";
import { formatInr } from "../../modules/language/format.ts";
import { MAX_SERVICES, formFromSettings, settingsFromForm } from "../../templates/commerce/bookings/demo/personalise.ts";
import type { ShopForm } from "../../templates/commerce/bookings/demo/personalise.ts";
import { normaliseVpa, payeeProblem, vpaProblem } from "../../modules/payments/providers/index.ts";
import type { PaymentSettings } from "../../modules/payments/providers/index.ts";
import { checkSecret } from "./secrets.ts";
import { GUPSHUP_APP_NAME } from "../../modules/messaging/gupshup-selfserve.ts";
import { DEFAULT_PROVIDER, gatewayOf, ownerMarkedOf, providerById } from "../../modules/payments/providers/index.ts";
import type { SecretName } from "./contract.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";
import type { ShopMeta } from "./shops.ts";
import type { CharacterDraft } from "./character.ts";

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
  /** Item 11c: `provider` "gupshup-selfserve" means the shop's own Gupshup account (with its `appName`); left out is Meta direct, as before. A draft from before has neither. */
  whatsapp: { businessNumber: string; numberId: string; provider?: "gupshup-selfserve"; appName?: string };
  /** B72: `use` is "own" (the shop's own booking list, the default) or "google" (a Google Calendar, which needs `id`). A draft saved before 12 Nov has no `use`: read as "own" for a new shop. */
  calendar: { id: string; use?: "own" | "google" };
  /** B71: the gateway key as typed, for a shop that chose a gateway: its mode and id. */
  gateway: { mode: string; keyId: string };
  /** How customers pay (B33). A new shop starts on UPI, and a draft with none is a UPI shop that has not given its UPI ID yet (B71): never a gateway shop. */
  payment?: PaymentDraft;
  expectedBookings: string;
  /** How many steps have been filled in (0 for a new draft). A later step and the save need the earlier ones. A draft made from an existing shop starts with all of them done. */
  done: number;
  /** Item 11i: the Character step's choices (character.ts). Made when the step is first shown; a draft from before has none. */
  character?: CharacterDraft;
}

/** The module is a provider's id (modules/payments/providers): UPI's ID and payee are kept here, a gateway's key in `Draft.gateway`. */
export interface PaymentDraft { module: string; upiId: string; payee: string }

/** The module a draft takes. No choice recorded is UPI (B71): the gateway is only ever what the person picked. */
export const paymentModuleOf = (d: Draft): string => d.payment?.module ?? DEFAULT_PROVIDER.id;

/** A new shop starts on UPI (no gateway account, no gateway fee, no paperwork). */
export const newPayment = (): PaymentDraft => ({ module: DEFAULT_PROVIDER.id, upiId: "", payee: "" });

/** The draft of a shop that exists: its payment block, or, with none, UPI with the ID still to give (the accounts step then asks for it, in the person's language). */
export function paymentFromSettings(p: PaymentSettings | undefined): PaymentDraft {
  const owner = ownerMarkedOf(p);
  if (p && owner) return { module: p.module, upiId: owner.payTo.id, payee: owner.payTo.name };
  return p && gatewayOf(p) ? { module: p.module, upiId: "", payee: "" } : newPayment();
}

/**
 * A stand-in UPI block for the limits shown on a step before the accounts step has asked for the real UPI ID (the lines do not depend on it). It is never saved: the save
 * cannot be reached before the accounts step has checked the shop's own UPI ID. It is UPI, not a gateway, so even a preview never shows a shop as on a gateway it did not pick.
 */
export const PREVIEW_PAYMENT: PaymentSettings = { module: "upi", upi: { id: "preview@upi", payee: "Preview" } };

/** The "payment" block the settings get: always written (B71), since a file without one is refused rather than read as a gateway shop. */
export function paymentBlock(d: Draft): PaymentSettings {
  const p = d.payment ?? newPayment();
  if (providerById(p.module)?.gateway) return { module: p.module };
  return { module: DEFAULT_PROVIDER.id, upi: { id: normaliseVpa(p.upiId), payee: p.payee.trim() } };
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
    whatsapp: { businessNumber: "", numberId: "" }, calendar: { id: "", use: "own" }, gateway: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: 0,
  };
}

/**
 * The phone step's draft from a shop that exists: its number, its number id and, for a shop on its own Gupshup account (item 11c), the provider and the app's name, so
 * editing it shows that choice and saving it writes it back (keepWhatsAppProvider). Bookings, Fees and Orders drafts all use this one.
 */
export function whatsappDraftOf(meta: ShopMeta, runtime: Record<string, any> | undefined): Draft["whatsapp"] {
  const m = runtime?.services?.messaging;
  return { businessNumber: meta.whatsapp?.businessNumber ?? "", numberId: String(m?.phoneNumberId ?? ""), ...(m?.provider === "gupshup-selfserve" ? { provider: "gupshup-selfserve" as const, appName: String(m.appName ?? "") } : {}) };
}

/** A draft for a shop that already exists, so changing its settings is the same five steps. */
export function draftFromShop(id: string, accountId: string, templateId: string, shopId: string, settings: Settings, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft {
  return {
    id, accountId, template: templateId, createdAt: now, shopId, editing: true, saved: true, form: formFromSettings(settings), windowHours: String(settings.cancellation.windowHours),
    primaryLanguage: settings.languages[0], otherLanguages: settings.languages.slice(1), ownerLanguage: settings.owner.language, ownerNumber: settings.owner.whatsapp,
    ...approversDraftOf(settings.approvers),
    whatsapp: whatsappDraftOf(meta, runtime),
    calendar: { id: String(runtime?.services?.calendar?.calendarId ?? ""), use: calendarModule(settings) }, gateway: { mode: meta.gateway?.mode ?? "live", keyId: meta.gateway?.keyId ?? "" },
    payment: paymentFromSettings(settings.payment),
    expectedBookings: meta.expectedBookings === undefined ? "" : String(meta.expectedBookings), done: Number.MAX_SAFE_INTEGER,
  };
}

const text = (v: string | undefined, max = 120) => (v ?? "").trim().slice(0, max);
const WHOLE = /^\d{1,9}$/u;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;
// Strips everything but digits, for comparing phone numbers and numeric form fields regardless of spacing or punctuation.
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

// Step 1: takes the business fields from the form into the draft; problems come back in the person's language. The draft keeps what was typed even when there are problems, so the form refills instead of emptying.
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

// Step 2: the deposit and the cancellation window into the draft. A deposit above the cheapest service is refused here because it would make a booking cost less than its deposit.
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

// Step 3: the shop's languages and the owner's WhatsApp number; the owner's number must differ from the business number, or the agent would be messaging itself.
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
export function applyAccounts(draft: Draft, body: Body, template: Template, meta: ShopMeta, calendarShared: boolean, w: Words, lang: Language = "en"): AccountsResult {
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
    if (body.waProvider === "gupshup-selfserve") {
      // Item 11c: the shop's own Gupshup account. Gupshup shows no Meta phone number id, so the number itself stands in for it (generate/shop.ts does the same). The API key and
      // the callback's secret word are write-only, like every key; the token and app secret of Meta are not asked for.
      const appName = text(body.waAppName, 64);
      if (!GUPSHUP_APP_NAME.test(appName)) problems.push(s.appNameBad);
      draft.whatsapp = { businessNumber: business ?? text(body.waNumber, 30), numberId: business ? digitsOf(business) : "", provider: "gupshup-selfserve", appName };
      take("gupshup_apikey", body.waApiKey, label.whatsapp.selfServe.apiKey, true);
      take("whatsapp_path_token", body.waPathToken, label.whatsapp.selfServe.pathToken, true);
    } else {
      const numberId = text(body.waNumberId, 30);
      if (!/^\d{6,20}$/u.test(numberId)) problems.push(s.numberIdBad);
      draft.whatsapp = { businessNumber: business ?? text(body.waNumber, 30), numberId };
      take("whatsapp_token", body.waToken, label.whatsapp.token, true);
      take("whatsapp_app_secret", body.waAppSecret, label.whatsapp.appSecret, true);
    }
  }
  if (template.accounts.includes("calendar")) {
    // B72: the shop's own booking list is the default and asks for nothing. A form that ticks "also use Google Calendar" (calUse=google) must give a calendar id (and the key
    // file, where the server has no shared address). A form without the field (not a browser) is the default.
    const use = body.calUse === "google" ? "google" : "own";
    if (use === "google") {
      const id = text(body.calId, 200);
      if (id === "" || /[\s/?#]/u.test(id)) problems.push(s.calendarIdBad);
      draft.calendar = { id, use };
      // A server with its own shared address needs nothing more; without one, the shop's own key file is needed once.
      take("google_service_account.json", body.calJson, label.calendar.json, !calendarShared);
    } else draft.calendar = { id: "", use };
  }
  if (template.accounts.includes("payment")) {
    // The choice comes from the form: a provider's id. A form without one (not a browser), or with one this checkout does not have, is UPI (B71), so its UPI ID is
    // asked for: a gateway is never picked for anyone. Typed UPI boxes are kept when the form is sent back.
    const chosen = providerById(String(body.payMod ?? ""));
    const module = chosen?.gateway ? chosen : DEFAULT_PROVIDER;
    const before = draft.payment;
    draft.payment = { module: module.id, upiId: body.upiId === undefined ? before?.upiId ?? "" : text(body.upiId, 80), payee: body.upiPayee === undefined ? before?.payee ?? "" : text(body.upiPayee, 80) };
    if (!module.gateway) problems.push(...upiProblems(draft.payment.upiId, draft.payment.payee, w));
    else {
      // a gateway's key, in the shape its own folder says (B71); its words come from the same place
      const setup = module.gateway.setup;
      const words = setup.words[lang];
      const mode = text(body.gwMode, 5);
      const keyId = text(body.gwKeyId, 60);
      if (mode !== "live" && mode !== "test") problems.push(s.modeBad);
      if (!setup.keyId.test(keyId)) problems.push(words.accounts.keyIdBad);
      else if ((mode === "live" || mode === "test") && setup.modeOf(keyId) !== mode) problems.push(words.checks.wrongMode);
      draft.gateway = { mode: mode === "test" ? "test" : "live", keyId: setup.keyId.test(keyId) ? keyId : text(body.gwKeyId, 60) };
      const secret = (body.gwKeySecret ?? "").trim();
      const keyChanged = meta.gateway?.keyId !== keyId || meta.gateway?.provider !== module.id;
      if (secret === "" && (keyChanged || meta.receipts[setup.secrets.key] === undefined)) problems.push(s.secretMissing(words.accounts.keySecret));
      else if (secret !== "" && setup.keyId.test(keyId)) {
        const checked = checkSecret(setup.secrets.key, `${keyId}:${secret}`);
        if (checked.ok) secrets.push({ name: setup.secrets.key, text: checked.text }); else problems.push(s.secretShape(words.accounts.keySecret));
      }
      take(setup.secrets.webhook, body.gwWebhook, words.accounts.webhookSecret, true);
    }
  }
  const expected = text(body.expectedBookings, 6);
  if (expected !== "" && !WHOLE.test(expected)) problems.push(s.expectedBad);
  draft.expectedBookings = WHOLE.test(expected) ? expected : "";
  return { problems, secrets, ...(clientEmail ? { clientEmail } : {}) };
}

/** The shop's UPI ID and payee name, refused in the person's language. The shared checks (modules/payments/providers/upi/link.ts) decide; this only picks the sentence that says why. */
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
  const raw = {
    ...s,
    calendar: { module: draft.calendar?.use === "google" ? "google" : "own" }, // B72
    payment: paymentBlock(draft),
    languages,
    owner: { whatsapp: draft.ownerNumber, language: draft.ownerLanguage },
    ...approversFromDraft(draft),
    cancellation: { windowHours: WHOLE.test(draft.windowHours) ? Number(draft.windowHours) : s.cancellation.windowHours, refundLimitInr: Math.max(example.cancellation.refundLimitInr, deposit) },
  };
  return validateSettings(raw);
}

/**
 * Item 11b: the WhatsApp provider runtime.json already names (`"provider": "gupshup"` and its `appId`), carried into a runtime.json the panel writes again. The panel has
 * no step for it yet (modules/Deferred.md), so a shop moved to Gupshup by hand keeps it when someone edits it here. A runtime.json with no provider is left as made.
 */
export function keepWhatsAppProvider(runtime: Record<string, unknown>, before: unknown, whatsapp?: Draft["whatsapp"]): Record<string, unknown> {
  const services = runtime.services as { messaging: Record<string, unknown> };
  // Item 11c: the setup now has the step for it. A shop whose draft picked its own Gupshup account is written as one; its number is `sourceNumber` (digits, with the country code).
  if (whatsapp?.provider === "gupshup-selfserve") {
    const prior = (before as { services?: { messaging?: { appId?: unknown } } } | undefined)?.services?.messaging;
    return { ...runtime, services: { ...services, messaging: { ...services.messaging, provider: "gupshup-selfserve", appName: whatsapp.appName, sourceNumber: digitsOf(whatsapp.businessNumber), ...(prior?.appId !== undefined ? { appId: prior.appId } : {}) } } };
  }
  const m = (before as { services?: { messaging?: { provider?: unknown; appId?: unknown } } } | undefined)?.services?.messaging;
  // no provider named before, or a self-serve shop whose draft now says Meta direct (the partner switched it on purpose): written as Meta, as made
  if (!m || m.provider === undefined || m.provider === "gupshup-selfserve") return runtime;
  return { ...runtime, services: { ...services, messaging: { ...services.messaging, provider: m.provider, ...(m.appId !== undefined ? { appId: m.appId } : {}) } } };
}

/** runtime.json: who things are. Where they are (hosts, ports, token files) is the deployer's. A payments service is named only for a shop that chose a gateway (B71). */
export function runtimeFor(calendarId: string, phoneNumberId: string, serverModel?: { wire: string; model: string }, gateway = false): Record<string, unknown> {
  return {
    mode: "live", tickSeconds: 30,
    // B72: no calendar id means the shop's own booking list, and runtime.json names no calendar at all
    services: { ...(gateway ? { payments: {} } : {}), ...(calendarId !== "" ? { calendar: { calendarId } } : {}), messaging: { phoneNumberId }, timeoutMs: 20_000 },
    ...(serverModel ? { parser: { wire: serverModel.wire, model: serverModel.model } } : {}),
  };
}
