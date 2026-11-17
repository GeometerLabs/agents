// Classes at work: what the clock, a contact's message, the teacher's message and the teacher's button press do. The Fees agent (src/agent.ts) builds this once, hands it
// the few things it needs from itself (saying a message, the record, reading the payments again), and calls it from five places: the clock, a contact's message, the
// owner's message, the owner's page and the page's material read. Nothing here moves money and nothing here sends except through the agent's own `say`, so the opt-out,
// the outgoing check, the record and the licence apply to a class message exactly as to a fee reminder.
//
// The rules (owner decision 50; docs/product/education-experiment.md, "First: Classes"):
//  - The class link goes ONLY to a student in the batch whose contact agreed, and whose fee is paid or within the grace days, judged at the moment of sending after the
//    payment record is read again (rules.ts checkClassAccess). The same decision is a gate of the send itself, so it is recorded beside the message.
//  - The link is read when sending, never when queuing; a session keeps only the hash of each link it sent, so a lost reply is never sent twice and a CHANGED link is sent once.
//  - Attendance is the teacher's: asked once after the class, marked in one tap (all came) or by the numbers of those who missed; a missed-class note to a parent goes ONLY
//    after that, and only for a student the teacher marked absent.
//  - A doubt is collected and handed to the teacher. The agent never answers a subject question.
//  - A student under 18 has the parent as the contact; the first class message is the question whether class links and material may be sent to this number.
//  - No profiling, no tracking, no advertising: nothing is kept about a student beyond the marks the teacher gave and the doubts the contact wrote, and nothing leaves the shop.
import { canon } from "../../../../../modules/language/format.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { Choice } from "../../../../../modules/language/interactive.ts";
import type { InboundMessage } from "../../../../../modules/messaging/messaging.ts";
import type { SaidOutcome } from "../../../../../modules/messaging/say.ts";
import type { Action, Outcome } from "../../../../../modules/record/record.ts";
import { isStop } from "../../../../../modules/understanding/rules.ts";
import { LABELS } from "../language/interactive.ts";
import { batchName } from "../settings.ts";
import type { Batch, Settings, Student } from "../settings.ts";
import type { MessageFacts } from "../language/templates.ts";
import type { Decision } from "../limits.ts";
import type { Store } from "../due.ts";
import { isClassLink, readContactWords, readTeacherCommand } from "./parse.ts";
import { checkClassAccess, checkNoteAfterMark, nextClass, occurrencesBetween } from "./rules.ts";
import type { FeeSnapshot } from "./rules.ts";
import { MARK_WINDOW_MS, classDigest, doubtDigest, pageCase, pendingClasses } from "./view.ts";
import type { PendingClass } from "./view.ts";
import { KEEP_SESSIONS_MS, emptyClasses, linkHash, studentKey } from "./state.ts";
import type { ClassSession, ClassesState, Doubt } from "./state.ts";
import type { ClassTemplateId } from "./words.ts";
import type { ClassesSettings } from "./settings.ts";

/** The record's names for what Classes does (Action is an open type): the report counts them, and the crash-test situations read them. */
export const CLASS_ACTIONS = { linkSet: "class_link_set", attendance: "class_attendance", doubt: "class_doubt", consent: "class_consent", material: "class_material", access: "class_access" } as const;

/** The facts a Classes message adds to the fee facts (src/language/templates.ts MessageFacts): only these keys. */
export type ClassFacts = Partial<Pick<MessageFacts, "studentName" | "batchName" | "classMs" | "classLink" | "materialLink" | "roster" | "doubtText" | "classLines" | "leadMinutes" | "presentCount" | "absentCount" | "notedCount" | "waitingCount" | "sentCount" | "heldCount">>;

