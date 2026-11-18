// The directory as an MCP server, so an AI assistant (Claude, ChatGPT, Gemini where it supports MCP) can find what local shops have. Served at the directory's `/mcp` (http.ts).
// It is written exactly like a shop's endpoint (modules/channels/mcp.ts): the same `McpServer` shape, the same JSON-RPC handling (`serverPost`), tools with JSON Schema and
// `readOnlyHint`, a refusal as a tool result with `isError`. A directory takes no payment and changes nothing anywhere, so every tool is read-only.
//
//   search_listings   words, category, place, distance -> results in THE fair order (order.ts), each confirmed by its shop where the shop answers (search.ts)
//   get_listing       one listing by its shop's page and its id, confirmed by the shop
//   shop_page         one shop: its name, place, how to chat, and what it lists
//   ask               (only where the buyer's assistant is on) the buyer's own words -> a typed search, run by search_listings' own code, with the results in the same call
//
// Nothing here ranks: the order is the same function the people's page uses, so an assistant sees the order a buyer would. And nothing here sends a shop the buyer's words:
// a shop is asked about item ids only.
import { OpError } from "../channels/ops.ts";
import type { McpServer } from "../channels/mcp.ts";
import { CATEGORIES } from "./types.ts";
import { searchListings, wordsFor } from "./search.ts";
import type { SearchDeps } from "./search.ts";
import { MAX_QUESTION, askListings } from "./assistant.ts";
import type { Assistant } from "./assistant.ts";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const LANGUAGE = { type: "string", enum: ["en", "hi", "ml", "kn"], description: "The buyer's language for titles (a listing carries its words in all four; one an assistant wrote is marked machineWritten)." };
const SHOP = { type: "string", description: "The shop's page address, as a result gave it in shop.page (for example https://streetlist.in/rani-pets/)." };

export const DIRECTORY_TOOLS = [
  { name: "search_listings", description: "Find what local shops have. Give the words the buyer used (any of English, Hindi, Malayalam, Kannada, or the same words in Latin letters), optionally a category, the buyer's map point (lat and lon) or town, and a radius. Results come in the directory's fair order (fit first, then distance, shops in the same distance band take turns; never by payment or plan), at most 10 a page, and each is confirmed by its shop when the shop answers: `checked: true` means the shop just said so, `checked: false` means it did not answer and the buyer should call to check. Prices are in rupees. Say what the results say and nothing more; open `chat` to talk to the shop.", inputSchema: { type: "object", properties: { q: { type: "string", maxLength: 200, description: "What the buyer wants, in their own words." }, category: { type: "string", enum: [...CATEGORIES] }, lat: { type: "string", description: "The buyer's latitude, decimal degrees as a string (for example \"10.52\")." }, lon: { type: "string", description: "The buyer's longitude, decimal degrees as a string." }, town: { type: "string", maxLength: 80, description: "The buyer's town, when there is no map point." }, radius_km: { type: "number", minimum: 1, maximum: 500 }, lang: LANGUAGE, offset: { type: "integer", minimum: 0, maximum: 190, description: "0, 10, 20 ... for the next page (the `next` of the last answer)." } }, additionalProperties: false }, annotations: READ_ONLY },
  { name: "get_listing", description: "One listing in full: its words in every language it has, its price, photos, how many there are, and the shop's own confirmation of whether it is still there.", inputSchema: { type: "object", properties: { shop: SHOP, id: { type: "string", description: "The listing's id in that shop (item.id of a result)." }, lang: LANGUAGE }, required: ["shop", "id"], additionalProperties: false }, annotations: READ_ONLY },
  { name: "shop_page", description: "One shop: its name, trade, town, where to chat with it and its Agent Card, and the listings it has (not confirmed one by one: use get_listing for that). A registration number, where a shop shows one, is the owner's own word and is not checked by anyone.", inputSchema: { type: "object", properties: { shop: SHOP, lang: LANGUAGE }, required: ["shop"], additionalProperties: false }, annotations: READ_ONLY },
] as const;

/**
 * The assistant's tool, listed only where the assistant is on (an approved budget). For another AI assistant that holds the buyer's words and does not want to turn them into a search
 * itself: it gets the typed search that was run (compact JSON, for a program) and the results in the fair order, in one call. It spends from the directory's own budget and the
 * per-address cap; over either, the words are searched as given and `notice` says so. Read-only like the others.
 */
