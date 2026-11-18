// The agent of a listings-only shop. It does one job: hand the owner's words to the shop's assistant, which drafts listings, asks "Still have it?", and answers. It books
// nothing, takes no order, chases no fee, sends no WhatsApp message and moves no money, so there is nothing here to guard but the assistant's own cards (which the owner
// taps; modules/assistant/cards.ts) and the listings rules (modules/listings). The listings events from the owner's app (a photo, the form, Confirm, Sold, the switch) are
// the runtime's own and never reach this file (modules/runtime/core.ts).
//
// The place the Operator gave at setup is written into the shop's listings ONCE, on the first step, with the panel's authority, so the page shows the town before the owner
// has typed anything. After that the owner's own words win: this never overwrites a place the owner changed.
import { assistantForAgent } from "../../../../modules/assistant/wire.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import { assistantOf } from "../../../../modules/assistant/state.ts";
import { listingsOf, setShop } from "../../../../modules/listings/listings.ts";
import { panelAuthority } from "../../../../modules/memory/memory.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { ActionRecord, Outcome } from "../../../../modules/record/record.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { TalkModel } from "../../../../modules/understanding/talk.ts";
import type { RuntimeEvent } from "../../../../modules/runtime/events.ts";
import { shopSkill } from "./assistant.ts";
import { CHAT_LIMITS } from "./chat-limits.ts";
import type { Settings } from "./settings.ts";
import type { Store } from "./state.ts";

export interface AgentDeps {
  settings: Settings;
  clock: Clock;
  /** The owner's messaging: a push-only stand-in (this shop has no WhatsApp), which refuses a send with the plain sentence the owner's app then lists. */
  messaging: Messaging;
  record: ActionRecord;
  store: Store;
  ai?: AiPolicy;
  ownerParser?: OwnerParser;
  talker?: TalkModel;
}

export function createAgent(deps: AgentDeps): { handle(event: RuntimeEvent): Promise<void> } {
  const { settings, store, clock, record } = deps;
  const owner = settings.owner.whatsapp;
  const log = (action: string, outcome: Outcome, inputs: unknown, more: { notes?: string; refs?: Record<string, string> } = {}) =>
    record.append({ conversation: owner, booking: null, action, inputs, outcome, language: settings.owner.language, ...more } as never);

  const assistant = assistantForAgent({
    limits: CHAT_LIMITS, settings, store, clock, messaging: deps.messaging, record, policy: deps.ai ?? {}, ...(deps.ownerParser ? { ownerParser: deps.ownerParser } : {}), ...(deps.talker ? { talker: deps.talker } : {}),
    skill: shopSkill(),
    log: (_caseId, phone, action, outcome, inputs, more) => { record.append({ conversation: phone, booking: null, action, inputs, outcome, language: settings.owner.language, ...more } as never); },
    ownerNotice: async (notice) => { log("assistant_notice", "failed", { notice }, { notes: `the shop's assistant could not read the owner's words (${notice})` }); },
    languageOf: () => settings.owner.language,
    optedOut: () => false,
  })!;

  /** First step only: the place from setup, put in the listings where the owner's own place would go. */
  function seedPlace(): void {
    const s = listingsOf(assistantOf(store));
    if (s.shop.town !== undefined || s.shop.pincode !== undefined) return;
    const r = setShop(s, panelAuthority("operator"), { town: settings.place.town, ...(settings.place.pincode ? { pincode: settings.place.pincode } : {}) });
    if (r.ok) log("listing", "confirmed", { place: "set at setup" }, { notes: "the Operator's place from setup was written into the shop's listings; the owner can change it in their app" });
  }

  return {
    async handle(event) {
      seedPlace();
      if (event.kind === "tick") { await assistant.onTick(); return; }
      if (event.kind === "owner_message") { await assistant.onPageMessage({ id: `owner-page:${event.id}`, from: owner, text: event.text, timestamp: clock.now() }); return; }
      if (event.kind === "owner_action") {
        // a card's yes or no from the owner's page: judged by the assistant's own judge (cards.ts), exactly as a tap on WhatsApp would be
        if (event.action === "card_yes" || event.action === "card_no") await assistant.onPageCard({ card: event.case, digest: event.digest, answer: event.action === "card_yes" ? "yes" : "no" });
        return;
      }
      // every other kind (a sign-in, an access note, a listings event) is the runtime's own. A customer's chat is not offered by this shop at all (the front answers 404 for it:
      // modules/channels/front.ts, kind "listings"), so a chat message cannot arrive; if one did, it is ignored and nothing is sent.
    },
  };
}
