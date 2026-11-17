// The shop's memory (block M, decision 58, plan B62's agent half): short standing notes the owner (or the Operator or builder) gave the shop's assistant, kept in the shop's
// own store, for every template and for any model. This file is PURE: no disk, no node:sqlite, no network, no model, so the agents (and the browser demo built from them)
// can import it. The state it works on is plain JSON; the assistant keeps it under `assistant.memory` (modules/assistant/state.ts), so it is saved in the same step and
// transaction as everything else (modules/runtime/core.ts).
//
// What it promises, and how:
//  - ONLY a person with authority writes. Every write takes an `Authority`, which only `ownerAuthority` and `panelAuthority` make, and which is checked at run time
//    (an object that is not one of those throws). A customer's event has no way to get one: customer code never imports this file's authority makers (a test reads the
//    source to keep it so). `by` and `from` come from the authority, which the code that authenticated the event made, never from a model or a message.
//  - Every note has a provenance (by, from, when), an audience (owner only, or everyone), an optional end, and a correction history: a correction closes the old note and
//    opens a new one that names it. Forget removes the text at once and keeps the id, the dates and a digest. Closed notes lose their text after 30 days.
//  - Retrieval is ONE replaceable function, `recall`. Scope (open, not ended, the audience) is applied BEFORE the retriever runs, so a better retriever (an embedding
//    index, SQLite FTS5, a Mem0 server) can be put behind it later and cannot widen what an audience sees.
import { createHash } from "node:crypto";
import { DAY } from "../core/time.ts";

