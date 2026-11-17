// The shapes the shop's talk (block M) passes around: the sources a reply may rest on, the model's answer as sentences that each name their sources, and what a skill
// gives the talk (its own numbers for the owner, its public context for a customer). Types only, plus the one function that reads the model's JSON into the answer type,
// so a template's agent imports this without pulling in the model or the price table.
import { isObj } from "../understanding/model.ts";

/**
 * One thing a reply may rest on. The prompt lists every source the speaker may see, each with its id; the model names the ids a sentence rests on; the checks
 * (talk-check.ts) read each sentence against only the sources it names.
 *  - "note": a note of the shop's memory (the id is the note's: "n-3");
 *  - "setting": something the shop's settings say (a service and its price, the opening hours, the deposit): ids start "s:";
 *  - "record": something read from the shop's saved state in this step (free times, the customer's own open case, the shop's counts): ids start "r:".
 * Only a note or a setting can back a claim or a commitment ("we will", "free", "discount"); a record read states what is so, and promises nothing.
 */
export interface TalkSource {
  id: string;
  kind: "note" | "setting" | "record";
  /** What the model reads, in the shop's own words or the plain words of the read. Every number, date and amount a reply states must be in here or in the structured values. */
  text: string;
  /** Rupee amounts the source states, when it states them in a form the text does not show (a price list kept as numbers). */
  amountsInr?: number[];
  /** Moments the source states (free times). The reply may state them formatted the way every other message does. */
  momentsMs?: number[];
  /** Names the reply may repeat as they are (a service's name, a staff member's, the shop's own phone number). */
  literals?: string[];
}

/** A sentence of the reply and the ids of the sources it rests on (none for a plain courtesy such as "How can I help?"). */
export interface TalkSentence { text: string; sources: string[] }

/** What the model's JSON comes to, once read. A customer's has no note and no limit: the customer schema does not ask for them and a reply that carries them has them dropped. */
export interface TalkAnswer {
  sentences: TalkSentence[];
  /** The customer's turn: the owner should be asked (the assistant offers the template's "talk to the owner" and never says the owner will do anything). */
  askOwner: boolean;
  /** The owner's turn: one note worth remembering. A person confirms it with a tap. */
  note?: { kind: string; text: string; audience?: "owner" | "everyone" };
  /** The owner's turn: the declared limit the owner means, by id. Never a value. */
  limit?: string;
}

const MAX_SENTENCES = 8;

/** Read the model's JSON into a TalkAnswer, or null when it is not one. Nulls are dropped first (a strict schema makes every field required and nullable). */
export function readTalkAnswer(raw: unknown, role: "owner" | "customer"): TalkAnswer | null {
  if (!isObj(raw) || !Array.isArray(raw.sentences) || raw.sentences.length === 0 || raw.sentences.length > MAX_SENTENCES) return null;
  const sentences: TalkSentence[] = [];
  for (const s of raw.sentences) {
    if (!isObj(s) || typeof s.text !== "string" || s.text.trim() === "") return null;
    const sources = s.sources === null || s.sources === undefined ? [] : s.sources;
    if (!Array.isArray(sources) || !sources.every((x) => typeof x === "string")) return null;
    sentences.push({ text: s.text.trim(), sources: [...new Set(sources as string[])] });
  }
  const out: TalkAnswer = { sentences, askOwner: raw.ask_owner === true };
  if (role === "owner") {
    if (isObj(raw.note) && typeof raw.note.kind === "string" && typeof raw.note.text === "string") {
      out.note = { kind: raw.note.kind, text: raw.note.text, ...(raw.note.audience === "owner" || raw.note.audience === "everyone" ? { audience: raw.note.audience } : {}) };
    }
    if (typeof raw.limit === "string" && raw.limit !== "") out.limit = raw.limit;
  }
  return out;
}

/** What a skill gives the owner's talk: the shop's own numbers (counts and money by weekday and week, top services, cancellations, unpaid fees, open orders). Counts only: no customer's name or number. */
export type SkillFactsRead = (nowMs: number) => TalkSource[];

/** What a skill gives a customer's talk: the shop's public context and this customer's own open case, and the shop's own links. */
export interface PublicContext {
  sources: TalkSource[];
  /** The addresses the shop's own pages have: the only links a reply may carry. */
  links: string[];
}
export type PublicContextRead = (phone: string, nowMs: number) => PublicContext;
