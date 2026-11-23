// Writes the words the Go runtime says to the owner, packed: internal/assistant/words/<lang>.json.gz for each of en, hi, ml, kn, and words/rules.json.gz (the word lists the owner's
// commands are read from). The owner-control alerts to the owner's phones (modules/channels/owner-phones.ts and owner-signin.ts: a new phone, codes made, a phone removed, the
// Operator's request, an owner-number change) are in the same packs, with the moment they carry (`dayAndTime`) described as data.
// Run with node from the repository root:   node go/scripts/gen_words.ts          (add --check to only compare with the committed files)
//
// Why a generator and not a retyped table (an idea taken from HolyArrs, ideas only: no code of theirs is used): the owner's words are written once, in TypeScript
// (modules/assistant/words*.ts and modules/listings/words.ts, in four languages), and the Go runtime must say the same thing byte for byte. So each message is RENDERED here by the
// real `write()` / `cardQuestion()` / LISTING_WORDS functions, with sentinel values where a shop's own values go (a title, a count, a date); a sentinel becomes a `{name}` slot and the
// Go side only substitutes. Nothing the owner reads is typed twice, and the test `words-fresh` (templates/commerce/listings/contract/words-fresh.test.ts) fails when a committed file
// is out of date with the TypeScript.
//
// Packed: each language is its own gzip file (stdlib compress/gzip on the Go side), embedded with go:embed and unpacked the FIRST time a shop needs that language (one copy per
// process per language, not per shop).
//
// The three formatters Go must own are described here as data, not code: the weekday and month names and the order of the date (`date`), the 24 forms of a time of day (`time`,
// the day-part words of each hour), and the rupee grouping Go writes itself (en-IN: 12,34,567; proved against Node's own in the Go tests).
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { write, cardQuestion, CARD_LABELS, Writer } from "../../modules/assistant/words.ts";
import { checkText } from "../../modules/language/check.ts";
import { limitCardLine, limitLine, NOT_TIGHTER_REFUSAL } from "../../modules/assistant/limits-card.ts";
import type { LimitView } from "../../modules/assistant/limits-card.ts";
import type { MessageData, MessageId } from "../../modules/assistant/words.ts";
import { LISTING_WORDS } from "../../modules/listings/words.ts";
import { DAY_FEATURES } from "../../modules/assistant/words-budget.ts";
import { NOTE_LABELS } from "../../modules/assistant/words-memory.ts";
import { formatDate, formatTime } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { PERSONALITIES } from "../../modules/assistant/personality.ts";
import { CODES_ALERT, NEW_PHONE_ALERT, REMOVED_ALERT, dayAndTime } from "../../modules/channels/owner-phones.ts";
import { OPEN_MY_APP, OWNER_CHANGE_ALERT, REMOVAL_ALERT, SIGNIN_MESSAGE } from "../../modules/channels/owner-signin.ts";
import { KIND_MEANING, OWNER_KINDS, RULES_ONLY, WANT_INSTRUCTIONS, ownerReading } from "../../modules/assistant/intents.ts";
import type { OwnerKind } from "../../modules/assistant/intents.ts";
import { ownerPrompt } from "../../modules/assistant/talk-prompt.ts";
import { MORNING_TEMPLATE_OF, dayFacts, morningFacts, render, templateNameOf } from "../../modules/assistant/templates.ts";
import type { AssistantTemplateId } from "../../modules/assistant/templates.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
export const OUT = join(here, "..", "internal", "assistant", "words");

