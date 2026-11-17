// The owner's side of the shop's memory (block M): "remember …" (saved at once, said in passing, undoable for a day), "what do you remember?", "forget 3", a note the assistant
// proposes with Remember / No buttons (saved only on the tap, a no is final for 24 hours), and the tick that closes notes past their end and lets closed notes lose their text.
// conversation.ts makes it over its own `tell` and record writer and calls it from three places, so that file stays small.
//
// Who may write: every write here uses an authority made at the call (modules/memory ownerAuthority), and this file is reached only from the owner's own message, the owner's
// own app, or a tap on the owner's own button: conversation.ts checks the sender first (`msg.from === owner`). A customer's message never reaches this file.
import { languageOfScript } from "../language/format.ts";
import type { Choice } from "../language/interactive.ts";
import type { Language } from "../language/languages.ts";
import {
  MAX_NOTE_CHARS, MAX_OPEN_NOTES, MEMORY_ACTION, UNDO_NOTE_MS, acceptProposal, addNote, declineProposal, endExpired, forgetNote, inScope, memoryOf, memoryRefs, ownerAuthority, propose, tidyMemory,
} from "../memory/memory.ts";
import type { Note, NoteInput, NoteKind, NoteLang } from "../memory/memory.ts";
import type { Outcome } from "../record/record.ts";
import { nextId } from "./state.ts";
import type { AssistantState } from "./state.ts";
import { NOTE_LABELS } from "./words-memory.ts";
import type { MemoryMessageData, MemoryMessageId } from "./words-memory.ts";

/** A proposed note's buttons: `note-yes:p-3` and `note-no:p-3`. */
const BUTTON_RE = /^note-(yes|no):(p-\d{1,6})$/u;
export const noteButtonId = (answer: "yes" | "no", proposal: string): string => `note-${answer}:${proposal}`;
export const parseNoteReply = (m: { reply?: { id: string } }): { answer: "yes" | "no"; proposal: string } | undefined => {
  const hit = m.reply ? BUTTON_RE.exec(m.reply.id) : null;
  return hit ? { answer: hit[1] as "yes" | "no", proposal: hit[2] } : undefined;
};

export interface NotesDeps {
  state(): AssistantState;
  nowMs(): number;
  ownerLanguage: Language;
  /** Say something to the owner (conversation.ts `tell`). */
  tell<K extends MemoryMessageId>(id: K, data: MemoryMessageData[K], more?: { buttons?: Choice[] }): Promise<boolean>;
  logLine(caseId: string | null, action: string, outcome: Outcome, inputs: unknown, refs: Record<string, string>, notes?: string): void;
  /** Where the owner is talking from: WhatsApp, or their own app. Set by the code that authenticated them, never by a message. */
  via(): "whatsapp" | "app";
  /** True while the answer goes to the owner's page: a proposal has no buttons there, so none is made. */
  onPage(): boolean;
  /** A keyed digest of a note's text, where the shop has one (the record's key). */
  digest?: (text: string) => string;
}

/** A note's language, from its script (Latin letters are English, which is also how Hindi typed in Latin letters is filed). */
const noteLang = (text: string): NoteLang => languageOfScript(text);

/** "remember for customers: ..." makes a note customers' answers may use (kind public); otherwise a fact for the owner's talks only. Said in the four languages. */
const FOR_CUSTOMERS = /^\s*(?:for customers|customers (?:can|may) be told|tell customers|ग्राहकों के लिए|ग्राहकों को बताना|ഉപഭോക്താക്കൾക്ക്|ಗ್ರಾಹಕರಿಗೆ)\s*[:,\-–]?\s*/iu;