export interface ClassesCtx {
  settings: Settings & { classes: ClassesSettings };
  store: Store;
  nowMs: () => number;
  owner: string;
  /** The record line for something Classes did (not the sends: `say` writes those). */
  log(phone: string, action: Action, outcome: Outcome, inputs: unknown, more?: { notes?: string; refs?: Record<string, string>; decisions?: Decision[] }): void;
  /** One message to a contact / to the teacher, through the agent's own `say` (the outgoing check, opt-out, record and licence apply). */
  tellContact(phone: string, template: ClassTemplateId, facts: ClassFacts, more?: { choices?: Choice[]; gate?: Decision[] }): Promise<SaidOutcome>;
  tellTeacher(template: ClassTemplateId, facts: ClassFacts, more?: { choices?: Choice[] }): Promise<SaidOutcome>;
  /** The student's fees after the payments service was read again (and what it showed counted): `readOk` is false when any could not be read just now. */
  feesOf(parent: string, studentName: string): Promise<{ readOk: boolean; fees: FeeSnapshot[] }>;
  optedOut(phone: string): boolean;
  languageOf(phone: string): Language;
  /** Note the student's own language as the contact's, when the contact has none yet (the settings know it before the first message does). */
  noteLanguage(phone: string, language: Language | undefined): void;
  /** The contact's private page: its address now (a new link when the centre has none for them yet), or undefined when the centre has no page. `keep` once a message with it was accepted. */
  pageLink(parent: string): { url: string; keep(): void } | undefined;
}

/** How long a student who was held back is left before the fee is read for them again: a payment can come at any time, but the clock beats every few seconds. */
const RECHECK_MS = 5 * 60_000;
/** A doubt asked for ("doubt" alone) is taken as the contact's next message for this long. */
const DOUBT_WAIT_MS = 24 * 3_600_000;
const MAX_DOUBT_CHARS = 1000;
const MAX_DOUBTS_SHOWN = 12;

const LABEL: Record<Language, { everyone: string }> = {
  en: { everyone: "Everyone came" }, hi: { everyone: "सब आए" }, ml: { everyone: "എല്ലാവരും വന്നു" }, kn: { everyone: "ಎಲ್ಲರೂ ಬಂದರು" },
};

