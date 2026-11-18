// The directory's A2A Agent Card (specs/agent-card.md), served at /.well-known/agent-card.json. Field names are those of the A2A specification, version 1.0.1
// (github.com/a2aproject/A2A, tag v1.0.1, commit 3303592588e388e62e0f69f701af531d2f4e3991, specification/a2a.proto message AgentCard and docs/specification.md section 4.4
// and 8.4), in the JSON (camelCase) form the specification uses: name, description, supportedInterfaces[{url, protocolBinding, protocolVersion}], provider{organization,
// url}, version, documentationUrl, capabilities, defaultInputModes, defaultOutputModes, skills[{id, name, description, tags, examples, inputModes, outputModes}], signatures.
//
// Honesty about what is served: `protocolBinding` is an open string in the specification ("to be easily extended for other protocol bindings"). The directory serves NO A2A
// message endpoint yet, so it lists the two interfaces it does serve under their own names, "MCP" (the Model Context Protocol, protocolVersion is the MCP version) and
// "HTTPS-JSON" (the JSON search at /search, protocolVersion is directory's own "1"), and does not claim "JSONRPC", "GRPC" or "HTTP+JSON", which would promise A2A messages.
// A client that speaks only A2A finds no binding it knows and says so; one that speaks MCP uses the first. Per the specification's section 8.4.1, members that hold only a
// default value are left out (nothing is an empty list here), and the card is signed (a JWS over its RFC 8785 form: modules/signing/jws.ts) with the directory's own key.
import { signCard } from "../signing/jws.ts";
import type { SigningKey } from "../signing/keys.ts";
import { MCP_VERSIONS } from "../channels/mcp.ts";
import { CATEGORIES } from "./types.ts";

export interface DirectoryCardOptions {
  /** The directory's own address, https://<domain> with no path. */
  origin: string;
  /** Who runs this directory (the A2A `provider`): a name and an address. */
  provider: { organization: string; url: string };
  /** What the card says it covers ("Kerala"). Optional. */
  area?: string;
  key: SigningKey;
}

const JSON_ONLY = ["application/json"];

export function directoryCard(o: DirectoryCardOptions): Record<string, unknown> {
  const area = o.area ? ` in ${o.area}` : "";
  const card = {
    name: "Directory of local shops",
    description: `Finds what local shops have${area}: pets, food, clothes, things for the home and more. Search in English, Hindi, Malayalam or Kannada. Results come in a fair order (the best fit, then the nearest, shops at the same distance take turns; never by payment, plan or Operator) and each is confirmed with its shop when the shop answers. The order is explained at ${o.origin}/order.`,
    supportedInterfaces: [
      { url: `${o.origin}/mcp`, protocolBinding: "MCP", protocolVersion: MCP_VERSIONS[0] },
      { url: `${o.origin}/search`, protocolBinding: "HTTPS-JSON", protocolVersion: "1" },
    ],
    provider: o.provider,
    version: "1.0.0",
    documentationUrl: `${o.origin}/order`,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: JSON_ONLY,
    defaultOutputModes: JSON_ONLY,
    skills: [
      { id: "search_listings", name: "Search what local shops have", description: `Words, a category (${CATEGORIES.join(", ")}), the buyer's map point or town and a radius in; listings in the fair order out, each confirmed by its shop where the shop answers. Also at GET /search.`, tags: ["search", "local shops", "listings"], examples: ["Persian kitten near Thrissur", "second-hand bicycle within 10 km of 10.52, 76.21"], inputModes: JSON_ONLY, outputModes: JSON_ONLY },
      { id: "get_listing", name: "One listing, confirmed", description: "One listing by its shop's page address and id, with its words in every language and the shop's own confirmation that it is still there.", tags: ["listing", "availability"], examples: ["Is l-3 at https://streetlist.in/rani-pets/ still there?"], inputModes: JSON_ONLY, outputModes: JSON_ONLY },
      { id: "shop_page", name: "One shop", description: "A shop's name, trade, town, chat address and the listings it has.", tags: ["shop"], examples: ["Tell me about https://streetlist.in/rani-pets/"], inputModes: JSON_ONLY, outputModes: JSON_ONLY },
    ],
  };
  return signCard(card, o.key);
}
