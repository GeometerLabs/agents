// A shop's A2A Agent Card (specs/agent-card.md, "What a shop's card says"), served at `<shop page>/agent-card.json` while the owner's switch "Show my shop on Streetlist and in search" is on.
// It follows the field names of the A2A specification, version 1.0.1 (the same ones modules/discovery/card.ts, the directory's own card, uses): name, description, supportedInterfaces
// [{url, protocolBinding, protocolVersion}], provider {organization, url}, version, documentationUrl, capabilities, defaultInputModes, defaultOutputModes, skills [{id, name, description, tags,
// examples, inputModes, outputModes}]. Members that hold only a default value are left out, as the specification's section 8.4.1 asks, because the card is then signed (a JWS over its
// RFC 8785 form, modules/signing/jws.ts) with the SHOP'S key by the shop's runtime: this file builds the card, it never holds a key.
//
// Honesty about what is served: `protocolBinding` is an open string in the specification. A shop serves no A2A message endpoint, so it lists the two interfaces it does serve under their own
// names, "MCP" (its endpoint, for the kinds of shop that have one) and "HTTPS-JSON" (its JSON API), and never "JSONRPC", "GRPC" or "HTTP+JSON", which would promise A2A messages.
//
// The skills are a parameter, not read from the shop's template here, so this file imports nothing about the listings: `skillsFor` below builds the list from the shop's own tools, the same
// list the API and the MCP endpoint are made from (mcp.ts TOOLS and ORDER_TOOLS), and adds `show_listings` and `check_items`.
import { MCP_VERSIONS, ORDER_TOOLS, TOOLS } from "./mcp.ts";

const JSON_ONLY = ["application/json"];

export interface CardSkill { id: string; name: string; description: string; tags: string[]; examples: string[]; inputModes: string[]; outputModes: string[] }
export interface ShopCardOptions {
  name: string;
  /** The shop's trade in plain words, when the runtime can see it (it cannot today: the card then says "a local shop"). */
  trade?: string;
  /** The shop's page as the feed writes it: https, ending in "/". */
  page: string;
  skills: CardSkill[];
  /** Does the shop have an MCP endpoint? Bookings and Orders do; a Fees centre and a Stock orders shop do not. */
  mcp: boolean;
}

/** The card, unsigned. The runtime signs it with the shop's key (signCard) before it is served. */
export function shopCard(o: ShopCardOptions): Record<string, unknown> {
  const what = o.trade ? `${o.trade}` : "a local shop";
  return {
    name: o.name,
    description: `${o.name} is ${what} on Streetlist. A program can read what the shop has, ask the shop to confirm an item is still there and at what price, and use the shop's own operations. Everything is answered from the shop's own record, with no language model, and signed with the shop's own key.`,
    supportedInterfaces: [
      ...(o.mcp ? [{ url: `${o.page}mcp`, protocolBinding: "MCP", protocolVersion: MCP_VERSIONS[0] }] : []),
      { url: `${o.page}api/v1`, protocolBinding: "HTTPS-JSON", protocolVersion: "1" },
    ],
    provider: { organization: o.name, url: o.page },
    version: "1.0.0",
    documentationUrl: `${o.page}shop`,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: JSON_ONLY,
    defaultOutputModes: JSON_ONLY,
    skills: o.skills,
  };
}

/** One example per operation, in plain words, for the card's `examples`. */
const EXAMPLES: Record<string, string> = {
  list_services: "What services does the shop offer, and at what price?",
  free_slots: "When is a haircut free this week?",
  start_booking: "Book a haircut on Saturday at 4 pm for Asha.",
  payment_instructions: "How do I pay the deposit for booking <handle>?",
  booking_status: "Is booking <handle> confirmed?",
  cancel_booking: "Cancel booking <handle>.",
  list_items: "What is on the menu today, and what is left?",
  start_order: "Two plates of biryani for pickup at 1 pm.",
  order_status: "Is order <handle> confirmed?",
  cancel_order: "Cancel order <handle>.",
};

const titleOf = (id: string): string => id.replace(/_/gu, " ").replace(/^./u, (c) => c.toUpperCase());
const skill = (id: string, name: string, description: string, tags: string[], examples: string[]): CardSkill => ({ id, name, description, tags, examples, inputModes: JSON_ONLY, outputModes: JSON_ONLY });

/** `show_listings` and `check_items`: what every shop that shows listings serves, whatever its template. */
export const LISTING_SKILLS: CardSkill[] = [
  skill("show_listings", "What the shop has", "The shop's feed (shop-feed/1): every listing the owner shows, with its words in each language, its price, its photos and when the owner last confirmed it. GET listings.json, signed with the shop's key.", ["listings", "feed"], ["What does the shop have today?"]),
  skill("check_items", "Do you still have these?", "Ask whether up to ten items are still there and at what price (shop-check/1). The answer is read from the shop's own record, carries the time it was made and is signed with the shop's key. It tells the shop nothing about who is asking.", ["availability", "price"], ["Do you still have l-3 and l-7?"]),
];

/** The skills of a shop of this kind: the two listing skills, then one per operation of its own API (check_items is already named above, so it is not listed twice). */
export function skillsFor(kind: "bookings" | "orders" | "fees" | "stock"): { skills: CardSkill[]; mcp: boolean } {
  const tools = kind === "bookings" ? TOOLS : kind === "orders" ? ORDER_TOOLS : [];
  return {
    skills: [...LISTING_SKILLS, ...tools.filter((t) => t.name !== "check_items").map((t) => skill(t.name, titleOf(t.name), t.description, [kind], [EXAMPLES[t.name] ?? titleOf(t.name)]))],
    mcp: tools.length > 0,
  };
}