/** What a note's kind and audience are, from the owner's words, by rule: a public one if they said it is for customers; a goal if they say so; otherwise a fact for themselves. */
export function noteFromWords(words: string): NoteInput {
  const forCustomers = FOR_CUSTOMERS.exec(words);
  const text = forCustomers ? words.slice(forCustomers[0].length).trim() : words.trim();
  const kind: NoteKind = forCustomers ? "public" : /^\s*(?:my goal|goal|lakshya|लक्ष्य|ലക്ഷ്യം|ಗುರಿ)\b/iu.test(text) ? "goal" : /^\s*(?:always|never|offer|do not|don't|please)\b|^\s*(?:हमेशा|कभी नहीं)/iu.test(text) ? "instruction" : "fact";
  return { kind, text, lang: noteLang(text), ...(forCustomers ? { audience: "everyone" as const } : {}) };
}

export function createNotes(d: NotesDeps) {
  const memory = () => memoryOf(d.state());
  const ctx = () => ({ nowMs: d.nowMs(), ...(d.digest ? { digest: d.digest } : {}) });
  const authority = () => ownerAuthority(d.via());
  const listed = (n: Note) => ({ id: n.id, text: n.text, kind: n.kind, audience: n.audience, ...(n.untilMs !== undefined ? { untilMs: n.untilMs } : {}) });

  /** The record line for a change: the text is in `inputs`, so the record keeps only its keyed digest, never the words. */
  const memoryLine = (note: Note, change: Parameters<typeof memoryRefs>[1], withText: boolean) =>
    d.logLine(null, MEMORY_ACTION, "confirmed", withText ? { note: note.id, text: note.text } : { note: note.id, digest: note.digest }, memoryRefs(note, change),
      change === "added" || change === "corrected" ? "a note was saved to the shop's memory by the owner, the Operator or the builder; the record keeps its id, kind and who, never its words"
        : change === "forgotten" ? "a note's words were removed from the shop's state; its id, dates and digest stay" : change === "ended" ? "a note reached its end date and was closed" : "the owner undid a note they had just saved");

  async function saveFailure(why: string): Promise<void> {
    if (why === "full") await d.tell("note_full", { max: MAX_OPEN_NOTES });
    else if (why === "too_long") await d.tell("note_too_long", { max: MAX_NOTE_CHARS });
    else await d.tell("note_need_words", {});
  }

  /** "remember …": saved at once, undoable for a day. */
  async function remember(words: string | undefined): Promise<void> {
    if (!words) { await d.tell("note_need_words", {}); return; }
    const r = addNote(memory(), authority(), noteFromWords(words), ctx());
    if (!r.ok) { await saveFailure(r.why); return; }
    const s = d.state();
    s.undo.push({ id: nextId(s, "u"), kind: "remember", skill: "memory", date: "", asked: [], case: r.note.id, atMs: d.nowMs(), untilMs: d.nowMs() + UNDO_NOTE_MS });
    memoryLine(r.note, "added", true);
    await d.tell("note_saved", { id: r.note.id, text: r.note.text, audience: r.note.audience, undoable: true });
  }

  /** The note a rule that maps to no declared limit becomes, said as a note and never as a limit. Same write as `remember`, a different sentence. */
  async function saveRuleAsNote(words: string): Promise<void> {
    const r = addNote(memory(), authority(), { ...noteFromWords(words), kind: "instruction" }, ctx());
    if (!r.ok) { await saveFailure(r.why); return; }
    memoryLine(r.note, "added", true);
    await d.tell("note_not_a_limit", { id: r.note.id });
  }

  async function list(): Promise<void> {
    await d.tell("notes_list", { notes: inScope(memory(), "owner", d.nowMs()).map(listed) });
  }

  async function forget(id: string): Promise<void> {
    const r = forgetNote(memory(), authority(), id, ctx());
    if (!r.ok) { await d.tell("note_unknown", { id }); return; }
    memoryLine(r.note, "forgotten", false);
    await d.tell("note_forgotten", { id });
  }

  /** A note the talk proposes: shown with Remember / No. Not on the owner's page (it has no buttons); not when the owner said no to this text in the last day. */
  async function proposeNote(p: { kind: string; text: string; audience?: "owner" | "everyone" }): Promise<boolean> {
    if (d.onPage()) return false;
    const made = propose(memory(), { kind: p.kind as NoteKind, text: p.text, lang: noteLang(p.text), ...(p.audience ? { audience: p.audience } : {}) }, ctx());
    if (!made) return false;
    const l = NOTE_LABELS[d.ownerLanguage];
    await d.tell("note_proposal", { text: made.text, audience: made.audience }, { buttons: [{ id: noteButtonId("yes", made.id), title: l.yes }, { id: noteButtonId("no", made.id), title: l.no }] });
    return true;
  }

  /** The owner's tap on a proposal. Saved only on Remember. */
  async function onProposalReply(r: { answer: "yes" | "no"; proposal: string }): Promise<void> {
    if (r.answer === "no") { declineProposal(memory(), authority(), r.proposal, ctx()); await d.tell("note_declined", {}); return; }
    const saved = acceptProposal(memory(), authority(), r.proposal, ctx());
    if (!saved.ok) { if (saved.why === "full") await saveFailure("full"); else await d.tell("note_unknown", { id: r.proposal }); return; }
    memoryLine(saved.note, "added", true);
    await d.tell("note_saved", { id: saved.note.id, text: saved.note.text, audience: saved.note.audience, undoable: false });
  }

  /** Undo of a "remember": the note is forgotten again, while the undo is still in time (the caller checked). */
  async function undoRemember(noteId: string): Promise<void> {
    const r = forgetNote(memory(), authority(), noteId, ctx());
    if (r.ok) memoryLine(r.note, "undone", false);
    await d.tell("note_undone", { id: noteId });
  }

  /** On the clock's beat: notes past their end are closed, and closed notes lose their text after 30 days. */
  function tick(): void {
    const m = d.state().memory;
    if (!m) return;
    for (const n of endExpired(m, d.nowMs())) memoryLine(n, "ended", false);
    tidyMemory(m, d.nowMs());
  }

  /** The notes the owner's app lists, with the text each still has (an owner can export or delete from there). */
  const forApp = (): ReturnType<typeof listed>[] => (d.state().memory ? inScope(memory(), "owner", d.nowMs()).map(listed) : []);

  return { remember, saveRuleAsNote, list, forget, proposeNote, onProposalReply, undoRemember, tick, forApp };
}
export type Notes = ReturnType<typeof createNotes>;
