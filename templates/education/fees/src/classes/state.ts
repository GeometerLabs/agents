// What Classes keeps between steps, as plain JSON in the agent's store (`store.classes`, saved with the rest in server/snapshot.ts). Left out of the store until the
// first class is touched, so a centre without Classes has a snapshot exactly as it was.
//
// The class link is NOT copied into a class when it is queued: a session only remembers the HASH of each link it has sent to each student. The link is read from here
// (`sessionLinks` for one class, else `batchLinks`) at the moment of sending, so a teacher who changes it before the class is heard at once, and a retry after a lost
// send is told apart from a new link by that hash. The doubt's words are the shop's own state (the teacher reads them); the record keeps only a digest of the message.
import { createHash } from "node:crypto";

/** "yes" / "no" as the contact answered the first message; `askedAtMs` is when the question went. */
export interface Consent { askedAtMs: number; answer?: "yes" | "no"; answeredAtMs?: number }

export interface ClassSession {
  id: string;
  batchId: string;
  startMs: number;
  endMs: number;
  /** By student key (`studentKey`): the hashes of the links sent for this class. A link already sent is never sent again; a CHANGED link is sent once more. */
  sent: Record<string, string[]>;
  /** By student key: why the link was withheld, and when it was last looked at. The reason is said in the record once; the fee is read again at most every few minutes, not every beat. */
  withheld: Record<string, { reason: string; atMs: number }>;
  /** The teacher's marks, by student key. A student with no mark has not been marked. */
  marks: Record<string, "present" | "absent">;
  /** The owner was asked for attendance (once). */
  askedAtMs?: number;
  /** The teacher confirmed attendance (everyone marked): nothing more is asked, and the notes to parents of absent students go. */
  closedAtMs?: number;
  /** Student keys whose missed-class note has been dealt with (sent, maybe sent, or held back for good): never sent twice. */
  noted: string[];
  /** The owner was told no link is set for this class (once). */
  noLinkTold?: boolean;
}

export interface Doubt { id: string; parent: string; student: string; batchId: string; text: string; atMs: number; state: "open" | "answered" }

export interface ClassesState {
  /** By batch id: the teacher's class link for every class of the batch, until they paste another. */
  batchLinks: Record<string, string>;
  /** By class id: the link of that one class (it wins over the batch's). */
  sessionLinks: Record<string, string>;
  sessions: Record<string, ClassSession>;
  /** By the contact's number. */
  consent: Record<string, Consent>;
  doubts: Doubt[];
  nextDoubt: number;
  /** By the contact's number: this contact was asked to write a doubt, and the next message they send is it. */
  awaitingDoubt: Record<string, { student: string; atMs: number }>;
  /** By batch id: the owner was told about waiting doubts at this time (so one notice covers several). */
  doubtsToldAtMs: Record<string, number>;
}

export const emptyClasses = (): ClassesState => ({ batchLinks: {}, sessionLinks: {}, sessions: {}, consent: {}, doubts: [], nextDoubt: 1, awaitingDoubt: {}, doubtsToldAtMs: {} });

/** A student, as the classes' state names them: the contact's number and the name (the same two the settings use to tell students apart). */
export const studentKey = (parent: string, name: string): string => `${parent}|${name}`;

/** A link's hash: what a session remembers of a link it sent. Short, and nothing that can open the link. */
export const linkHash = (url: string): string => createHash("sha256").update(url).digest("hex").slice(0, 16);

/** The most recent classes kept: older ones are dropped, so the store does not grow with the years. */
export const KEEP_SESSIONS_MS = 60 * 24 * 3_600_000;
