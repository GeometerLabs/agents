// What the owner's page and the private reading-material page may READ of Classes, from the centre's saved state and settings (no agent, no clock of its own: the time is
// given). Like src/channel.ts for the fees: an allowlist, never a link, a code or a number, and the decisions it makes are the very rules of rules.ts.
//
// The material page is judged from the SAVED fees (the last step's record), not from a fresh read of the payments service: a page open cannot call the service, and a
// payment that landed a moment ago is counted at the next step. The class link, which goes out at a moment the agent chose, reads the payments again first (run.ts);
// this is why the page is never more generous than the saved state, and is the one place the two differ (Explanation.md says so).
import { createHash } from "node:crypto";
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { balancePaise } from "../due.ts";
import type { Store } from "../due.ts";
import { batchName } from "../settings.ts";
import type { Settings, Student } from "../settings.ts";
import { checkClassAccess } from "./rules.ts";
import type { FeeSnapshot } from "./rules.ts";
import { studentKey } from "./state.ts";
import type { ClassSession, ClassesState } from "./state.ts";

/** An attendance that was never marked is still asked about, and still markable, for this long. */
export const MARK_WINDOW_MS = 7 * 24 * 3_600_000;

export interface PendingClass { session: ClassSession; students: Student[] }

/** Classes that are over, the teacher has not confirmed, and are still within the week they can be marked, oldest first. */
export function pendingClasses(settings: Settings, state: ClassesState, nowMs: number): PendingClass[] {
  return Object.values(state.sessions)
    .map((session) => ({ session, students: settings.students.filter((s) => s.batchId === session.batchId) }))
    .filter((x) => x.session.endMs <= nowMs && !x.session.closedAtMs && x.session.endMs > nowMs - MARK_WINDOW_MS && x.students.length > 0)
    .sort((a, b) => a.session.startMs - b.session.startMs);
}

/** A student's fees as the saved state shows them (every fee the student has, paid ones too: only an open one with something owed past its grace days stops access). */
export const feeSnapshots = (store: Store, parent: string, studentName: string): FeeSnapshot[] =>
  [...store.dues.values()].filter((d) => d.customer === parent && d.studentName === studentName).map((d) => ({ state: d.state, dueDate: d.dueDate, balancePaise: balancePaise(d), backDue: !!d.backDue }));

const namesOf = (settings: Settings, batchId: string): Record<Language, string> => {
  const batch = settings.batches.find((b) => b.id === batchId);
  return Object.fromEntries(LANGUAGES.map((l) => [l, batch ? batchName(batch, l) : batchId])) as Record<Language, string>;
};

/** What a contact's private page may show of one batch's material: who it is for and in what words. Null when no student of this contact may open it now. */
export interface MaterialView { batch: Record<Language, string>; students: string[] }

/**
 * Can this contact open the reading material of this batch right now? `parent` is the contact whose private link this is (src/channel.ts parentOf), or undefined for a link
 * no one has. At least one of their students must be in the batch, have agreed (or be an adult), and have every ordinary fee paid or within the grace days, a back due too only when the centre set `oldDuesStopLink` (rules.ts checkClassAccess): a
 * student who left the batch, or whose fee is past its grace days, no longer opens it, and neither does the link of a contact none of whose students is entitled.
 */
export function materialView(settings: Settings, store: Store, parent: string | undefined, batchId: string, nowMs: number): MaterialView | null {
  if (!parent || !settings.classes) return null;
  const mine = settings.students.filter((s) => s.parent === parent && s.batchId === batchId);
  const entitled = mine.filter((s) => checkClassAccess({
    inBatch: true, consent: s.adult ? "adult" : store.classes?.consent[s.parent]?.answer ?? "waiting", readOk: true,
    fees: feeSnapshots(store, s.parent, s.name), graceDays: settings.due.graceDays, oldDuesStopLink: settings.classes.oldDuesStopLink, nowMs, timeZone: settings.timezone,
  }).verdict === "allow");
  return entitled.length > 0 ? { batch: namesOf(settings, batchId), students: entitled.map((s) => s.name) } : null;
}

// ---- the owner's page ------------------------------------------------------------------------------------------------------------------------------------------

export interface OwnerClassView {
  /** What a press names (`pageCase` of the class's id). A press on one student's "missed" button names it with the student's number after a dot: "k-1a2b3c4d5e6f.2". */
  case: string;
  digest: string;
  batch: Record<Language, string>;
  startMs: number;
  /** The students in the order the numbers go, and who is marked missed so far (a draft until the teacher confirms). */
  students: { n: number; name: string; missed: boolean }[];
}
export interface OwnerDoubtView { case: string; digest: string; student: string; batch: Record<Language, string>; text: string; atMs: number }
export interface OwnerClassesView { pending: OwnerClassView[]; doubts: OwnerDoubtView[] }

/** A class's name on the owner's page: short, and made of the characters an owner_action's case may hold (a class id has "@"). The press names the class by this. */
export const pageCase = (sessionId: string): string => `k-${createHash("sha256").update(sessionId).digest("hex").slice(0, 12)}`;

const digestOf = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
export const classDigest = (p: PendingClass): string => digestOf(["class", p.session.id, p.students.map((s) => [s.name, p.session.marks[studentKey(s.parent, s.name)] ?? ""])]);
export const doubtDigest = (d: { id: string; text: string; state: string }): string => digestOf(["doubt", d.id, d.text, d.state]);

/** The classes waiting for attendance and the open doubts, for the owner's page. Undefined for a centre without Classes (the page then has no such section). */
export function ownerClassesView(settings: Settings, store: Store, nowMs: number): OwnerClassesView | undefined {
  if (!settings.classes) return undefined;
  const state = store.classes;
  if (!state) return { pending: [], doubts: [] };
  return {
    pending: pendingClasses(settings, state, nowMs).map((p) => ({
      case: pageCase(p.session.id), digest: classDigest(p), batch: namesOf(settings, p.session.batchId), startMs: p.session.startMs,
      students: p.students.map((s, i) => ({ n: i + 1, name: s.name, missed: p.session.marks[studentKey(s.parent, s.name)] === "absent" })),
    })),
    doubts: state.doubts.filter((d) => d.state === "open").map((d) => ({ case: d.id, digest: doubtDigest(d), student: d.student, batch: namesOf(settings, d.batchId), text: d.text, atMs: d.atMs })),
  };
}
