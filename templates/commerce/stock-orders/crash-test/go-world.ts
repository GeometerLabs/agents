// The world a Stock orders crash-test situation runs in, on the shop's own Go program (go/cmd/stock-orders; owner, 24 Nov 2026: "Run the hand check on Go"). The shared part
// (the program started on the shop's settings in front of the stand-ins, the steps, the reads of agent.db) is modules/crash-test/go-world.ts; what is Stock orders' own is
// here: its one service (WhatsApp: the shared stand-in, modules/standins/whatsapp.ts, with this template's approved messages), its saved state, and the members its situations
// read (the owner's card code, the messages that carry an order), named as in the demo engine's world (src/harness.ts) so a situation reads the same. It takes no payment, so
// it has no payments Guard.
import { readFileSync } from "node:fs";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { openGoWorld, settingsJson } from "../../../../modules/crash-test/go-world.ts";
import type { GoWorldBase } from "../../../../modules/crash-test/go-world.ts";
import type { InboundMessage, OutboundMessage } from "../../../../modules/messaging/messaging.ts";
import { serveHandlers } from "../../../../modules/standins/http.ts";
import { approveTemplates, whatsappStandin } from "../../../../modules/standins/whatsapp.ts";
import { REPORT_TEMPLATES } from "../report/whatsapp.ts";
import { parseStore } from "../server/snapshot.ts";
import { META_TEMPLATES } from "../src/language/meta-templates.ts";
import type { PurchaseOrder, Store } from "../src/order.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

/** The program the hand check runs (go/cmd/stock-orders), and the template version it serves (pathway.lock). */
export const PROGRAM = "stock-orders";
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export interface GoWorldOptions {
  settings: Settings;
  /** The shop's time when it starts; default Mon 9 Nov 2026, 10:00 in the shop's zone (the demo world's). */
  nowMs?: number;
  /** WhatsApp template names the provider has NOT approved (so sending one is refused outright, the way Meta refuses an unapproved template). */
  unapproved?: string[];
}

export interface GoWorld extends GoWorldBase<Settings, Store> {
  ownerTaps(id: string): Promise<InboundMessage>;
  /** A supplier (by number) writes, or taps a button the order message carried. */
  supplierSays(from: string, text: string, options?: { reply?: { id: string; kind: "button" | "list" } }): Promise<InboundMessage>;
  /** The settings were edited and the shop restarted: the program starts again on the SAME data with the new settings.json. */
  reload(settings: Settings): Promise<void>;
  cardCode(): string;
  approveText(): string;
  orderMessagesTo(number: string): OutboundMessage[];
  order(ref: string): PurchaseOrder | undefined;
  orders(): PurchaseOrder[];
}

export async function createGoWorld(o: GoWorldOptions): Promise<GoWorld> {
  // the stand-in knows every template (it renders their words) and the provider has approved all but `unapproved`: a situation approves one later, as Meta would
  const catalogue = { templates: [...META_TEMPLATES, ...REPORT_TEMPLATES] };
  const approved = { templates: catalogue.templates.filter((t) => !o.unapproved?.includes(t.name)) };
  const base = await openGoWorld<Settings, Store>({
    program: PROGRAM, version: VERSION, settings: o.settings, at: o.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, o.settings.timezone),
    customer: o.settings.owner.whatsapp, parseStore, parseSettings, gateway: false,
    standins: async (_clock, fakes) => { approveTemplates(fakes.messaging, approved); return serveHandlers([whatsappStandin(fakes.messaging, catalogue, { phoneNumberId: "100000000000001" })]); },
  });
  const world: GoWorld = Object.assign(base, {
    ownerTaps: (id: string) => base.tap(id, { from: base.owner }),
    supplierSays: (from: string, text: string, m: { reply?: { id: string; kind: "button" | "list" } } = {}) => base.say(text, { from, ...(m.reply ? { reply: m.reply } : {}) }),
    async reload(next: Settings) { base.shop.writeFile("settings.json", settingsJson(next)); base.settings = next; await base.shop.restart(); },
    cardCode() {
      const texts = base.messaging.sentTo(base.owner).map((m) => m.text).reverse();
      // the agent's own card and the assistant's card line both say the words plainly (reply yes K7X2), and either is the newest card (src/harness.ts cardCode)
      for (const t of texts) { const m = /\byes ([A-Z0-9]{4,6})\b/u.exec(t); if (m) return m[1]; }
      throw new Error("No approval card has been sent to the owner.");
    },
    approveText: () => `yes ${world.cardCode()}`,
    orderMessagesTo: (number: string) => base.messaging.sentTo(number).filter((m) => m.templateName === "stock_order_to_supplier" || /^(?:New order|नया ऑर्डर|പുതിയ ഓർഡർ|ಹೊಸ ಆರ್ಡರ್)/u.test(m.text)),
    order: (ref: string) => base.store.orders.get(ref),
    orders: () => [...base.store.orders.values()],
  });
  return world;
}
