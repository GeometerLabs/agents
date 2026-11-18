// Writes the words the Go runtime says to the owner, packed: internal/assistant/words/<lang>.json.gz for each of en, hi, ml, kn, and words/rules.json.gz (the word lists the owner's
// commands are read from). Run with node from the repository root:   node go/scripts/gen_words.ts          (add --check to only compare with the committed files)
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
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { write, cardQuestion } from "../../modules/assistant/words.ts";
import type { MessageData, MessageId } from "../../modules/assistant/words.ts";
import { LISTING_WORDS } from "../../modules/listings/words.ts";
import { DAY_FEATURES } from "../../modules/assistant/words-budget.ts";
import { formatDate, formatTime } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { PERSONALITIES } from "../../modules/assistant/personality.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
export const OUT = join(here, "..", "internal", "assistant", "words");

// A sentinel marks where a value of the shop goes; it is turned into `{name}` after the message is written. The private-use characters never occur in the words themselves.
const S = (name: string): string => `${name}`;
const N = 7654321; // a count: written by the real function as digits, found again and turned into {n}
const KINDS = ["waiting", "money", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator"]; // conversation.ts kindsOf for this shop
const TZ = "Asia/Kolkata";

type Bag = Record<string, string>;

function slots(text: string): string {
  const out = text.replace(/(\w+)/gu, "{$1}").replaceAll(String(N), "{n}");
  if (/[]/u.test(out)) throw new Error(`a sentinel was left in: ${out}`);
  return out;
}

function say<K extends MessageId>(language: Language, id: K, data: MessageData[K]): string {
  return slots(write(id, data, language, TZ).text);
}

/** One language's messages. */
function messages(l: Language): { m: Bag; date: unknown; time: Bag; cat: Bag } {
  const m: Bag = {};
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
  m["talk_fallback"] = say(l, "talk_fallback", { waiting: N });
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
  // dates: names and the order, found by writing a date for each weekday and month
  const weekdays: string[] = [];
  const months: string[] = [];
  let comma = false;
  for (let i = 0; i < 7; i++) { const x = /^(.*?)(,)? 15 (.*)$/u.exec(formatDate({ year: 2026, month: 11, day: 15 + i }, l).replace(/ \d+ /u, " 15 ")); weekdays.push(x![1]); comma = x![2] === ","; }
  for (let mo = 1; mo <= 12; mo++) { const x = /^(.*?),? 10 (.*)$/u.exec(formatDate({ year: 2026, month: mo, day: 10 }, l)); months.push(x![2]); }
  const time: Bag = {};
  for (let h = 0; h < 24; h++) time[String(h)] = formatTime({ hour: h, minute: 59 }, l).replace(":59", ":{mm}");
  const cat: Bag = {};
  for (const [k, v] of Object.entries(LISTING_WORDS[l].categories)) cat[k] = v;
  return { m, date: { weekdays, months, comma }, time, cat };
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
  const intents = readFileSync(join(ROOT, "modules", "assistant", "intents.ts"), "utf8");
  const leave = readFileSync(join(ROOT, "modules", "assistant", "intents-leave.ts"), "utf8");
  const memory = readFileSync(join(ROOT, "modules", "assistant", "intents-memory.ts"), "utf8");
  const kinds = listAfter(intents, "const KIND_WORDS: readonly [OwnerKind, readonly string[]][] = [", "\n];") as unknown as [string, string[]][];
  return {
    kinds,
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

if (import.meta.main) {
  const files = generate();
  if (process.argv.includes("--check")) {
    // stale when the committed (unpacked) text differs from a fresh render; the gzip bytes themselves may differ between zlib versions, so the text is what is compared
    const { gunzipSync } = await import("node:zlib");
    let stale = 0;
    for (const [name, text] of files) {
      let have = "";
      try { have = gunzipSync(readFileSync(join(OUT, `${name}.gz`))).toString("utf8"); } catch { /* missing */ }
      if (have !== text) { stale++; console.error(`stale: ${name}.gz`); }
    }
    process.exitCode = stale ? 1 : 0;
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of files) writeFileSync(join(OUT, `${name}.gz`), gzipSync(Buffer.from(text), { level: 9, mtime: 0 } as never));
    console.log(`wrote ${files.size} files to ${OUT}`);
  }
}
