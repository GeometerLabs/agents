// A customer's talk (block M): where the rules and the router know no answer (the customer used to get the menu with "I didn't understand"), the assistant may answer in
// the customer's language, in the character's personality, from what the SHOP has said it may tell customers. Everything is chosen by code, before the prompt is built:
//  - the notes for everyone (never an owner-only one), the shop's public settings (services, prices, hours), the next free times, and this customer's own open case;
//  - the customer's words, with numbers, links and names taken out (understanding/redact.ts) before any model sees them.
// What comes back is checked (talk-check.ts) and only then sent. This file never writes memory and never makes an authority: a customer's message has no path to a note (a
// test reads this file's source to keep it so). It does nothing at all (the caller keeps the template's own menu) when the shop turned customer talk off, the talk is off
// (no model, button mode, the AI cap, the shop's month budget or the day's cap on customers' questions), or the message tried to change the rules.
import type { Language } from "../language/languages.ts";
import { recall } from "../memory/memory.ts";
import type { MemoryState } from "../memory/memory.ts";
import { redact } from "../understanding/redact.ts";
import type { OwnerSkill } from "./skill.ts";
import { CUSTOMER_CHARS, customerPrompt } from "./talk-prompt.ts";
import type { PromptShop } from "./talk-prompt.ts";
import { runTalk, talkOff } from "./talk-run.ts";
import type { TalkEnv, TalkResult } from "./talk-run.ts";
import type { TalkSource } from "./talk-types.ts";

/** The room the notes for everyone get in a customer's prompt. */
export const CUSTOMER_NOTES_BUDGET = 1500;

export interface CustomerTalkDeps {
  env: TalkEnv;
  shop: PromptShop;
  /** `assistant.talk.customers` (default true). */
  customersOn: boolean;
  memory: MemoryState | undefined;
  skills: readonly OwnerSkill[];
}

export type CustomerTalk = { sent: false; reason: string } | { sent: true; result: Extract<TalkResult, { ok: true }> } | { sent: false; reason: "check" | "no_answer"; result: Extract<TalkResult, { ok: false }> };

/** The sources a customer's prompt may hold: notes for everyone, and each skill's public context for this customer. */
export function customerScope(d: Pick<CustomerTalkDeps, "memory" | "skills">, phone: string, nowMs: number): { sources: TalkSource[]; links: string[] } {
  const notes: TalkSource[] = d.memory ? recall(d.memory, { audience: "everyone", budget: CUSTOMER_NOTES_BUDGET, nowMs }).map((n) => ({ id: n.id, kind: "note" as const, text: n.text })) : [];
  const contexts = d.skills.map((s) => s.publicContext?.(phone, nowMs)).filter((c) => c !== undefined);
  return { sources: [...notes, ...contexts.flatMap((c) => c.sources)], links: contexts.flatMap((c) => c.links) };
}

export async function customerTalk(d: CustomerTalkDeps, a: { phone: string; text: string; language: Language; overrideAttempt?: boolean }): Promise<CustomerTalk> {
  if (!d.customersOn) return { sent: false, reason: "customers_off" };
  const off = talkOff(d.env, "customer_talk");
  if (off) return { sent: false, reason: off };
  if (a.overrideAttempt) return { sent: false, reason: "override_attempt" }; // "ignore your rules": the menu, with nothing asked of a model
  const nowMs = d.env.clock.now();
  const { sources, links } = customerScope(d, a.phone, nowMs);
  const { system, schema } = customerPrompt({ shop: d.shop, language: a.language, sources });
  const result = await runTalk(d.env, {
    role: "customer", conversation: a.phone, language: a.language, system, schema, user: redact(a.text).text, speakerText: a.text, feature: "customer_talk",
    scope: sources, links, literals: [d.shop.name], maxChars: CUSTOMER_CHARS,
  });
  return result.ok ? { sent: true, result } : { sent: false, reason: result.why, result };
}
