// The dev harness: the Stock orders agent wired to the in-memory fakes, with a clock you can move and helpers that play the owner and the suppliers. The crash-test
// situations, the hand check and the tests build on this. Nothing here is the agent: it only feeds it messages and reads what the fakes hold.
import { readFileSync } from "node:fs";
import { fakeClock } from "../../../../modules/core/clock.ts";
import type { FakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { FakeMessaging, InboundMessage, OutboundMessage } from "../../../../modules/messaging/messaging.ts";
import { createRecord } from "../../../../modules/record/record.ts";
import type { ActionRecord } from "../../../../modules/record/record.ts";
import { createAgent } from "./agent.ts";
import type { Agent } from "./agent.ts";
import { REPORT_TEMPLATE_NAMES } from "../report/whatsapp.ts";
import { META_TEMPLATE_NAMES } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES } from "./language/templates.ts";
import { createStore } from "./order.ts";
import type { PurchaseOrder, Store } from "./order.ts";
import { parseSettings } from "./settings.ts";
import type { Settings } from "./settings.ts";

// Each example is read with a literal file name: the browser build (scripts/build-demo.ts) copies the files a template reads by finding them in the code.
/** Glow Unisex Salon, the example shop: a salon with three suppliers (one paused), hair colour by the box or by the piece. */
export const glowSalon = (): Settings => parseSettings(JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")));

/** The example's suppliers, by the numbers in its settings. */
export const RAVI = "+919876500001";
export const MEENA = "+919876500002";
export const KUMAR = "+919876500003";

export interface World {
  settings: Settings;
  clock: FakeClock;
  messaging: FakeMessaging;
  record: ActionRecord;
  store: Store;
  agent: Agent;
  owner: string;
  /** The owner writes. Pass `id` to reuse a WhatsApp message id (a redelivery). */
  ownerSays(text: string, options?: { id?: string }): Promise<InboundMessage>;
  /** The owner taps a button or list row of the newest interactive message the agent sent them that has that id. */
  ownerTaps(id: string): Promise<InboundMessage>;
  /** A supplier (by number) writes, or taps a button the order message carried. */
  supplierSays(from: string, text: string, options?: { reply?: { id: string; kind: "button" | "list" } }): Promise<InboundMessage>;
  /** The provider delivers the same inbound message again. */
  redeliver(message: InboundMessage): Promise<void>;
  advance(minutes: number): Promise<void>;
  tick(): Promise<void>;
  /** A new agent on the SAME store, record and fakes with other settings: the settings were edited and the shop restarted. */
  reload(settings: Settings): void;
  textsTo(number: string): string[];
  lastTextTo(number: string): string;
  /** The one-use code of the newest approval card the owner was sent, read from the owner's own message (it is only ever there). */
  cardCode(): string;
  /** What the owner types to approve the newest card. */
  approveText(): string;
  /** Messages to a supplier that carry an order (the order message itself, not a reminder). */
  orderMessagesTo(number: string): OutboundMessage[];
  order(ref: string): PurchaseOrder | undefined;
  orders(): PurchaseOrder[];
}

export interface WorldOptions {
  settings?: Settings;
  /** The moment the world starts; default Mon 9 Nov 2026, 10:00 in India. */
  nowMs?: number;
  /** WhatsApp template names the provider has NOT approved (so sending one is refused outright, the way Meta refuses an unapproved template). */
  unapproved?: string[];
}

export function createWorld(options: WorldOptions = {}): World {
  let settings = options.settings ?? glowSalon();
  const clock = fakeClock(options.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone));
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES, ...REPORT_TEMPLATE_NAMES]) if (!options.unapproved?.includes(name)) for (const language of LANGUAGES) messaging.approve(name, language);
  const record = createRecord(clock);
  const store = createStore();
  let agent = createAgent({ settings, clock, messaging, record, store });

  const world: World = {
    settings, clock, messaging, record, store, get agent() { return agent; }, owner: settings.owner.whatsapp,
    async ownerSays(text, o = {}) {
      const message = messaging.receive(world.owner, text, o.id ? { id: o.id } : {});
      await agent.handle({ kind: "message", message });
      return message;
    },
    async ownerTaps(id) {
      const shown = messaging.sentTo(world.owner).filter((m) => m.interactive).reverse().map((m) => m.interactive!).find((i) => [...(i.buttons ?? []), ...(i.list?.rows ?? [])].some((c) => c.id === id));
      const option = [...(shown?.buttons ?? []), ...(shown?.list?.rows ?? [])].find((c) => c.id === id);
      if (!shown || !option) throw new Error(`No buttons the owner was sent have an option with the id "${id}".`);
      const message = messaging.receive(world.owner, option.title, { reply: { id, kind: shown.buttons ? "button" : "list" } });
      await agent.handle({ kind: "message", message });
      return message;
    },
    async supplierSays(from, text, o = {}) {
      const message = messaging.receive(from, text, o.reply ? { reply: o.reply } : {});
      await agent.handle({ kind: "message", message });
      return message;
    },
    async redeliver(message) { await agent.handle({ kind: "message", message }); },
    async advance(minutes) { clock.advanceMinutes(minutes); await agent.handle({ kind: "tick" }); },
    tick: () => agent.handle({ kind: "tick" }),
    reload(next) { settings = next; world.settings = next; agent = createAgent({ settings: next, clock, messaging, record, store }); },
    textsTo: (number) => messaging.sentTo(number).map((m) => m.text),
    lastTextTo: (number) => messaging.sentTo(number).at(-1)?.text ?? "",
    cardCode() {
      const texts = messaging.sentTo(world.owner).map((m) => m.text).reverse();
      // the agent's own card quotes the words ("yes K7X2"); the assistant's card line (modules/assistant/words.ts) says them plainly (reply yes K7X2), and either is the newest card
      for (const t of texts) { const m = /"yes ([A-Z0-9]{4,6})"/u.exec(t) ?? /“yes ([A-Z0-9]{4,6})”/u.exec(t) ?? /\byes ([A-Z0-9]{4,6})\b/u.exec(t); if (m) return m[1]; }
      throw new Error("No approval card has been sent to the owner.");
    },
    approveText: () => `yes ${world.cardCode()}`,
    orderMessagesTo: (number) => messaging.sentTo(number).filter((m) => m.templateName === "stock_order_to_supplier" || /^(?:New order|नया ऑर्डर|പുതിയ ഓർഡർ|ಹೊಸ ಆರ್ಡರ್)/u.test(m.text)),
    order: (ref) => store.orders.get(ref),
    orders: () => [...store.orders.values()],
  };
  return world;
}
