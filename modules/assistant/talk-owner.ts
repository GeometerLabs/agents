// The owner's talk (block M): where the owner's words are not an ask or an act that the rules and the router know ("I didn't understand" before), the assistant answers as a
// conversation, in the owner's language, in the character's personality. The model gets the shop's name, the character, ALL open notes (the owner may see every one), the
// shop's own numbers from the skills (counts and money, never a customer's name or number) and the last six lines of the talk; the owner's words go in with numbers and
// links taken out first. It answers in sentences with their sources, and may propose one note or name one declared limit (an id, never a value). Checked like every talk reply
// (talk-check.ts). The talk never acts: an act is the owner's own words ("cancel b-14"), done through a card.
import type { Language } from "../language/languages.ts";
import { recall } from "../memory/memory.ts";
import type { MemoryState } from "../memory/memory.ts";
import { redact } from "../understanding/redact.ts";
import type { OwnerSkill } from "./skill.ts";
import type { TalkLine } from "./state.ts";
import { OWNER_CHARS, historyText, ownerPrompt } from "./talk-prompt.ts";
import type { PromptShop } from "./talk-prompt.ts";
import { runTalk, talkOff } from "./talk-run.ts";
import type { TalkEnv, TalkOffReason, TalkResult } from "./talk-run.ts";
import type { TalkSource } from "./talk-types.ts";

/** The room the notes get in the owner's prompt. */
export const OWNER_NOTES_BUDGET = 3000;

/**
 * What the limits half of the chat gives the talk (M2 implements it; until then there is none and the talk saves a rule as a note). `declared` lists the limits the owner may
 * tighten from the chat; `tighten` is called when the model named one: it is given the declared limit's id and the owner's own words, reads the value from the words by
 * rule, and answers true when it took the request (it tells the owner itself, with a card).
 */
export interface LimitHook {
  declared(): { id: string; about: string }[];
  tighten(a: { limitId: string; words: string }): Promise<boolean>;
}

export interface OwnerTalkDeps {
  env: TalkEnv;
  shop: PromptShop & { owner: { whatsapp: string } };
  memory: MemoryState | undefined;
  skills: readonly OwnerSkill[];
  chat: readonly TalkLine[];
  limits?: LimitHook;
}

export type OwnerTalk = { ran: false; reason: TalkOffReason } | { ran: true; result: TalkResult };

export async function ownerTalk(d: OwnerTalkDeps, a: { text: string; language: Language; key?: string }): Promise<OwnerTalk> {
  const off = talkOff(d.env, "owner_talk", a.key);
  if (off) return { ran: false, reason: off };
  const nowMs = d.env.clock.now();
  const notes: TalkSource[] = d.memory ? recall(d.memory, { audience: "owner", budget: OWNER_NOTES_BUDGET, nowMs }).map((n) => ({ id: n.id, kind: "note" as const, text: `${n.kind}${n.audience === "everyone" ? ", customers may be told" : ", owner only"}: ${n.text}` })) : [];
  const own: TalkSource[] = d.skills.flatMap((s) => s.facts?.(nowMs) ?? []);
  const publicSide: TalkSource[] = d.skills.flatMap((s) => s.publicContext?.("", nowMs).sources ?? []);
  const sources = [...notes, ...own, ...publicSide];
  const limits = d.limits?.declared() ?? [];
  const { system, schema } = ownerPrompt({ shop: d.shop, language: a.language, sources, limits });
  const result = await runTalk(d.env, {
    role: "owner", conversation: d.shop.owner.whatsapp, language: a.language, system, schema, user: historyText(d.chat) + redact(a.text).text, speakerText: a.text, feature: "owner_talk", ...(a.key !== undefined ? { key: a.key } : {}),
    scope: sources, links: d.skills.flatMap((s) => s.publicContext?.("", nowMs).links ?? []), literals: [d.shop.name], maxChars: OWNER_CHARS,
  });
  return { ran: true, result };
}
