// The store of a listings-only shop. It is almost empty on purpose: the shop's listings, photos' bookkeeping, cards and the owner's talk all live in `assistant`
// (modules/assistant/state.ts: `assistant.listings` holds the listings), and the month's AI counts in `ai`. There are no cases (no bookings, orders or fees), so there is
// no map to keep. The same two fields are in every other template's store, which is what lets a shop that later takes an agent keep its listings: the deployer carries
// `assistant` and `ai` over into the new template's store (bundle/lib/listings-move.ts), and nothing else needs translating.
import type { AssistantState } from "../../../../modules/assistant/state.ts";
import type { AiState } from "../../../../modules/understanding/ai-state.ts";

export interface Store {
  /** The assistant's part: its cards, memory, talk and `listings` (modules/listings). */
  assistant?: AssistantState;
  /** The month's AI counts (modules/understanding/ai-state.ts), kept with the store. */
  ai?: AiState;
}

export const createStore = (): Store => ({});
/** The skill's name in the record. */
export const SKILL = "listings-only";