export function createClasses(ctx: ClassesCtx) {
  const { settings, store } = ctx;
  const classes = settings.classes;
  const tz = settings.timezone;
  const state = (): ClassesState => (store.classes ??= emptyClasses());
  const batchOf = (id: string): Batch | undefined => settings.batches.find((b) => b.id === id);
  const studentsOf = (batchId: string): Student[] => settings.students.filter((s) => s.batchId === batchId);
  const key = (s: Student) => studentKey(s.parent, s.name);
  const nameFor = (batchId: string, language: Language) => { const b = batchOf(batchId); return b ? batchName(b, language) : batchId; };
  const ownerLanguage = settings.owner.language;

  /** The batch the teacher means: its id, or any name it has in any language, in any case. */
  function resolveBatch(words: string): Batch | undefined {
    const w = canon(words).trim();
    return settings.batches.find((b) => b.id === w) ?? settings.batches.find((b) => Object.values(b.names).some((list) => (list ?? []).some((n) => canon(n) === w)));
  }

  // ---- consent: the first message ------------------------------------------------------------------------------------------------------------------------------

  type Consent = "yes" | "no" | "waiting" | "adult";
  const consentOf = (s: Student): Consent => (s.adult ? "adult" : state().consent[s.parent]?.answer ?? "waiting");

  /** The question, once per contact: may class links and reading material be sent to this number? Nothing else of Classes is sent to them before the answer. */
  async function askConsent(s: Student): Promise<void> {
    if (state().consent[s.parent] || ctx.optedOut(s.parent)) return;
    ctx.noteLanguage(s.parent, s.language);
    const language = ctx.languageOf(s.parent);
    const labels = LABELS[language];
    const outcome = await ctx.tellContact(s.parent, "class_consent_ask", { studentName: s.name, batchName: nameFor(s.batchId, language) }, { choices: [{ id: "cls:yes", title: labels.yes }, { id: "cls:no", title: labels.no }] });
    if (outcome === "not_sent") return; // asked again at the next beat
    state().consent[s.parent] = { askedAtMs: ctx.nowMs() };
    ctx.log(s.parent, CLASS_ACTIONS.consent, outcome === "held_back" ? "blocked" : "confirmed", { asked: true }, { notes: "the first class message: asked whether class links and reading material may be sent to this number" });
  }

  async function answerConsent(phone: string, answer: "yes" | "no"): Promise<void> {
    const mine = settings.students.filter((s) => s.parent === phone && !s.adult);
    const asked = state().consent[phone];
    if (!asked || asked.answer || mine.length === 0) return;
    asked.answer = answer;
    asked.answeredAtMs = ctx.nowMs();
    ctx.log(phone, CLASS_ACTIONS.consent, "confirmed", { answer }, { refs: { answer }, notes: `the contact answered ${answer} to class links and reading material on this number` });
    const s = mine[0];
    const language = ctx.languageOf(phone);
    await ctx.tellContact(phone, answer === "yes" ? "class_consent_yes" : "class_consent_no", { studentName: s.name, batchName: nameFor(s.batchId, language) });
  }

  // ---- may this student receive the link / the material? -------------------------------------------------------------------------------------------------------

  /** The access decision after the payment record is read again. This is the one place the rule is applied for a send. */
  async function entitlement(s: Student): Promise<Decision> {
    const { readOk, fees } = await ctx.feesOf(s.parent, s.name);
    return checkClassAccess({ inBatch: !!batchOf(s.batchId) && settings.students.includes(s), consent: consentOf(s), readOk, fees, graceDays: settings.due.graceDays, nowMs: ctx.nowMs(), timeZone: tz });
  }

  // ---- the clock ------------------------------------------------------------------------------------------------------------------------------------------------

  const linkFor = (session: { id: string; batchId: string }): string | undefined => state().sessionLinks[session.id] ?? state().batchLinks[session.batchId];

  /** Make the sessions whose link window has opened (from `linkLeadMinutes` before the start until the end), and drop the old ones. */
  function ensureSessions(now: number): void {
    const s = state();
    for (const occ of occurrencesBetween(classes, tz, now - 6 * 3_600_000, now + classes.linkLeadMinutes * 60_000 + 60_000)) {
      if (s.sessions[occ.id] || now < occ.startMs - classes.linkLeadMinutes * 60_000 || now >= occ.endMs) continue;
      s.sessions[occ.id] = { id: occ.id, batchId: occ.batchId, startMs: occ.startMs, endMs: occ.endMs, sent: {}, withheld: {}, marks: {}, noted: [] };
    }
    for (const [id, session] of Object.entries(s.sessions)) if (session.endMs < now - KEEP_SESSIONS_MS) delete s.sessions[id];
  }

  async function sendLinks(session: ClassSession, now: number): Promise<void> {
    const link = linkFor(session);
    if (!link) {
      if (!session.noLinkTold) {
        const outcome = await ctx.tellTeacher("owner_class_no_link", { batchName: nameFor(session.batchId, ownerLanguage), classMs: session.startMs });
        if (outcome !== "not_sent") session.noLinkTold = true;
      }
      return;
    }
    const hash = linkHash(link);
    for (const s of studentsOf(session.batchId)) {
      const k = key(s);
      if (session.sent[k]?.includes(hash) || ctx.optedOut(s.parent)) continue; // already sent this very link; STOP means STOP
      const consent = consentOf(s);
      if (consent === "waiting") { await askConsent(s); continue; }
      if (consent === "no") continue;
      const held = session.withheld[k];
      if (held && now - held.atMs < RECHECK_MS) continue;
      const access = await entitlement(s);
      if (access.verdict !== "allow") {
        if (held?.reason !== access.reason) ctx.log(s.parent, CLASS_ACTIONS.access, "blocked", { class: session.id }, { decisions: [access], refs: { session: session.id, batch: session.batchId, what: "link" }, notes: `the class link was not sent: ${access.reason}` });
        session.withheld[k] = { reason: access.reason, atMs: now };
        continue;
      }
      delete session.withheld[k];
      ctx.noteLanguage(s.parent, s.language);
      const language = ctx.languageOf(s.parent);
      // "accepted" and "maybe" (a lost reply) both count as sent: the link is never sent twice for the same hash. "not_sent" is tried again at the next beat; "held_back" is not
      // (it would be held back the same way), and is already in the record.
      const outcome = await ctx.tellContact(s.parent, "class_link", { studentName: s.name, batchName: nameFor(s.batchId, language), classMs: session.startMs, classLink: link }, { gate: [access] });
      if (outcome !== "not_sent") (session.sent[k] ??= []).push(hash);
    }
  }

  const rosterOf = (session: ClassSession): Student[] => studentsOf(session.batchId);

  /** Classes that are over, the teacher has not confirmed, and are still within the week they can be marked, oldest first (view.ts, which the owner's page reads too). */
  const pending = (now: number): PendingClass[] => pendingClasses(settings, state(), now);

  async function askAttendance(session: ClassSession): Promise<void> {
    const choices: Choice[] = [{ id: `cls:att:${session.id}:all`, title: LABEL[ownerLanguage].everyone }];
    const outcome = await ctx.tellTeacher("owner_class_attendance", { batchName: nameFor(session.batchId, ownerLanguage), classMs: session.startMs }, { choices });
    if (outcome !== "not_sent") session.askedAtMs = ctx.nowMs();
  }

  /** The missed-class notes of a class the teacher confirmed: each only for a student marked absent, once, with the contact's consent. A note that could not be sent is tried again. */
  async function sendNotes(session: ClassSession): Promise<number> {
    let sent = 0;
    for (const s of rosterOf(session)) {
      const k = key(s);
      if (session.noted.includes(k)) continue;
      const gate = checkNoteAfterMark({ mark: session.marks[k], closed: session.closedAtMs !== undefined });
      if (gate.verdict !== "allow") continue; // not marked absent: no note, and nothing to retry
      const consent = consentOf(s);
      if (consent === "no" || consent === "waiting" || ctx.optedOut(s.parent)) { session.noted.push(k); continue; } // never agreed, or STOP: no note, ever
      ctx.noteLanguage(s.parent, s.language);
      const language = ctx.languageOf(s.parent);
      const outcome = await ctx.tellContact(s.parent, "class_missed_note", { studentName: s.name, batchName: nameFor(s.batchId, language), classMs: session.startMs }, { gate: [gate] });
      if (outcome === "not_sent") continue; // tried again at the next beat
      session.noted.push(k);
      if (outcome === "accepted" || outcome === "maybe") sent++;
    }
    return sent;
  }

  async function tellDoubtsWaiting(): Promise<void> {
    const s = state();
    for (const batchId of new Set(s.doubts.filter((d) => d.state === "open").map((d) => d.batchId))) {
      if (s.doubtsToldAtMs[batchId] !== undefined) continue;
      const waiting = s.doubts.filter((d) => d.state === "open" && d.batchId === batchId).length;
      const outcome = await ctx.tellTeacher("owner_class_doubts_waiting", { batchName: nameFor(batchId, ownerLanguage), waitingCount: waiting });
      if (outcome !== "not_sent") s.doubtsToldAtMs[batchId] = ctx.nowMs();
    }
  }

  /** The clock: open the link windows, send links, ask for attendance, send the notes of what the teacher marked, and tell the teacher of doubts. */
  async function onTick(): Promise<void> {
    const now = ctx.nowMs();
    ensureSessions(now);
    for (const session of Object.values(state().sessions).sort((a, b) => a.startMs - b.startMs)) {
      if (now < session.endMs) { if (now >= session.startMs - classes.linkLeadMinutes * 60_000) await sendLinks(session, now); continue; }
      if (session.closedAtMs !== undefined) { if (session.endMs > now - MARK_WINDOW_MS) await sendNotes(session); continue; }
      if (session.askedAtMs === undefined && session.endMs > now - MARK_WINDOW_MS && rosterOf(session).length > 0) await askAttendance(session);
    }
    await tellDoubtsWaiting();
  }

  // ---- attendance ---------------------------------------------------------------------------------------------------------------------------------------------

  /** The teacher confirms: everyone not in `absent` is present. Closes the class, writes the record line, sends the notes and tells the teacher what was done. */
  async function markClass(session: ClassSession, absent: Set<string>, via: "whatsapp" | "page"): Promise<boolean> {
    if (session.closedAtMs !== undefined) return false;
    const roster = rosterOf(session);
    for (const s of roster) session.marks[key(s)] = absent.has(key(s)) ? "absent" : "present";
    session.closedAtMs = ctx.nowMs();
    const present = roster.length - absent.size;
    ctx.log(ctx.owner, CLASS_ACTIONS.attendance, "confirmed", { class: session.id, via }, { refs: { session: session.id, batch: session.batchId, present: String(present), absent: String(absent.size), via }, notes: "the teacher confirmed this class's attendance" });
    const noted = await sendNotes(session);
    await ctx.tellTeacher("owner_class_marked", { batchName: nameFor(session.batchId, ownerLanguage), classMs: session.startMs, presentCount: present, absentCount: absent.size, notedCount: noted });
    return true;
  }

  const rosterText = (students: Student[]): string => students.map((s, i) => `${i + 1} ${s.name}`).join(", ");

  async function showFirstPending(): Promise<void> {
    const first = pending(ctx.nowMs())[0];
    if (!first) { await ctx.tellTeacher("owner_class_nothing", {}); return; }
    const choices: Choice[] = [{ id: `cls:att:${first.session.id}:all`, title: LABEL[ownerLanguage].everyone }];
    await ctx.tellTeacher("owner_class_roster", { batchName: nameFor(first.session.batchId, ownerLanguage), classMs: first.session.startMs, roster: rosterText(first.students) }, { choices });
  }

  // ---- doubts ---------------------------------------------------------------------------------------------------------------------------------------------------

  function addDoubt(phone: string, text: string): Doubt | undefined {
    const mine = settings.students.filter((s) => s.parent === phone);
    if (mine.length === 0) return undefined;
    const s = state();
    // the student whose class is nearest (the next one, else the last one) is the batch the teacher is told; a parent of several children is named by all their names
    const now = ctx.nowMs();
    const soonest = mine.map((m) => ({ m, next: nextClass(classes, tz, m.batchId, now)?.startMs ?? Number.MAX_SAFE_INTEGER })).sort((a, b) => a.next - b.next)[0].m;
    const id = `d-${Math.max(0, ...s.doubts.map((d) => Number(d.id.slice(2)))) + 1}`;
    const doubt: Doubt = { id, parent: phone, student: mine.map((m) => m.name).join(" / "), batchId: soonest.batchId, text: text.slice(0, MAX_DOUBT_CHARS), atMs: now, state: "open" };
    s.doubts.push(doubt);
    delete s.doubtsToldAtMs[doubt.batchId];
    // the text is the shop's own state (the teacher reads it); the record keeps a digest of the message and no words of it
    ctx.log(phone, CLASS_ACTIONS.doubt, "confirmed", { doubt: id, text }, { refs: { doubt: id, batch: doubt.batchId }, notes: "a student's doubt was collected for the teacher; the agent does not answer subject questions" });
    // keep the list short: answered doubts older than 90 days go
    s.doubts = s.doubts.filter((d) => d.state === "open" || d.atMs > now - 90 * 24 * 3_600_000);
    return doubt;
  }

  const openDoubts = () => state().doubts.filter((d) => d.state === "open");

  async function showDoubts(): Promise<void> {
    const open = openDoubts();
    if (open.length === 0) { await ctx.tellTeacher("owner_class_nothing", {}); return; }
    const shown = open.slice(0, MAX_DOUBTS_SHOWN).map((d) => `${d.id} ${d.student} (${nameFor(d.batchId, ownerLanguage)}): ${d.text}`).join(" | ");
    for (const b of new Set(open.map((d) => d.batchId))) delete state().doubtsToldAtMs[b]; // read: a new doubt is told again
    await ctx.tellTeacher("owner_class_doubts", { doubtText: open.length > MAX_DOUBTS_SHOWN ? `${shown} | ... and ${open.length - MAX_DOUBTS_SHOWN} more` : shown });
  }

  // ---- a contact's message --------------------------------------------------------------------------------------------------------------------------------------

  /** The next class of each of this contact's students, from the timetable. */
  const linesFor = (students: Student[], language: Language) => students.flatMap((s) => {
    const next = nextClass(classes, tz, s.batchId, ctx.nowMs());
    return next ? [{ studentName: s.name, batchName: nameFor(s.batchId, language), startMs: next.startMs }] : [];
  });

  /** The private reading-material address for a student's batch: the contact's own page address, the batch after it. */
  function materialAddress(parent: string, batchId: string): { url: string; keep(): void } | undefined {
    const page = ctx.pageLink(parent);
    return page ? { url: `${page.url}/m/${batchId}`, keep: page.keep } : undefined;
  }

  /** Send a student's contact the material link, or say why not. Returns whether it went. */
  async function sendMaterial(s: Student, reply: boolean): Promise<"sent" | "held"> {
    const consent = consentOf(s);
    if (consent === "waiting") { await askConsent(s); return "held"; }
    if (consent === "no" || ctx.optedOut(s.parent)) return "held";
    const access = await entitlement(s);
    ctx.noteLanguage(s.parent, s.language);
    const language = ctx.languageOf(s.parent);
    const names = { studentName: s.name, batchName: nameFor(s.batchId, language) };
    if (access.verdict !== "allow") {
      ctx.log(s.parent, CLASS_ACTIONS.access, "blocked", { material: s.batchId }, { decisions: [access], refs: { batch: s.batchId, what: "material" }, notes: `the reading-material link was not sent: ${access.reason}` });
      if (reply) await ctx.tellContact(s.parent, "class_not_entitled", names);
      return "held";
    }
    const address = materialAddress(s.parent, s.batchId);
    if (!address) {
      ctx.log(s.parent, CLASS_ACTIONS.material, "blocked", { batch: s.batchId }, { refs: { batch: s.batchId }, notes: "the centre has no page address (no pages file), so no private material link can be made" });
      if (reply) await ctx.tellContact(s.parent, "class_material_none", names);
      return "held";
    }
    const outcome = await ctx.tellContact(s.parent, "class_material_link", { ...names, materialLink: address.url }, { gate: [access] });
    if (outcome === "accepted" || outcome === "maybe") { address.keep(); ctx.log(s.parent, CLASS_ACTIONS.material, "confirmed", { batch: s.batchId }, { refs: { batch: s.batchId }, notes: "the private reading-material link was sent" }); }
    return outcome === "accepted" || outcome === "maybe" ? "sent" : "held";
  }

  /**
   * A message from a contact, read by the class words and nothing else. Returns true when it was about classes and was answered (then the fee reading does not run). `noteReceived`
   * writes the record line for the message (the agent's own "receive_message"), only for a message this handles. A STOP is never taken here.
   */
  async function onContact(msg: InboundMessage, noteReceived: () => void): Promise<boolean> {
    const phone = msg.from;
    const mine = settings.students.filter((s) => s.parent === phone);
    if (mine.length === 0) return false;
    const s = state();
    const tap = msg.reply?.id;
    if (tap === "cls:yes" || tap === "cls:no") { noteReceived(); await answerConsent(phone, tap === "cls:yes" ? "yes" : "no"); return true; }
    if (msg.image || msg.voiceNote) return false;
    const text = msg.text;
    if (isStop(canon(text))) { delete s.awaitingDoubt[phone]; return false; }
    const waiting = s.awaitingDoubt[phone];
    const asked = s.consent[phone];
    const ask = readContactWords(text, { consentPending: !!asked && asked.answer === undefined && !mine.every((m) => m.adult) });
    if (waiting && ctx.nowMs() - waiting.atMs < DOUBT_WAIT_MS && !tap) {
      noteReceived();
      delete s.awaitingDoubt[phone];
      addDoubt(phone, text.trim());
      await ctx.tellContact(phone, "class_doubt_thanks", { studentName: mine[0].name, batchName: nameFor(mine[0].batchId, ctx.languageOf(phone)) });
      return true;
    }
    if (!ask) return false;
    noteReceived();
    const language = ctx.languageOf(phone);
    const first = { studentName: mine[0].name, batchName: nameFor(mine[0].batchId, language) };
    if (ask.kind === "consent") { await answerConsent(phone, ask.answer); return true; }
    if (ask.kind === "next") {
      const lines = linesFor(mine, language);
      if (lines.length > 0) await ctx.tellContact(phone, "class_next", { classLines: lines });
      else await ctx.tellContact(phone, "class_next_none", {});
      return true;
    }
    if (ask.kind === "material") {
      for (const m of mine) await sendMaterial(m, true);
      return true;
    }
    if (ask.text !== undefined) { addDoubt(phone, ask.text); await ctx.tellContact(phone, "class_doubt_thanks", first); return true; }
    s.awaitingDoubt[phone] = { student: mine.map((m) => m.name).join(" / "), atMs: ctx.nowMs() };
    await ctx.tellContact(phone, "class_doubt_ask", {});
    return true;
  }

  // ---- the teacher's message ------------------------------------------------------------------------------------------------------------------------------------

  /** The owner's message, when it is a class command or an attendance tap. Returns true when handled (the owner's other commands then do not run). */
  async function onTeacher(msg: InboundMessage): Promise<boolean> {
    const tap = /^cls:att:(.+):all$/u.exec(msg.reply?.id ?? "");
    if (tap) {
      const session = state().sessions[tap[1]];
      if (!session || session.closedAtMs !== undefined) { await ctx.tellTeacher("owner_class_nothing", {}); return true; }
      await markClass(session, new Set(), "whatsapp");
      return true;
    }
    if (msg.image || msg.voiceNote) return false;
    const cmd = readTeacherCommand(msg.text);
    if (!cmd) return false;
    if (cmd.kind === "bad") { await ctx.tellTeacher("owner_class_unknown", {}); return true; }
    if (cmd.kind === "link") {
      const batch = resolveBatch(cmd.batch);
      if (!batch || !isClassLink(cmd.url) || !classes.timetable[batch.id]) { await ctx.tellTeacher("owner_class_unknown", {}); return true; }
      if (cmd.which === "batch") state().batchLinks[batch.id] = cmd.url;
      else {
        const next = nextClass(classes, tz, batch.id, ctx.nowMs());
        if (!next) { await ctx.tellTeacher("owner_class_unknown", {}); return true; }
        state().sessionLinks[next.id] = cmd.url;
      }
      ctx.log(ctx.owner, CLASS_ACTIONS.linkSet, "confirmed", { batch: batch.id, which: cmd.which }, { refs: { batch: batch.id, which: cmd.which, linkHash: linkHash(cmd.url) }, notes: "the teacher pasted a class link; it is read again at every send, so a class not yet sent uses it" });
      await ctx.tellTeacher("owner_class_link_set", { batchName: batch.names[ownerLanguage]?.[0] ?? nameFor(batch.id, ownerLanguage), leadMinutes: classes.linkLeadMinutes });
      return true;
    }
    if (cmd.kind === "present") {
      const first = pending(ctx.nowMs())[0];
      if (!first) await ctx.tellTeacher("owner_class_nothing", {});
      else await markClass(first.session, new Set(), "whatsapp");
      return true;
    }
    if (cmd.kind === "absent") {
      const first = pending(ctx.nowMs())[0];
      if (!first) { await ctx.tellTeacher("owner_class_nothing", {}); return true; }
      if (cmd.numbers.some((n) => n < 1 || n > first.students.length)) { await ctx.tellTeacher("owner_class_unknown", {}); return true; }
      await markClass(first.session, new Set(cmd.numbers.map((n) => key(first.students[n - 1]))), "whatsapp");
      return true;
    }
    if (cmd.kind === "class") { await showFirstPending(); return true; }
    if (cmd.kind === "doubts") { await showDoubts(); return true; }
    if (cmd.kind === "answered") {
      const d = state().doubts.find((x) => x.id === cmd.id && x.state === "open");
      if (d) { d.state = "answered"; ctx.log(ctx.owner, CLASS_ACTIONS.doubt, "confirmed", { doubt: d.id, answered: true }, { refs: { doubt: d.id, answered: "yes" }, notes: "the teacher said this doubt is answered" }); }
      await showDoubts();
      return true;
    }
    if (cmd.kind === "share") {
      const batch = resolveBatch(cmd.batch);
      if (!batch) { await ctx.tellTeacher("owner_class_unknown", {}); return true; }
      let sent = 0;
      let held = 0;
      for (const s of studentsOf(batch.id)) (await sendMaterial(s, false)) === "sent" ? sent++ : held++;
      await ctx.tellTeacher("owner_class_shared", { batchName: nameFor(batch.id, ownerLanguage), sentCount: sent, heldCount: held });
      return true;
    }
    return false;
  }

  // ---- the owner's page -----------------------------------------------------------------------------------------------------------------------------------------

  /**
   * The teacher's press on their page. Each is bound to what the page showed by its digest (view.ts): a class already confirmed, a roster that changed or a doubt already
   * answered no longer matches and nothing is done. "absent" toggles one student's draft mark ("k-...2" is the second name); "present" confirms the class with those marked
   * missed as absent and everyone else present, exactly as the WhatsApp tap does. Returns whether anything was done.
   */
  async function onPageAction(action: "present" | "absent" | "answered", caseId: string, digest: string): Promise<boolean> {
    if (action === "answered") {
      const d = openDoubts().find((x) => x.id === caseId && doubtDigest(x) === digest);
      if (!d) return false;
      d.state = "answered";
      ctx.log(ctx.owner, CLASS_ACTIONS.doubt, "confirmed", { doubt: d.id, answered: true }, { refs: { doubt: d.id, answered: "yes", via: "page" }, notes: "the teacher said, on their page, that this doubt is answered" });
      return true;
    }
    const [base, n] = caseId.split(".");
    const found = pending(ctx.nowMs()).find((p) => pageCase(p.session.id) === base && classDigest(p) === digest);
    if (!found) return false;
    if (action === "absent") {
      const student = found.students[Number(n) - 1];
      if (!student) return false;
      const k = key(student);
      if (found.session.marks[k] === "absent") delete found.session.marks[k]; else found.session.marks[k] = "absent";
      return true;
    }
    return markClass(found.session, new Set(found.students.filter((s) => found.session.marks[key(s)] === "absent").map(key)), "page");
  }

  return { onTick, onContact, onTeacher, onPageAction, pending, markClass, openDoubts, resolveBatch, key, state, entitlement, consentOf, askConsent, addDoubt, linkFor, rosterText, sendNotes };
}

export type Classes = ReturnType<typeof createClasses>;