export const NOTE_KINDS = ["profile", "instruction", "fact", "goal", "experiment", "public"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export type Audience = "owner" | "everyone";
export type NoteBy = "owner" | "operator" | "builder";
export type NoteFrom = "whatsapp" | "app" | "panel";
export type ClosedWhy = "replaced" | "forgotten" | "ended";
export type NoteLang = "en" | "hi" | "ml" | "kn";

/** The most characters a note holds, and the most open notes a shop keeps. */
export const MAX_NOTE_CHARS = 280;
export const MAX_OPEN_NOTES = 80;
/** A closed note keeps its text this long (so a mistake can be undone), then loses it. */
export const CLOSED_TEXT_KEPT_MS = 30 * DAY;
/** A note the owner just said can be undone this long; a proposed one that is not answered, and a no, both last this long. */
export const UNDO_NOTE_MS = DAY;
export const PROPOSAL_MS = DAY;
export const NO_FINAL_MS = DAY;

/** What a note's audience is when the person does not say: profile and public are for everyone; the rest are the owner's (a fact asks the owner, so it starts owner-only). */
export const DEFAULT_AUDIENCE: Record<NoteKind, Audience> = { profile: "everyone", public: "everyone", instruction: "owner", goal: "owner", experiment: "owner", fact: "owner" };

export interface Note {
  /** "n-3": never given twice. */
  id: string;
  kind: NoteKind;
  /** The text as the owner wrote or confirmed it. Empty once forgotten, or 30 days after the note closed (`textGone`). */
  text: string;
  lang: NoteLang;
  audience: Audience;
  by: NoteBy;
  from: NoteFrom;
  atMs: number;
  /** After this moment the note is no longer recalled, and the next tick closes it ("ended"). */
  untilMs?: number;
  /** The note this one corrects. */
  replaces?: string;
  closed?: { atMs: number; by: NoteBy; why: ClosedWhy };
  /** A digest of the text, kept after the text is gone (keyed when the caller gives a keyed digest). */
  digest: string;
  textGone?: true;
}

/** A note the assistant proposed during a talk: saved only when the owner taps Remember. */
export interface Proposal {
  id: string;
  kind: NoteKind;
  text: string;
  lang: NoteLang;
  audience: Audience;
  atMs: number;
  expiresAtMs: number;
}

export interface MemoryState {
  /** The last number given to a note or a proposal. */
  seq: number;
  notes: Note[];
  proposals: Proposal[];
  /** Proposals the owner said no to: the same text is not proposed again for 24 hours. */
  no: { digest: string; atMs: number }[];
}

export const emptyMemory = (): MemoryState => ({ seq: 0, notes: [], proposals: [], no: [] });

/** The memory in an assistant state, made on first use. A store from before memory has none and loads as it was. */
export function memoryOf(holder: { memory?: MemoryState }): MemoryState {
  if (!holder.memory) holder.memory = emptyMemory();
  return holder.memory;
}

// ---- authority: who may write -------------------------------------------------------------------------------------------------------------------

const issued = new WeakSet<object>();
export interface Authority { readonly by: NoteBy; readonly from: NoteFrom }

/** The owner, reached on their own WhatsApp number or in their own app: the caller has already checked the sender. Call it only where the sender is authenticated as the owner. */
export function ownerAuthority(from: "whatsapp" | "app"): Authority {
  const a = Object.freeze({ by: "owner" as const, from });
  issued.add(a);
  return a;
}

/** The Operator or the builder, in the panel (which authenticated them). */
export function panelAuthority(by: "operator" | "builder"): Authority {
  const a = Object.freeze({ by, from: "panel" as const });
  issued.add(a);
  return a;
}

/** Throws on anything that is not an authority this module made: a forged `{ by: "owner" }` object, a customer's event, nothing. */
function requireAuthority(a: unknown): asserts a is Authority {
  if (typeof a !== "object" || a === null || !issued.has(a)) throw new Error("Only the owner, the Operator or the builder can change the shop's memory.");
}

// ---- writing ------------------------------------------------------------------------------------------------------------------------------------

export interface WriteContext {
  nowMs: number;
  /** A digest of a note's text. Pass the shop's keyed digest where there is one (the record's key); the default is a plain one, which can be guessed for short text. */
  digest?: (text: string) => string;
}
const digestOf = (c: WriteContext, text: string): string => (c.digest ?? plainDigest)(text);
export const plainDigest = (text: string): string => createHash("sha256").update(`geometer/note/1\n${text}`).digest("hex").slice(0, 16);

export interface NoteInput { kind: NoteKind; text: string; lang: NoteLang; audience?: Audience; untilMs?: number }
export type WriteFailure = "empty" | "too_long" | "full" | "bad_kind" | "no_such_note" | "already_closed";
export type NoteResult = { ok: true; note: Note } | { ok: false; why: WriteFailure };

export const openNotes = (m: MemoryState): Note[] => m.notes.filter((n) => !n.closed);
const find = (m: MemoryState, id: string): Note | undefined => m.notes.find((n) => n.id === id);
const clean = (text: string): string => text.replace(/\s+/gu, " ").trim();

function make(m: MemoryState, a: Authority, input: NoteInput, c: WriteContext, replaces?: string): NoteResult {
  const text = clean(input.text);
  if (!(NOTE_KINDS as readonly string[]).includes(input.kind)) return { ok: false, why: "bad_kind" };
  if (text === "") return { ok: false, why: "empty" };
  if (text.length > MAX_NOTE_CHARS) return { ok: false, why: "too_long" };
  m.seq += 1;
  const note: Note = {
    id: `n-${m.seq}`, kind: input.kind, text, lang: input.lang, audience: input.audience ?? DEFAULT_AUDIENCE[input.kind], by: a.by, from: a.from, atMs: c.nowMs,
    ...(input.untilMs !== undefined ? { untilMs: input.untilMs } : {}), ...(replaces ? { replaces } : {}), digest: digestOf(c, text),
  };
  m.notes.push(note);
  return { ok: true, note };
}

/** Write a note. Only with an authority; a shop keeps at most 80 open notes. */
export function addNote(m: MemoryState, a: Authority, input: NoteInput, c: WriteContext): NoteResult {
  requireAuthority(a);
  if (openNotes(m).length >= MAX_OPEN_NOTES) return { ok: false, why: "full" };
  return make(m, a, input, c);
}

/** A correction: the old note is closed ("replaced") and a new one opens that names it, so the history shows what was true when. */
export function correctNote(m: MemoryState, a: Authority, id: string, input: NoteInput, c: WriteContext): NoteResult {
  requireAuthority(a);
  const old = find(m, id);
  if (!old) return { ok: false, why: "no_such_note" };
  if (old.closed) return { ok: false, why: "already_closed" };
  const made = make(m, a, input, c, old.id);
  if (made.ok) old.closed = { atMs: c.nowMs, by: a.by, why: "replaced" };
  return made;
}

/** Forget: the text is removed at once, from a note open or closed. The id, the dates, who and a digest stay. */
export function forgetNote(m: MemoryState, a: Authority, id: string, c: WriteContext): { ok: true; note: Note } | { ok: false; why: WriteFailure } {
  requireAuthority(a);
  const n = find(m, id);
  if (!n) return { ok: false, why: "no_such_note" };
  if (n.textGone && n.closed?.why === "forgotten") return { ok: false, why: "already_closed" };
  n.digest = n.digest || digestOf(c, n.text);
  n.text = "";
  n.textGone = true;
  if (!n.closed) n.closed = { atMs: c.nowMs, by: a.by, why: "forgotten" };
  return { ok: true, note: n };
}

/** Closed on the tick, after `untilMs`. Needs no authority: time is not a writer, and nothing is added. Returns the notes it closed. */
export function endExpired(m: MemoryState, nowMs: number): Note[] {
  const ended: Note[] = [];
  for (const n of m.notes) {
    if (n.closed || n.untilMs === undefined || n.untilMs > nowMs) continue;
    n.closed = { atMs: nowMs, by: n.by, why: "ended" };
    ended.push(n);
  }
  return ended;
}

/** On the tick: closed notes older than 30 days lose their text; proposals past their day and a no past its day go. Returns how many notes lost their text. */
export function tidyMemory(m: MemoryState, nowMs: number): number {
  let dropped = 0;
  for (const n of m.notes) {
    if (n.closed && !n.textGone && nowMs - n.closed.atMs >= CLOSED_TEXT_KEPT_MS) { n.text = ""; n.textGone = true; dropped += 1; }
  }
  m.proposals = m.proposals.filter((p) => p.expiresAtMs > nowMs);
  m.no = m.no.filter((x) => nowMs - x.atMs < NO_FINAL_MS);
  return dropped;
}

// ---- proposals: the assistant may suggest, a person decides ---------------------------------------------------------------------------------------

/**
 * Keep a proposed note until the owner taps Remember or No. Nothing is written to the notes: a proposal is not a note. Refused (null) when the owner said no to this same text in
 * the last day, or the text is not a valid note.
 */
export function propose(m: MemoryState, input: NoteInput, c: WriteContext): Proposal | null {
  const text = clean(input.text);
  if (!(NOTE_KINDS as readonly string[]).includes(input.kind) || text === "" || text.length > MAX_NOTE_CHARS) return null;
  const d = digestOf(c, text);
  if (m.no.some((x) => x.digest === d && c.nowMs - x.atMs < NO_FINAL_MS)) return null;
  m.seq += 1;
  const p: Proposal = { id: `p-${m.seq}`, kind: input.kind, text, lang: input.lang, audience: input.audience ?? DEFAULT_AUDIENCE[input.kind], atMs: c.nowMs, expiresAtMs: c.nowMs + PROPOSAL_MS };
  m.proposals.push(p);
  return p;
}

/** The owner's tap on Remember (with their authority): the note is written now. A proposal past its day is gone. */
export function acceptProposal(m: MemoryState, a: Authority, id: string, c: WriteContext): NoteResult {
  requireAuthority(a);
  const p = m.proposals.find((x) => x.id === id && x.expiresAtMs > c.nowMs);
  if (!p) return { ok: false, why: "no_such_note" };
  const r = addNote(m, a, { kind: p.kind, text: p.text, lang: p.lang, audience: p.audience }, c);
  if (r.ok || r.why !== "full") m.proposals = m.proposals.filter((x) => x.id !== id);
  return r;
}

/** The owner's tap on No: the proposal goes, and the same text is not proposed again for 24 hours. */
export function declineProposal(m: MemoryState, a: Authority, id: string, c: WriteContext): boolean {
  requireAuthority(a);
  const p = m.proposals.find((x) => x.id === id);
  if (!p) return false;
  m.proposals = m.proposals.filter((x) => x.id !== id);
  m.no.push({ digest: digestOf(c, p.text), atMs: c.nowMs });
  return true;
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------

export interface RecallQuery {
  /** Whose prompt this is for. "everyone" is a customer's: owner-only notes are not in its scope, whatever the retriever does. */
  audience: Audience;
  /** What the talk is about, for a retriever that can use it. The first retriever ignores it (the whole active set fits in context). */
  query?: string;
  /** The most characters of notes to return (a prompt's room). */
  budget: number;
  nowMs: number;
}

/** A retriever picks and orders from notes that are ALREADY in scope. It is handed nothing else, so it cannot widen what an audience sees. */
export type Retriever = (scoped: readonly Note[], q: RecallQuery) => Note[];

const KIND_RANK: Record<NoteKind, number> = { profile: 0, public: 1, instruction: 2, fact: 3, experiment: 4, goal: 5 };

/** The first retriever: every note in scope, by kind and then newest first, as many as fit the budget. A search or an embedding index replaces this one function. */
export const everyNoteByKind: Retriever = (scoped, q) => {
  const sorted = [...scoped].sort((x, y) => KIND_RANK[x.kind] - KIND_RANK[y.kind] || y.atMs - x.atMs);
  const out: Note[] = [];
  let used = 0;
  for (const n of sorted) {
    if (used + n.text.length > q.budget) continue;
    used += n.text.length;
    out.push(n);
  }
  return out;
};

/** Notes in scope for an audience: open, not past their end, with text, and for that audience. This is applied before any retriever. */
export function inScope(m: MemoryState, audience: Audience, nowMs: number): Note[] {
  return m.notes.filter((n) => !n.closed && !n.textGone && n.text !== "" && (n.untilMs === undefined || n.untilMs > nowMs) && (audience === "owner" || n.audience === "everyone"));
}

/** The one retrieval function templates and the talk use. Scope first, then the (replaceable) retriever; the result is checked to be inside the scope anyway. */
export function recall(m: MemoryState, q: RecallQuery, retriever: Retriever = everyNoteByKind): Note[] {
  const scoped = inScope(m, q.audience, q.nowMs);
  const ids = new Set(scoped.map((n) => n.id));
  return retriever(scoped, q).filter((n) => ids.has(n.id));
}

/** Everything the owner can take away: every note with the text it still has. For the owner's app. */
export function exportNotes(m: MemoryState): { exportedFormat: "geometer-shop-notes/1"; notes: Note[] } {
  return { exportedFormat: "geometer-shop-notes/1", notes: m.notes.map((n) => ({ ...n, ...(n.closed ? { closed: { ...n.closed } } : {}) })) };
}

// ---- the record --------------------------------------------------------------------------------------------------------------------------------

export type MemoryChange = "added" | "corrected" | "forgotten" | "ended" | "undone";

/**
 * What a `memory` line of the record carries: the note's id, kind, who and what changed, as refs. The text is not here: the line's inputs hold it and the record keeps only
 * their (keyed) digest, never the words. Used by the assistant's logLine.
 */
export function memoryRefs(note: Note, change: MemoryChange): Record<string, string> {
  return { note: note.id, kind: note.kind, by: note.by, from: note.from, audience: note.audience, change, ...(note.replaces ? { replaces: note.replaces } : {}) };
}
export const MEMORY_ACTION = "memory";
