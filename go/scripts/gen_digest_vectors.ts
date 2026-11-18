// Writes internal/assistant/testdata/digest-vectors.json: card fields and the digest the TypeScript runtime (modules/assistant/cards.ts actionDigest) gives them. The Go test reads it, so the
// two runtimes' digests are proved equal on the cases that tend to differ: `<>&`, U+2028 and U+2029, control characters, quotes and backslashes, an astral character, key order and
// numbers. Run with node from the repository root:  node go/scripts/gen_digest_vectors.ts
import { writeFileSync } from "node:fs";
import { actionDigest } from "../../modules/assistant/cards.ts";

const cases: Record<string, string | number | boolean>[] = [
  { category: "pets", ownerLang: "en", from: "app", photos: "", title_en: "Persian kittens", text_en: "Playful <kittens> & more", pricePaise: 800000, qty: 2 },
  { category: "pets", title_en: "line sep  \u0008\u000c\n\r\t\u0001\u001f \"q\" back\\slash \u007f", text_en: "emoji 🐱 and é and ക" },
  { a: true, b: false, c: 12.5, d: 0, e: -3, f: 1e21, g: 123456789012, h: "" },
  { "ü": 1, "z": 2, "a": 3, "Z": 4, "🐱": 5, "￿": 6, "": 7 },
  { claims: "vaccinated | pure breed", priceNote: "each", photos: "ph-aaaaaaaaaaaa,ph-bbbbbbbbbbbb" },
  { title: "Still have it?", confirmedMs: 1795024186120 },
];
const out = cases.map((fields, i) => ({ kind: i === 5 ? "listing_ask" : "listing", case: `listing:l-${i + 1}`, fields, digest: actionDigest({ kind: i === 5 ? "listing_ask" : "listing", skill: "listings", case: `listing:l-${i + 1}`, fields }) }));
writeFileSync(new URL("../internal/assistant/testdata/digest-vectors.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
