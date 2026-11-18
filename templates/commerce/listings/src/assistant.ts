// The one skill a listings-only shop's assistant has of its own: none. The shop's listings are the shared listings skill (modules/assistant/listing-card.ts, added by
// assistantForAgent for every template), so this skill has nothing waiting, no cases, and refuses every act with "not here". It exists because the assistant needs a base skill
// to route by, and because the owner's talk then says plainly that this shop only shows what it has.
import type { OwnerSkill } from "../../../../modules/assistant/skill.ts";
import { SKILL } from "./state.ts";

export const shopSkill = (): OwnerSkill => ({
  name: SKILL,
  // no reference ever matches (a case is "b-3" or "po-3" elsewhere), and the shop sends customers no buttons
  routing: { refs: /^$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined },
  waiting: () => [],
  problems: () => 0,
  prepare: () => ({ ok: false, why: "not_here" }),
  execute: async () => ({ ok: false, note: "failed" }),
});