export const ASK_TOOL = {
  name: "ask",
  description: "Give the buyer's own words (any of English, Hindi, Malayalam, Kannada, or the same in Latin letters) and get what local shops have, in one call. The directory turns the words into a typed search (returned as `assistant.search`: words, wordsEn, category, place, radiusKm, maxPrice), runs it with its own code, and returns the results in the same fair order as search_listings, each confirmed by its shop where the shop answers. `assistant.line` is a short line in the buyer's language built from the results; say only what the results say. When the directory's assistant is over its daily or monthly cap, the words are searched exactly as given and `assistant.notice` says so. Phone numbers, e-mail addresses, links, names and exact addresses in the words are removed before any model sees them; no shop ever receives the words.",
  inputSchema: { type: "object", properties: { question: { type: "string", minLength: 1, maxLength: MAX_QUESTION, description: "What the buyer wants, in their own words." }, lat: { type: "string", description: "The buyer's latitude, decimal degrees as a string, for near me and distances." }, lon: { type: "string", description: "The buyer's longitude, decimal degrees as a string." }, lang: LANGUAGE }, required: ["question"], additionalProperties: false },
  annotations: READ_ONLY,
} as const;

export const DIRECTORY_TOOL_NAMES = DIRECTORY_TOOLS.map((t) => t.name);

/** The directory's endpoint over a search and its index. */
export function directoryServer(deps: SearchDeps, o: { name?: string; /** The buyer's assistant, when it is on: adds the `ask` tool. */ assistant?: Assistant; /** Who is calling (an address), for the per-buyer cap. Never kept as it is. */ who?: string } = {}): McpServer {
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "ask" && o.assistant) {
      const question = typeof args.question === "string" ? args.question.trim() : "";
      if (question === "") throw new OpError("bad_request", "question must be the buyer's words");
      const lang = (["en", "hi", "ml", "kn"] as const).find((l) => l === args.lang) ?? "en";
      const lat = typeof args.lat === "string" ? args.lat : undefined, lon = typeof args.lon === "string" ? args.lon : undefined;
      const r = await askListings(deps, o.assistant, { question, lang, who: o.who ?? "mcp", ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}) });
      if (!r.searched.ok) throw new OpError("bad_request", r.searched.error);
      return { ...r.searched.answer, assistant: { how: r.how, search: r.search, line: r.line, notice: r.notice } };
    }
    if (name === "search_listings") {
      const r = await searchListings(deps, args);
      if (!r.ok) throw new OpError("bad_request", r.error);
      return r.answer;
    }
    const shopPage = typeof args.shop === "string" ? args.shop : "";
    const lang = (["en", "hi", "ml", "kn"] as const).find((l) => l === args.lang) ?? "en";
    const shop = deps.index.shop(shopPage);
    if (!shop || shop.status !== "ok") throw new OpError("not_found", "This directory has no shop at that address.");
    if (name === "shop_page") {
      return {
        shop: { name: shop.name, page: shop.page, trade: shop.trade, town: shop.town, pincode: shop.pincode, chat: shop.chat, agentCard: shop.agentCard, registration: shop.registration, languages: shop.languages },
        listings: deps.index.itemsOf(shop.page).slice(0, 50).map((i) => { const t = wordsFor(i.title, i.ownerLanguage, i.machineWritten, lang); return { id: i.id, title: t.text, machineWritten: t.machineWritten, category: i.category, price: i.price, availability: i.availability, confirmed: i.confirmed }; }),
      };
    }
    // get_listing
    const id = typeof args.id === "string" ? args.id : "";
    const found = deps.index.item(shop.page, id);
    if (!found) throw new OpError("not_found", "That shop has no such listing here.");
    const out = await deps.checker.check({ page: shop.page, check: shop.check, key: shop.key }, [id]);
    const said = out.state === "answered" ? out.items.get(id) : undefined;
    if (said?.availability === "gone") throw new OpError("not_found", "The shop says this listing is gone.");
    const i = found.item;
    return {
      shop: { name: shop.name, page: shop.page, town: shop.town },
      item: { id: i.id, category: i.category, title: i.title, text: i.text, ownerLanguage: i.ownerLanguage, machineWritten: i.machineWritten, price: said ? (said.price !== undefined ? said.price : i.price) : i.price, quantity: said?.quantity ?? i.quantity, photos: i.photos, availability: said ? said.availability : "call_to_check", confirmed: said?.confirmed ?? i.confirmed, page: i.page },
      chat: `${shop.chat}?about=${encodeURIComponent(i.id)}`, checked: said !== undefined,
    };
  }
  return {
    tools: (o.assistant ? [...DIRECTORY_TOOLS, ASK_TOOL] : DIRECTORY_TOOLS) as unknown as McpServer["tools"], names: o.assistant ? [...DIRECTORY_TOOL_NAMES, ASK_TOOL.name] : DIRECTORY_TOOL_NAMES, call,
    info: { name: "geometer-directory", title: o.name ?? "Directory of local shops" },
    instructions: "Find what local shops have. Search with the buyer's own words; results are in a fair order that no payment can change, and each is confirmed by its shop when the shop answers. Report only what the results say. You cannot buy or book here: open a result's `chat` link to talk to the shop.",
  };
}