// A sentinel marks where a value of the shop goes; it is turned into `{name}` after the message is written. The private-use characters never occur in the words themselves.
const S = (name: string): string => `${name}`;
const N = 7654321; // a count: written by the real function as digits, found again and turned into {n}
const KINDS = ["waiting", "money", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator"]; // conversation.ts kindsOf for this shop
const TZ = "Asia/Kolkata";
// The kinds of a Bookings shop's assistant (conversation.ts kindsOf over wire.ts's skills: Bookings, which has day, closeDay and move, the limits and the listings): the help and
// "didn't get that" lines list the examples of these, and the router reads only these. Keys made for this profile end in "@bookings".
const BOOKINGS_KINDS = [...KINDS, "day", "close_day", "reopen_day", "move"];
// The kinds of an Orders shop's assistant (kindsOf over the Orders skill, which has `open`, the limits and the listings). Keys made for this profile end in "@orders"; so do the
// few lines the Orders skill words its own way (words.ts SKILL_ASK and SKILL_REFUSAL "orders": an advance, not a deposit).
const ORDERS_KINDS = [...KINDS, "open_orders"];
// The kinds of a Fees centre's assistant (kindsOf over the Fees skill, which has `owes`, the limits and the listings). Keys made for this profile end in "@fees"; so do the few
// lines the Fees skill words its own way (words.ts SKILL_ASK and SKILL_REFUSAL "fees": a cancel waives a fee's balance, a refund gives back a fee's payment).
const FEES_KINDS = [...KINDS, "owes"];

type Bag = Record<string, string>;

function slots(text: string): string {
  const out = text.replace(/(\w+)/gu, "{$1}").replaceAll(String(N), "{n}");
  if (/[]/u.test(out)) throw new Error(`a sentinel was left in: ${out}`);
  return out;
}

function say<K extends MessageId>(language: Language, id: K, data: MessageData[K]): string {
  return slots(write(id, data, language, TZ).text);
}

// ---- the outgoing check's facts (22 Nov 2026) ----
// conversation.ts runs the outgoing check (language/check.ts checkText) over every line the assistant says, with the facts its Writer noted while the line was written: each
// amount, count, date, time and literal (a name, a reference, an example such as "cancel b-14"). The Go runtime fills the packed words itself, so it needs the facts that are NOT
// one of the shop's values: the literals the words always carry (the examples, "cancel {ref}") and the fixed counts ("the last 24 hours"). Every value the Writer notes while this
// file renders is logged here (the Writer's own methods, wrapped once); `factsOf` keeps, for each key, the logged literals (sentinels turned into {slots}), counts and amounts whose
// text is in that key's words, and proves with the real checkText that the key's words pass with those facts and nothing else. A date, time or slot is always one of the shop's
// values here (the sentinel date and moments); one left in a key's words would be a fixed moment the Go side cannot know, so it stops the generator.
type Noted = { kind: "lit" | "n" | "inr" | "date" | "slot" | "time"; text: string; v: unknown };
let noted: Noted[] = [];
for (const k of ["lit", "n", "inr", "date", "slot", "time"] as const) {
  const proto = Writer.prototype as unknown as Record<string, (v: unknown) => string>;
  const f = proto[k];
  proto[k] = function (this: Writer, v: unknown): string { const t = f.call(this, v); noted.push({ kind: k, text: t, v }); return t; };
}
/** The facts a packed key always carries: literal templates (filled on the Go side with the key's own slot values), fixed counts and fixed amounts. */
type KeyFacts = { l?: string[]; c?: number[]; a?: number[] };
/** Keys that are not lines the assistant says (prompts, names, Meta's value order, the alerts and the sign-in link, which do not go through the assistant's say). */
const NOT_SAID = /^(talk\.system|alert\.|signin\.)|\.(name|order)$/u;
/** The values this file itself makes up to render a shape (a shop called "x", thirteen rows of "b-1"): never facts of a key. */
const FIXTURES = new Set(["x", "y", "b-1", "SHOP"]);
function factsOf(l: Language, m: Bag): Record<string, KeyFacts> {
  const lits = [...new Set(noted.filter((x) => x.kind === "lit" && x.text !== "" && !FIXTURES.has(x.text)).map((x) => slots(x.text)))];
  const counts = [...new Set(noted.filter((x) => x.kind === "n").map((x) => x.v as number))];
  const amounts = [...new Map(noted.filter((x) => x.kind === "inr").map((x) => [x.text, (x.v as number) / 100] as const)).entries()];
  const moments = noted.filter((x) => x.kind === "date" || x.kind === "slot" || x.kind === "time").map((x) => x.text);
  const out: Record<string, KeyFacts> = {};
  const failed: string[] = [];
  for (const key of Object.keys(m).sort()) {
    if (NOT_SAID.test(key)) continue;
    const t = m[key];
    const f: KeyFacts = {};
    const kl = lits.filter((x) => t.includes(x)).sort();
    // a count or an amount is the key's own only where a literal does not already cover its digits ("forget n-3" is a literal, not the count 3)
    let rest = t;
    for (const x of [...kl].sort((a, b) => b.length - a.length)) rest = rest.replaceAll(x, " ");
    const digits = new Set(rest.match(/\d+/gu) ?? []);
    const kc = counts.filter((x) => digits.has(String(x))).sort((a, b) => a - b);
    const ka = amounts.filter(([text]) => rest.includes(text)).map(([, v]) => v).sort((a, b) => a - b);
    if (kl.length) f.l = kl;
    if (kc.length) f.c = kc;
    if (ka.length) f.a = ka;
    for (const mt of moments) if (t.includes(mt)) throw new Error(`${l} ${key}: a fixed moment (${mt}) is in the words; the Go side cannot note it`);
    const r = checkText(t, { language: l, timeZone: TZ, amountsInr: ka, counts: kc, momentsMs: [], links: [], literals: kl });
    if (!r.ok) failed.push(`${l} ${key}: ${r.problems.join(" ")}`);
    if (Object.keys(f).length) out[key] = f;
  }
  if (failed.length) throw new Error(`the outgoing check refuses these words with their own facts:\n${failed.join("\n")}`);
  return out;
}

/**
 * `dayAndTime` (owner-phones.ts: "28 Nov, 3:29 pm", India's time) as data, from Intl's own parts: each month's short name, and for each hour of the day the whole moment with
 * {d} (the day), {mon} (the month) and {mm} (the minute, two digits) as slots, so the order and every literal (the comma, the space before am/pm, which Intl may make a narrow
 * no-break space) are Intl's. Checked here against Intl on every month, every hour and several days and minutes: a locale this data cannot reproduce stops the generator.
 */
function stampOf(l: Language): { months: string[]; hours: Bag } {
  const LOCALE: Record<Language, string> = { en: "en-IN", hi: "hi-IN", ml: "ml-IN", kn: "kn-IN" };
  const f = new Intl.DateTimeFormat(LOCALE[l], { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const IST = 330 * 60_000;
  const at = (month: number, day: number, hour: number, minute: number): number => Date.UTC(2026, month - 1, day, hour, minute) - IST;
  const months: string[] = [];
  for (let mo = 1; mo <= 12; mo++) months.push(f.formatToParts(at(mo, 28, 9, 59)).find((p) => p.type === "month")!.value);
  const hours: Bag = {};
  for (let h = 0; h < 24; h++) {
    hours[String(h)] = f.formatToParts(at(11, 28, h, 59)).map((p) => (p.type === "day" ? "{d}" : p.type === "month" ? "{mon}" : p.type === "minute" ? "{mm}" : p.value)).join("");
  }
  for (let mo = 1; mo <= 12; mo++) for (let h = 0; h < 24; h++) for (const d of [1, 9, 28]) for (const min of [0, 7, 59]) {
    const want = f.format(at(mo, d, h, min));
    const got = hours[String(h)].replace("{d}", String(d)).replace("{mon}", months[mo - 1]).replace("{mm}", String(min).padStart(2, "0"));
    if (got !== want) throw new Error(`dayAndTime in ${l} is not reproduced: ${got} for ${want}`);
    if (want !== dayAndTime(at(mo, d, h, min), l)) throw new Error(`owner-phones.ts dayAndTime no longer writes this format (${l}): update stampOf to match it`);
  }
  return { months, hours };
}

/** The owner-control alerts of one language: each rendered by the real function, the moment found again and turned into {at}, the label and the Operator's name as slots. */
function alerts(l: Language, m: Bag): void {
  const AT = Date.UTC(2026, 10, 28, 9, 59); // 28 Nov, 3:29 pm in India: a moment whose text is found once in each alert
  const atText = dayAndTime(AT, l);
  const withAt = (text: string): string => { if (!text.includes(atText)) throw new Error(`the moment is not in: ${text}`); return slots(text.replaceAll(atText, "{at}")); };
  // a label is optional: TypeScript leaves out " (label)" when there is none, so each alert has both forms
  for (const [key, f] of [["new_phone", NEW_PHONE_ALERT], ["codes_made", CODES_ALERT], ["phone_removed", REMOVED_ALERT]] as const) {
    m[`alert.${key}`] = withAt(f(AT, "")[l]);
    m[`alert.${key}.label`] = withAt(f(AT, S("label"))[l]);
  }
  // the Operator's request names who asked, or "Your Operator" when the panel's file names nobody
  m["alert.removal_asked"] = slots(REMOVAL_ALERT("")[l]);
  m["alert.removal_asked.by"] = slots(REMOVAL_ALERT(S("by"))[l]);
  m["alert.owner_change_asked"] = slots(OWNER_CHANGE_ALERT[l]);
  // the sign-in link sent in the owner's open WhatsApp window (owner-signin.ts SIGNIN_MESSAGE)
  m["signin.link"] = slots(SIGNIN_MESSAGE[l](S("shop"), S("link")));
}

/** One language's messages. */
function messages(l: Language): { m: Bag; cat: Bag; stamp: { months: string[]; hours: Bag }; f: Record<string, KeyFacts> } {
  const m: Bag = {};
  noted = [];
  const D = { year: 2026, month: 11, day: 18 }; // a date to be found again in the text and turned into {date}
  const dateText = formatDate(D, l);
  const withDate = (text: string): string => { if (!text.includes(dateText)) throw new Error(`the date is not in: ${text}`); return text.replaceAll(dateText, "{date}"); };
  for (const p of PERSONALITIES) {
    m[`help.${p}.plain`] = say(l, "help", { shop: S("shop"), kinds: KINDS, personality: p });
    m[`help.${p}.named`] = say(l, "help", { name: S("name"), shop: S("shop"), kinds: KINDS, personality: p });
  }
  m.not_understood = say(l, "not_understood", { kinds: KINDS });
  for (const id of ["undo_none", "card_unknown", "card_closed", "card_expired", "card_changed", "refused", "not_offered", "leave_file_asked", "leave_file_again", "leave_operator_asked", "leave_operator_again"] as const) m[id] = say(l, id, {} as never);
  m.limit_which = say(l, "limit", { what: "which", limits: [] });
  for (const why of ["no_case", "not_live", "not_here", "not_yours"] as const) m[`refusal.${why}`] = say(l, "refusal", { why, ref: S("ref") });
  for (const kind of ["cancel", "refund", "message"] as const) m[`need_ref.${kind}`] = say(l, "need_ref", { kind, rows: [] });
  m.need_words = say(l, "need_words", { ref: S("ref") });
  m["waiting_head.zero"] = say(l, "waiting_head", { count: 0 });
  m["waiting_head.n"] = say(l, "waiting_head", { count: N });
  m["money_in.zero"] = withDate(say(l, "money_in", { date: D, paise: 0, payments: 0 }));
  const some = withDate(say(l, "money_in", { date: D, paise: 12345600, payments: N }));
  if (!some.includes("₹1,23,456")) throw new Error(`the amount is not in: ${some}`);
  m["money_in.some"] = some.replace("₹1,23,456", "{inr}");
  m["talk_fallback"] = say(l, "talk_fallback", { waiting: N });
  // with a skill that has a day (Bookings): "Today: T." before what waits; the day's count is another number, found again and turned into {today}
  const TODAY = 7654320;
  const withToday = say(l, "talk_fallback", { waiting: N, today: TODAY });
  if (!withToday.includes(String(TODAY))) throw new Error(`the day's count is not in: ${withToday}`);
  m["talk_fallback.today"] = withToday.replace(String(TODAY), "{today}");
  // a note the talk proposes, in each audience, with its Remember / No buttons (notes.ts proposeNote, NOTE_LABELS), and the line after No
  for (const audience of ["owner", "everyone"] as const) m[`note_proposal.${audience}`] = say(l, "note_proposal", { text: S("text"), audience });
  m.note_declined = say(l, "note_declined", {});
  m["label.note.yes"] = NOTE_LABELS[l].yes; m["label.note.no"] = NOTE_LABELS[l].no;
  // the shop's memory (words-memory.ts): a saved note in each audience, with and without the undo hint; the list as its head, one line per audience and its foot
  for (const audience of ["owner", "everyone"] as const) for (const undoable of [true, false]) m[`note_saved.${audience}.${undoable ? "undo" : "plain"}`] = say(l, "note_saved", { id: S("id"), text: S("text"), audience, undoable });
  for (const id of ["note_forgotten", "note_undone", "note_unknown"] as const) m[id] = say(l, id, { id: S("id") });
  m.note_full = say(l, "note_full", { max: N });
  m.note_too_long = say(l, "note_too_long", { max: N });
  m.note_need_words = say(l, "note_need_words", {});
  m["notes_list.zero"] = say(l, "notes_list", { notes: [] });
  // N notes, of which the two shown are one of each audience: the list's own map is called on these two, so each line's form is the real function's
  const two = [{ id: S("id"), text: S("text"), kind: "fact", audience: "owner" as const }, { id: S("id"), text: S("text"), kind: "public", audience: "everyone" as const }];
  const listed = say(l, "notes_list", { notes: { length: N, map: (f: (n: unknown) => string) => two.map(f) } as never }).split("\n");
  if (listed.length !== 4) throw new Error(`the notes list is not head, two lines and foot: ${listed.join(" / ")}`);
  [m["notes_list.head"], m["notes_list.line.owner"], m["notes_list.line.everyone"], m["notes_list.foot"]] = listed;
  // the listing lines
  for (const line of ["published", "confirmed", "sold"] as const) m[`listing_line.${line}`] = say(l, "listing_line", { line, title: S("title") });
  for (const line of ["dropped", "need_model", "need_photo", "unknown", "gone", "model_failed"] as const) m[`listing_line.${line}`] = say(l, "listing_line", { line });
  for (const why of ["protected_animal", "health_claim", "health", "price_not_in_words", "numbers", "claims", "full", "too_many_drafts", "too_long", "bad_price", "bad_qty", "bad_category", "bad_place", "too_many_photos", "no_such_listing", "not_live", "not_a_draft", "no_model", "model_failed", "empty"] as const) {
    m[`listing_refused.${why}`] = say(l, "listing_line", { line: "refused", why, animal: S("animal"), max: N } as never);
  }
  // the model budget's lines
  const back = { year: 2026, month: 12, day: 1 };
  const backText = formatDate(back, l);
  for (const line of ["warn", "full", "listing_month"] as const) {
    const t = say(l, "budget_line", { line, backOn: back });
    if (!t.includes(backText)) throw new Error(`the date is not in: ${t}`);
    m[`budget.${line}`] = t.replaceAll(backText, "{date}");
  }
  for (const feature of DAY_FEATURES) m[`budget.day.${feature}`] = say(l, "budget_line", { line: "day", feature });
  // "you said no at <time>"
  const at = Date.UTC(2026, 10, 18, 7, 29); // 12:59 in Asia/Kolkata
  const refusedBefore = say(l, "refused_before", { atMs: at });
  const timeText = formatTime({ hour: 12, minute: 59 }, l);
  if (!refusedBefore.includes(timeText)) throw new Error(`the time is not in: ${refusedBefore}`);
  m.refused_before = refusedBefore.replaceAll(timeText, "{time}");
  // the cards' questions: the real cardQuestion with the skill "listings"
  const cardBase = { skill: "listings", ref: S("case"), code: "", hasNo: true };
  m["card.listing.ask"] = slots(cardQuestion({ ...cardBase, kind: "listing", who: S("who"), what: S("title"), amountPaise: 0 }, l, TZ));
  const priced = slots(cardQuestion({ ...cardBase, kind: "listing", who: S("who"), what: S("title"), amountPaise: 12345600, words: S("words") }, l, TZ));
  const priceText = `₹1,23,456 {words}`;
  if (!priced.includes(priceText)) throw new Error(`the price is not in: ${priced}`);
  m["card.listing.priced"] = priced.replace(priceText, "{price}");
  m["card.listing_ask"] = slots(cardQuestion({ ...cardBase, kind: "listing_ask", who: "", what: S("title"), amountPaise: 0 }, l, TZ));
  // dates and times are not here: the Go runtimes write them with internal/language/formats.json (gen_bookings_words.ts), one table for every template
  const cat: Bag = {};
  for (const [k, v] of Object.entries(LISTING_WORDS[l].categories)) cat[k] = v;
  // the owner's talk: the system prompt (talk-prompt.ts ownerPrompt) for each personality, with and without the character's name; the sources' lines are a slot (no sources: "(none)")
  for (const p of PERSONALITIES) for (const named of [true, false]) {
    const shop = { name: S("shop"), character: { ...(named ? { name: S("name") } : {}), personality: p } };
    const { system } = ownerPrompt({ shop, language: l, sources: [{ id: "SRC", kind: "note", text: "SRC" }], limits: [] });
    if (!system.endsWith("\n[SRC] SRC")) throw new Error("the sources are not the prompt's last lines");
    m[`talk.system.${p}.${named ? "named" : "plain"}`] = slots(system.slice(0, -"[SRC] SRC".length)) + "{sources}";
    // the same with the limits the owner may tighten from the chat (a template's shop that declares some): their "id (name)" list, joined with "; ", is the {limits} slot
    const withLimits = ownerPrompt({ shop, language: l, sources: [{ id: "SRC", kind: "note", text: "SRC" }], limits: [{ id: S("lid"), about: S("labout") }] }).system;
    const lim = slots(withLimits.slice(0, -"[SRC] SRC".length));
    if (!lim.includes("{lid} ({labout})")) throw new Error("the limits are not one list in the prompt");
    m[`talk.system.${p}.${named ? "named" : "plain"}.limits`] = lim.replace("{lid} ({labout})", "{limits}") + "{sources}";
  }
  // the morning line (morning.ts, templates.ts): each personality's template filled with slots; "nothing" and the running-low part as morningFacts writes them; the template's name
  for (const p of PERSONALITIES) {
    const id = MORNING_TEMPLATE_OF[p];
    m[`morning.${p}`] = slots(render(id, { language: l, values: { shop: S("shop"), date: S("date"), today: S("today"), money: S("money"), waiting: S("waiting") }, check: undefined as never }));
    m[`morning.${p}.name`] = templateNameOf(id);
    // the order its values go to Meta in, for the approved template outside the owner's window
    const body = m[`morning.${p}`];
    m[`morning.${p}.order`] = ["shop", "date", "today", "money", "waiting"].map((k) => [k, body.indexOf(`{${k}}`)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k).join(",");
  }
  const quiet = morningFacts({ language: l, timeZone: TZ, shop: "x", today: D, parts: [], moneyPaise: 0, waiting: 0 }).values as Bag;
  m["morning.nothing"] = quiet.today;
  m["morning.low"] = slots((morningFacts({ language: l, timeZone: TZ, shop: "x", today: D, parts: [{ low: N }], moneyPaise: 0, waiting: 0 }).values as Bag).today);
  bookingsWords(l, m, D, dateText);
  ordersWords(l, m);
  feesWords(l, m);
  alerts(l, m);
  return { m, cat, stamp: stampOf(l), f: factsOf(l, m) };
}

/**
 * The words of a Bookings shop's assistant (wave 2, step 5): the day's list, closing and opening a day, moving a booking, the cards of a cancel, a refund, a message, an answer
 * to something waiting and a limit, the line under a card, the card's buttons, the "done" lines, every refusal, the limit lines, and the two templates a customer gets about a
 * closed or reopened day. Each is rendered by the real write() / cardQuestion() / limitLine() with sentinels; a message whose shape depends on a list (the day's rows, the
 * customers not reached) is cut into its fixed parts here and joined on the Go side the way words.ts joins them (internal/assistant/bookingwords.go says how).
 */
function bookingsWords(l: Language, m: Bag, D: { year: number; month: number; day: number }, dateText: string): void {
  const withDate = (text: string): string => { if (!text.includes(dateText)) throw new Error(`the date is not in: ${text}`); return text.replaceAll(dateText, "{date}"); };
  // a moment whose time and slot text are found again and turned into {time} / {slot}: 4:05 pm on 18 Nov in India
  const AT = Date.UTC(2026, 10, 18, 10, 35);
  const timeText = formatTime({ hour: 16, minute: 5 }, l);
  const slotText = `${dateText}, ${timeText}`;
  const withSlot = (text: string): string => { if (!text.includes(slotText)) throw new Error(`the slot is not in: ${text}`); return text.replaceAll(slotText, "{slot}"); };
  const withTime = (text: string): string => { if (!text.includes(timeText)) throw new Error(`the time is not in: ${text}`); return text.replaceAll(timeText, "{time}"); };
  const INR = "₹1,23,456";
  const P = 12345600;
  const withInr = (text: string): string => { if (!text.includes(INR)) throw new Error(`the amount is not in: ${text}`); return text.replaceAll(INR, "{inr}"); };
  for (const p of PERSONALITIES) {
    m[`help.${p}.plain@bookings`] = say(l, "help", { shop: S("shop"), kinds: BOOKINGS_KINDS, personality: p });
    m[`help.${p}.named@bookings`] = say(l, "help", { name: S("name"), shop: S("shop"), kinds: BOOKINGS_KINDS, personality: p });
  }
  m["not_understood@bookings"] = say(l, "not_understood", { kinds: BOOKINGS_KINDS });
  // the day's list: none, the head, one row, "and N more", and the closed-day line after it
  m["day_list.none"] = withDate(say(l, "day_list", { date: D, rows: [], closed: false }));
  const closedNone = withDate(say(l, "day_list", { date: D, rows: [], closed: true }));
  if (!closedNone.startsWith(m["day_list.none"])) throw new Error("the closed-day line is not a suffix");
  m["day_list.closed"] = closedNone.slice(m["day_list.none"].length);
  const row = { case: S("case"), startMs: AT, what: S("what"), who: S("who"), state: "confirmed" };
  const one = say(l, "day_list", { date: D, rows: [row], closed: false }).split("\n");
  if (one.length !== 2) throw new Error(`the day's list is not head and row: ${one.join(" / ")}`);
  // the head with one row says "1": the count is the only "1" in it (the date is the 18th)
  m["day_list.head"] = withDate(slots(write("day_list", { date: D, rows: [row], closed: false }, l, TZ).text.split("\n")[0])).replace(/(^|\D)1(\D|$)/u, "$1{n}$2");
  m["day_list.row"] = withTime(one[1]);
  const many = write("day_list", { date: D, rows: Array.from({ length: 13 }, () => ({ ...row, case: "b-1", what: "x", who: "y" })), closed: false }, l, TZ).text.split("\n");
  m["day_list.more"] = many.at(-1)!.replace("1", "{n}");
  // closing a day: no bookings or some, and the ones the message could not reach
  m["closed.zero"] = withDate(say(l, "closed", { date: D, booked: 0, missed: [] }));
  m["closed.n"] = withDate(say(l, "closed", { date: D, booked: N, missed: [] }));
  const missed = withDate(say(l, "closed", { date: D, booked: N, missed: [{ case: S("mcase"), who: S("mwho") }] }));
  if (!missed.includes("{mcase} ({mwho})")) throw new Error(`the missed list is not in: ${missed}`);
  m["closed.n.missed"] = missed.replace("{mcase} ({mwho})", "{missed}");
  for (const id of ["already_closed", "weekday_closed", "not_closed", "past_day"] as const) m[id] = withDate(say(l, id, { date: D }));
  m["reopened.zero"] = withDate(say(l, "reopened", { date: D, told: 0 }));
  m["reopened.n"] = withDate(say(l, "reopened", { date: D, told: N }));
  m["need_ref.move"] = say(l, "need_ref", { kind: "move", rows: [] });
  const refRows = say(l, "need_ref", { kind: "cancel", rows: [row] }).split("\n");
  m["need_ref.row"] = withSlot(refRows[1]);
  for (const kind of ["close_day", "reopen_day"] as const) m[`need_date.${kind}`] = say(l, "need_date", { kind });
  m.need_when = say(l, "need_when", { ref: S("ref") });
  m.moved = withSlot(say(l, "moved", { ref: S("ref"), toMs: AT }));
  m.moved_back = withSlot(say(l, "moved_back", { ref: S("ref"), toMs: AT }));
  for (const why of ["no_case", "not_live", "outside_hours", "taken", "past", "failed"] as const) {
    m[`move_failed.${why}`] = say(l, "move_failed", { ref: S("ref"), why });
    m[`move_failed.${why}.to`] = withSlot(say(l, "move_failed", { ref: S("ref"), why, toMs: AT }));
  }
  // every refusal (the listings shop's four are above; the ones naming a customer say who, or the reference when there is no who)
  for (const why of ["already_back", "cancel_first", "not_booked", "nothing_paid", "nothing_waiting", "amount_not_on_record", "busy", "limit_not_tighter"] as const) m[`refusal.${why}`] = say(l, "refusal", { why, ref: S("ref") });
  m["refusal.too_much"] = withInr(say(l, "refusal", { why: "too_much", ref: S("ref"), paidPaise: P }));
  for (const why of ["no_window", "opted_out"] as const) m[`refusal.${why}`] = say(l, "refusal", { why, ref: S("ref"), who: S("who") });
  if (m["refusal.limit_not_tighter"] !== NOT_TIGHTER_REFUSAL[l]) throw new Error("the not-tighter refusal is not the fixed line");
  // the cards' questions (cardQuestion, the skill "bookings"), the line under every card, and the card's buttons
  const card = { skill: "bookings", who: S("who"), ref: S("ref"), what: S("what"), code: "", hasNo: true };
  m["card.cancel.paid"] = withInr(slots(cardQuestion({ ...card, kind: "cancel", amountPaise: P }, l, TZ)));
  m["card.cancel.free"] = slots(cardQuestion({ ...card, kind: "cancel", amountPaise: 0 }, l, TZ));
  m["card.refund"] = withInr(slots(cardQuestion({ ...card, kind: "refund", amountPaise: P }, l, TZ)));
  m["card.message"] = slots(cardQuestion({ ...card, kind: "message", amountPaise: 0, words: S("words") }, l, TZ));
  m["card.answer"] = withInr(slots(cardQuestion({ ...card, kind: "answer", amountPaise: P }, l, TZ)));
  // "discount" (E1): a price card waiting, for Bookings and Orders alike
  for (const itemKind of ["late_refund", "calendar", "deposit", "refund_owed", "discount"]) m[`card.answer.${itemKind}`] = withInr(slots(cardQuestion({ ...card, kind: "answer", itemKind, amountPaise: P }, l, TZ)));
  // a limit card: the rule with its value is filled on the Go side from limitwords (the rule's {v}), so here the rule is one slot and the value now another
  const lw = { inr: () => S("now"), n: () => S("now"), lit: (t: string) => t };
  const view = (rule: string): LimitView => ({ id: "x", unit: "inr", zeroIsOff: false, name: { en: S("name"), hi: S("name"), ml: S("name"), kn: S("name") }, rule: { en: rule, hi: rule, ml: rule, kn: rule } });
  m["card.limit"] = slots(limitCardLine({ ...view(S("rule")), now: 1, to: 1 }, l, lw));
  const full = (d: Parameters<typeof write<"card">>[1]) => slots(write("card", d, l, TZ).text);
  const foot = (aboveLimit: boolean, hasNo: boolean) => full({ ...card, kind: "cancel", amountPaise: 0, code: S("code"), hasNo, ...(aboveLimit ? { aboveLimit } : {}) }).split("\n")[1];
  m["card.foot.yes"] = foot(false, false);
  m["card.foot.yesno"] = foot(false, true);
  m["card.foot.above.yes"] = foot(true, false);
  m["card.foot.above.yesno"] = foot(true, true);
  const labels = CARD_LABELS[l];
  m["label.approve"] = labels.approve; m["label.refuse"] = labels.refuse; m["label.send"] = labels.send; m["label.dont_send"] = labels.dontSend;
  m["label.listing.show"] = LISTING_WORDS[l].show; m["label.listing.no"] = LISTING_WORDS[l].no; m["label.listing.yes"] = LISTING_WORDS[l].yes; m["label.listing.sold"] = LISTING_WORDS[l].sold;
  // after a tap
  for (const note of ["cancelled", "refund_sent", "held_by_guard", "owed_by_owner", "sent", "answered", "failed", "not_sent"] as const) m[`done.${note}`] = withInrIf(say(l, "done", { note, who: S("who"), ref: S("ref"), amountPaise: P }));
  // the limit lines: the rule (with its value) and the values are slots; the Go side writes a value as limits-card.ts valueText does ("never" for an off big-order amount)
  const seq = (names: string[]) => { let i = 0; return { inr: () => S(names[i++]), n: () => S(names[i++]), lit: (t: string) => t }; };
  m["limit.pending"] = slots(limitLine({ what: "pending", limit: view(S("rule")), to: 1 }, l, seq([])));
  m["limit.active"] = slots(limitLine({ what: "active", limit: view(S("rule")), to: 1 }, l, seq([])));
  m["limit.failed"] = slots(limitLine({ what: "failed", limit: view(S("rule")), from: 1 }, l, seq([])));
  m["limit.not_tighter"] = slots(limitLine({ what: "not_tighter", limit: view(S("rule")), now: 1, to: 2 }, l, seq(["now", "to"])));
  m["limit.need_value.inr"] = slots(limitLine({ what: "need_value", limit: view(S("rule")) }, l, seq([])));
  m["limit.need_value.count"] = slots(limitLine({ what: "need_value", limit: { ...view(S("rule")), unit: "count" } }, l, seq([])));
  m["limit.which.some"] = slots(limitLine({ what: "which", limits: [view(S("rule"))] }, l, { inr: () => "", n: () => "", lit: () => S("names") }));
  m["limit.never"] = slots(limitLine({ what: "active", limit: { ...view("{v}"), zeroIsOff: true }, to: 0 }, l, seq([]))).replace(/^.*?: /u, "").replace(/\.$/u, "");
  m.limit_no = say(l, "limit_no", {});
  m.voice_unheard = say(l, "voice_unheard", {});
  m.owner_words = say(l, "owner_words", { shop: S("shop"), words: S("words") });
  // the two templates a customer gets about a closed or reopened day: the text (the body filled in) and the order its values go to Meta in
  for (const id of ["day_closed", "day_open"] as AssistantTemplateId[]) {
    const facts = dayFacts({ language: l, timeZone: TZ, shop: "SHOP", date: D, startMs: AT });
    const values = { shop: S("shop"), date: S("date"), time: S("time") };
    const text = slots(render(id, { ...facts, values }));
    m[`tmpl.${id}`] = text;
    m[`tmpl.${id}.name`] = templateNameOf(id);
    m[`tmpl.${id}.order`] = ["shop", "date", "time"].map((k) => [k, text.indexOf(`{${k}}`)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k).join(",");
  }
  // the morning line's Bookings part (templates.ts MORNING_PARTS): "bookings: N, the first at T", or "no bookings"
  const withBookings = (morningFacts({ language: l, timeZone: TZ, shop: "x", today: D, parts: [{ bookings: N, firstMs: AT }], moneyPaise: 0, waiting: 0 }).values as Bag).today;
  m["morning.bookings"] = withTime(slots(withBookings));
  m["morning.no_bookings"] = (morningFacts({ language: l, timeZone: TZ, shop: "x", today: D, parts: [{ bookings: 0 }], moneyPaise: 0, waiting: 0 }).values as Bag).today;
  function withInrIf(t: string): string { return t.replaceAll(INR, "{inr}"); }
}

/**
 * The words of an Orders shop's assistant (wave W4): the help and "didn't get that" lines for its kinds, the open orders' list (none, the head, one row, "and N more"), the card
 * that asks about a big order, the Orders skill's own cancel and refund cards and its two refusals, and the morning line's "open orders" part. Each is rendered by the real
 * write() / cardQuestion() / morningFacts() with sentinels, as bookingsWords does; the list is cut into its fixed parts and joined on the Go side as words.ts joins it.
 */
function ordersWords(l: Language, m: Bag): void {
  const INR = "₹1,23,456";
  const P = 12345600;
  const withInr = (text: string): string => { if (!text.includes(INR)) throw new Error(`the amount is not in: ${text}`); return text.replaceAll(INR, "{inr}"); };
  for (const p of PERSONALITIES) {
    m[`help.${p}.plain@orders`] = say(l, "help", { shop: S("shop"), kinds: ORDERS_KINDS, personality: p, skill: "orders" });
    m[`help.${p}.named@orders`] = say(l, "help", { name: S("name"), shop: S("shop"), kinds: ORDERS_KINDS, personality: p, skill: "orders" });
  }
  m["not_understood@orders"] = say(l, "not_understood", { kinds: ORDERS_KINDS, skill: "orders" });
  // "which one?" naming an order (words.ts EXAMPLE_REF), and an order cancelled late: its advance (SKILL_ASK.orders), 23 Nov 2026
  for (const kind of ["cancel", "refund", "message"] as const) m[`need_ref.${kind}@orders`] = say(l, "need_ref", { kind, rows: [], skill: "orders" });
  // the open orders: none, the head and one row, and "and N more" after twelve rows
  m["open_list.none"] = say(l, "open_list", { rows: [] });
  const row = { case: S("case"), who: S("who"), what: S("what"), amountPaise: P, state: "confirmed" };
  const one = write("open_list", { rows: [row] }, l, TZ).text.split("\n");
  if (one.length !== 2) throw new Error(`the open list is not head and row: ${one.join(" / ")}`);
  // the head with one row says "1": the count is the only "1" in it
  m["open_list.head"] = slots(one[0]).replace(/(^|\D)1(\D|$)/u, "$1{n}$2");
  m["open_list.row"] = withInr(slots(one[1]));
  const many = write("open_list", { rows: Array.from({ length: 13 }, () => ({ ...row, case: "b-1", who: "x", what: "y" })) }, l, TZ).text.split("\n");
  m["open_list.more"] = many.at(-1)!.replace("1", "{n}");
  // the cards: a big order to accept (BASE_ASK, any skill), and the Orders skill's own cancel and refund (SKILL_ASK.orders)
  const card = { skill: "orders", who: S("who"), ref: S("ref"), what: S("what"), code: "", hasNo: true };
  m["card.answer.big_order"] = withInr(slots(cardQuestion({ ...card, kind: "answer", itemKind: "big_order", amountPaise: P }, l, TZ)));
  m["card.answer.late_refund@orders"] = withInr(slots(cardQuestion({ ...card, kind: "answer", itemKind: "late_refund", amountPaise: P }, l, TZ)));
  m["card.cancel.paid@orders"] = withInr(slots(cardQuestion({ ...card, kind: "cancel", amountPaise: P }, l, TZ)));
  m["card.cancel.free@orders"] = slots(cardQuestion({ ...card, kind: "cancel", amountPaise: 0 }, l, TZ));
  m["card.refund@orders"] = withInr(slots(cardQuestion({ ...card, kind: "refund", amountPaise: P }, l, TZ)));
  for (const why of ["already_back", "cancel_first"] as const) m[`refusal.${why}@orders`] = say(l, "refusal", { why, ref: S("ref"), skill: "orders" });
  // the morning line's Orders part (templates.ts MORNING_PARTS `open`): "open orders: N" (none is the "nothing" word, morning.nothing)
  m["morning.open"] = slots((morningFacts({ language: l, timeZone: TZ, shop: "x", today: { year: 2026, month: 11, day: 18 }, parts: [{ open: N }], moneyPaise: 0, waiting: 0 }).values as Bag).today);
}

/**
 * The words of a Fees centre's assistant (23 Nov 2026): the help and "didn't get that" lines for its kinds, who owes (none, the head, one row, "and N more"), the cards that
 * answer a waiver or a refund a parent asked for (BASE_ASK, any skill), the Fees skill's own cancel and refund cards and its two refusals (SKILL_ASK.fees, SKILL_REFUSAL.fees),
 * and the morning line's "fees not paid" part. Each is rendered by the real write() / cardQuestion() / morningFacts() with sentinels, as ordersWords does.
 */
function feesWords(l: Language, m: Bag): void {
  const INR = "₹1,23,456";
  const P = 12345600;
  const withInr = (text: string): string => { if (!text.includes(INR)) throw new Error(`the amount is not in: ${text}`); return text.replaceAll(INR, "{inr}"); };
  for (const p of PERSONALITIES) {
    m[`help.${p}.plain@fees`] = say(l, "help", { shop: S("shop"), kinds: FEES_KINDS, personality: p, skill: "fees" });
    m[`help.${p}.named@fees`] = say(l, "help", { name: S("name"), shop: S("shop"), kinds: FEES_KINDS, personality: p, skill: "fees" });
  }
  m["not_understood@fees"] = say(l, "not_understood", { kinds: FEES_KINDS, skill: "fees" });
  for (const kind of ["cancel", "refund", "message"] as const) m[`need_ref.${kind}@fees`] = say(l, "need_ref", { kind, rows: [], skill: "fees" });
  // who owes: none, the head and one row, and "and N more" after twelve rows (words.ts owes_list, oweRow)
  m["owes_list.none"] = say(l, "owes_list", { rows: [] });
  const row = { case: S("case"), who: S("who"), what: S("what"), amountPaise: P };
  const one = write("owes_list", { rows: [row] }, l, TZ).text.split("\n");
  if (one.length !== 2) throw new Error(`the owes list is not head and row: ${one.join(" / ")}`);
  // the head with one row says "1": the count is the only "1" in it
  m["owes_list.head"] = slots(one[0]).replace(/(^|\D)1(\D|$)/u, "$1{n}$2");
  m["owes_list.row"] = withInr(slots(one[1]));
  const many = write("owes_list", { rows: Array.from({ length: 13 }, () => ({ ...row, case: "b-1", who: "x", what: "y" })) }, l, TZ).text.split("\n");
  m["owes_list.more"] = many.at(-1)!.replace("1", "{n}");
  // the cards: a waiver or a refund a parent asked for, waiting for the owner (BASE_ASK, any skill), and the Fees skill's own cancel and refund (SKILL_ASK.fees)
  const card = { skill: "fees", who: S("who"), ref: S("ref"), what: S("what"), code: "", hasNo: true };
  for (const itemKind of ["waiver", "refund_request"]) m[`card.answer.${itemKind}`] = withInr(slots(cardQuestion({ ...card, kind: "answer", itemKind, amountPaise: P }, l, TZ)));
  m["card.cancel.paid@fees"] = withInr(slots(cardQuestion({ ...card, kind: "cancel", amountPaise: P }, l, TZ)));
  m["card.cancel.free@fees"] = slots(cardQuestion({ ...card, kind: "cancel", amountPaise: 0 }, l, TZ));
  m["card.refund@fees"] = withInr(slots(cardQuestion({ ...card, kind: "refund", amountPaise: P }, l, TZ)));
  for (const why of ["already_back", "cancel_first"] as const) m[`refusal.${why}@fees`] = say(l, "refusal", { why, ref: S("ref"), skill: "fees" });
  // the morning line's Fees part (templates.ts MORNING_PARTS `owes`): "fees not paid: N (₹X)" (none is the "nothing" word, morning.nothing)
  m["morning.owes"] = withInr(slots((morningFacts({ language: l, timeZone: TZ, shop: "x", today: { year: 2026, month: 11, day: 18 }, parts: [{ owes: N, owedPaise: P }], moneyPaise: 0, waiting: 0 }).values as Bag).today));
}

/** The word lists the rules read the owner's commands from, taken out of the TypeScript source (they are `const`s that are not exported, and the TypeScript is not changed for this). */
function listAfter(src: string, marker: string, end: string): string[] {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${marker} not found`);
  const from = src.indexOf("[", at + marker.length - 1);
  const to = src.indexOf(end, from);
  return new Function(`return ${src.slice(from, to + 2)}`)() as string[];
}

function rules(): unknown {
  // the kinds' and the dates' patterns are not lists here: go/scripts/gen_patterns.ts hands the Go runtime the TypeScript's built patterns themselves
  const leave = readFileSync(join(ROOT, "modules", "assistant", "intents-leave.ts"), "utf8");
  const memory = readFileSync(join(ROOT, "modules", "assistant", "intents-memory.ts"), "utf8");
  // the router's reading of the owner's words for this shop's kinds (intents.ts ownerReading): the language model's prompt and schema, and the decision model's question
  const routerOf = (kinds: string[]) => {
    const context = { kinds: kinds as OwnerKind[] };
    const offered = OWNER_KINDS.filter((k) => kinds.includes(k) && !RULES_ONLY.includes(k));
    return { prompt: ownerReading.prompt(context), schema: ownerReading.schema(context), instructions: WANT_INSTRUCTIONS, criteria: offered.map((k) => [k, KIND_MEANING[k as Exclude<OwnerKind, "unknown">]]) };
  };
  // the words that make a sentence a rule about a limit (limits-card.ts PHRASING, a const that is not exported): its word list, taken out of the source
  const limitsCard = readFileSync(join(ROOT, "modules", "assistant", "limits-card.ts"), "utf8");
  const phrasingAt = limitsCard.indexOf("const PHRASING = wordRe([") + "const PHRASING = wordRe(".length;
  const phrasing = new Function(`return ${limitsCard.slice(phrasingAt, limitsCard.indexOf('], "iu")', phrasingAt) + 1)}`)() as string[];
  return {
    router: routerOf(KINDS),
    kindsBookings: BOOKINGS_KINDS,
    limitPhrasing: phrasing,
    // the same reading for a Bookings shop's kinds (BOOKINGS_KINDS)
    routerBookings: routerOf(BOOKINGS_KINDS),
    // and for an Orders shop's (ORDERS_KINDS)
    kindsOrders: ORDERS_KINDS,
    routerOrders: routerOf(ORDERS_KINDS),
    // and for a Fees centre's (FEES_KINDS)
    kindsFees: FEES_KINDS,
    routerFees: routerOf(FEES_KINDS),
    talkSchema: ownerPrompt({ shop: { name: "x" }, language: "en", sources: [], limits: [] }).schema,
    // the schema with declared limits: the limit's enum holds "{id}", which the Go side replaces with the declared ids in their order
    // the owner's "open my app" on WhatsApp (owner-signin.ts OPEN_MY_APP, compared after phraseOf)
    openMyApp: OPEN_MY_APP,
    talkSchemaLimits: ownerPrompt({ shop: { name: "x" }, language: "en", sources: [], limits: [{ id: "{id}", about: "x" }] }).schema,
    leaveFile: listAfter(leave, "const FILE = new RegExp([", "\n].join"),
    leaveOperator: listAfter(leave, "const OPERATOR = new RegExp([", "\n].join"),
    remember: new Function(`return ${memory.slice(memory.indexOf("const REMEMBER = [") + "const REMEMBER = ".length, memory.indexOf("].join", memory.indexOf("const REMEMBER")) + 1)}`)() as string[],
    list: listAfter(memory, "const LIST = new RegExp([", "\n].join"),
  };
}

/** Every packed file as its uncompressed text, by file name. */
export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of LANGUAGES) out.set(`${l}.json`, JSON.stringify(messages(l)) + "\n");
  out.set("rules.json", JSON.stringify(rules()) + "\n");
  return out;
}

/** The packed files in `dir` that are out of date: the unpacked text differs from a fresh render (the gzip bytes may differ between zlib versions, so the text is what is compared). */
export function staleFiles(dir: string, files = generate()): string[] {
  const stale: string[] = [];
  for (const [name, text] of files) {
    let have = "";
    try { have = gunzipSync(readFileSync(join(dir, `${name}.gz`))).toString("utf8"); } catch { /* missing */ }
    if (have !== text) stale.push(name);
  }
  return stale;
}

if (import.meta.main) {
  const files = generate();
  if (process.argv.includes("--check")) {
    const stale = staleFiles(OUT, files);
    for (const name of stale) console.error(`stale: ${name}.gz`);
    process.exitCode = stale.length ? 1 : 0;
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of files) writeFileSync(join(OUT, `${name}.gz`), gzipSync(Buffer.from(text), { level: 9, mtime: 0 } as never));
    console.log(`wrote ${files.size} files to ${OUT}`);
  }
}
