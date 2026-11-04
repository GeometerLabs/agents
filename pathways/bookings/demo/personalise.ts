// Making the demo about THIS shop in 30 seconds: a small form (name, services with prices, deposit, hours, language)
// becomes a settings object, and the existing validation says what is wrong in its own plain words.
// The form never reaches past the settings: the agent, the rules and the stand-ins are untouched.
import { WEEKDAY_KEYS, serviceName, validateSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Service, Settings, SettingsResult } from "../src/settings.ts";
import type { Language } from "../../../modules/language/languages.ts";

export const MAX_SERVICES = 4;
const MAX_TEXT = 80;

export interface ServiceRow { id: string; name: string; also: string; price: string; minutes: string }
/** What the form shows and sends back. Every value is text, as typed. */
export interface ShopForm {
  name: string;
  language: string;
  services: ServiceRow[]; // always MAX_SERVICES rows; a row with no name and no price is left out
  deposit: string;
  opens: string;
  closes: string;
  days: boolean[]; // Sunday first
}

/** Every customer language the demo can use (read from LANGUAGES, so new language packs appear on their own). */
export function languageOptions(): { code: string; label: string }[] {
  return LANGUAGES.map((code) => ({ code, label: languageLabel(code) }));
}

function languageLabel(code: string): string {
  try {
    const native = new Intl.DisplayNames([code], { type: "language" }).of(code);
    const english = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return native && english && native.toLowerCase() !== english.toLowerCase() ? `${native} · ${english}` : (english ?? code);
  } catch {
    return code;
  }
}

/** Put one language first (the shop's, and the customer's default) and make sure every service has a name in each language. */
export function applyLanguage(base: Settings, language: string): SettingsResult {
  if (!(LANGUAGES as readonly string[]).includes(language)) {
    return { ok: false, errors: [`The language "${language}" is not one this demo knows. Choose one from the list: ${LANGUAGES.join(", ")}.`] };
  }
  const raw = structuredClone(base) as unknown as Record<string, any>;
  raw.languages = [language, ...LANGUAGES.filter((l) => l !== language)];
  raw.owner = { ...raw.owner, language };
  for (const service of raw.services as Service[]) {
    const known = Object.values(service.names).find((list) => list && list.length > 0);
    for (const l of raw.languages as Language[]) service.names[l] ??= [...(service.names.en ?? known ?? [service.id])];
  }
  return validateSettings(raw);
}

// ---- the form, from the settings --------------------------------------------------------------------------------

/** What a service is called in the form: the name the owner's language uses, then every other way customers say it. */
function rowNames(service: Service, language: string): { name: string; also: string } {
  const name = serviceName(service, language as Language);
  const seen = new Set([name.toLowerCase()]);
  const also: string[] = [];
  for (const list of Object.values(service.names)) {
    for (const n of list ?? []) if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); also.push(n); }
  }
  return { name, also: also.join(", ") };
}

function openingOf(settings: Settings): { opens: string; closes: string; days: boolean[] } {
  const days = WEEKDAY_KEYS.map((k) => settings.openingHours[k] !== null);
  const first = WEEKDAY_KEYS.map((k) => settings.openingHours[k]).find((h) => h !== null);
  return { opens: first?.open ?? "10:00", closes: first?.close ?? "20:00", days };
}

export function formFromSettings(settings: Settings): ShopForm {
  const language = settings.owner.language;
  const services: ServiceRow[] = settings.services.slice(0, MAX_SERVICES).map((s) => ({
    id: s.id, ...rowNames(s, language), price: String(s.priceInr), minutes: String(s.durationMinutes),
  }));
  while (services.length < MAX_SERVICES) services.push({ id: "", name: "", also: "", price: "", minutes: "30" });
  return { name: settings.name, language, services, deposit: String(settings.deposit.amountInr), ...openingOf(settings) };
}

// ---- the settings, from the form ----------------------------------------------------------------------------------

const text = (v: unknown, max = MAX_TEXT) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** "450" becomes 450; anything else stays as typed, so the validation can say what is wrong with it. */
const whole = (v: string): number | string => (/^\d{1,9}$/.test(v) ? Number(v) : v);
const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Build settings from the form on top of the current ones. Nothing is kept from a failed attempt: the caller keeps the old shop. */
export function settingsFromForm(input: unknown, base: Settings): SettingsResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["The form was empty. Fill in the shop's name and at least one service."] };
  const form = input as Record<string, unknown>;
  const language = text(form.language, 12) || base.owner.language;
  const withLanguage = applyLanguage(base, language);
  if (!withLanguage.ok) return withLanguage;
  const current = withLanguage.settings;
  const before = formFromSettings(base);

  const rows = Array.isArray(form.services) ? form.services.slice(0, MAX_SERVICES) : [];
  const taken = new Set<string>();
  const services = rows.flatMap((raw, i) => {
    const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const name = text(r.name);
    const also = text(r.also, 200);
    const price = text(r.price, 12);
    if (name === "" && price === "") return []; // an empty row is simply not used
    const id = text(r.id, 40);
    const old = base.services.find((s) => s.id === id);
    const oldRow = before.services.find((s) => s.id === id);
    const same = old && oldRow && name === oldRow.name && also === oldRow.also;
    // An untouched row keeps all its names (the Hindi ones too); a changed row says the new name in every language.
    const names: Record<string, string[]> = {};
    for (const l of current.languages) names[l] = same ? [...(current.services.find((s) => s.id === id)?.names[l] ?? [])] : [name, ...also.split(",").map((n) => n.trim()).filter(Boolean)];
    let key = same ? id : slug(name) || `service-${i + 1}`;
    while (taken.has(key)) key = `${key}-${i + 1}`;
    taken.add(key);
    return [{ id: key, names, priceInr: whole(price), durationMinutes: whole(text(r.minutes, 6) || "30") }];
  });

  const open = text(form.opens, 5);
  const close = text(form.closes, 5);
  const days = Array.isArray(form.days) ? WEEKDAY_KEYS.map((_, d) => (form.days as unknown[])[d] === true) : before.days;
  const hoursUntouched = open === before.opens && close === before.closes && days.every((d, i) => d === before.days[i]);
  const openingHours = hoursUntouched
    ? current.openingHours
    : Object.fromEntries(WEEKDAY_KEYS.map((k, d) => [k, days[d] ? { open, close } : null]));

  const deposit = text(form.deposit, 12);
  const depositValue = whole(deposit);
  const raw = {
    name: text(form.name),
    timezone: current.timezone,
    languages: current.languages,
    services,
    openingHours,
    slotMinutes: current.slotMinutes,
    bufferMinutes: current.bufferMinutes,
    deposit: { amountInr: depositValue, holdMinutes: current.deposit.holdMinutes },
    // The refund limit is never below the deposit, so a second payment is handed back at once and only late cancellations ask the owner.
    cancellation: { windowHours: current.cancellation.windowHours, refundLimitInr: typeof depositValue === "number" ? Math.max(current.cancellation.refundLimitInr, depositValue) : current.cancellation.refundLimitInr },
    owner: current.owner,
    reminders: current.reminders,
  };
  return validateSettings(raw);
}
