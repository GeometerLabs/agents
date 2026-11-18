// Contract cases for Unicode normalisation: a phone may send Malayalam, Kannada and Hindi composed or decomposed (a vowel sign as its two halves, a nukta letter as letter + U+093C), and a
// listings shop must judge the two the same way. The TypeScript runtime does it with String.prototype.normalize: `plain` (modules/language/format.ts) puts text in NFC before the number,
// banned-word and claim checks, and talk-check.ts `fold` compares in NFD with the Devanagari nukta dropped. The Go runtime does the same with golang.org/x/text/unicode/norm. Each case
// is aimed at a place where normalisation decides the answer, and each decomposed input is asserted to REALLY be decomposed (so the case cannot pass by accident).
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { draftAnswer, makeShop, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";

const shops: Shop[] = [];
const fakes: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const f of fakes) await f.close(); });

const nfd = (s: string): string => s.normalize("NFD");
/** The owner's words are sent decomposed; the model's answer is whatever the case says. */
async function draft(owner: string, answer: (o: string) => unknown): Promise<any[]> {
  const fake = await startFakeModel(answer); fakes.push(fake);
  const s = await makeShop({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 10 } } }); shops.push(s); await s.start();
  const r = await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id: "u-1", text: owner }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
  assert.equal(fake.calls, 1, "the words were taken as a listing and the model was asked");
  return (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body.listings;
}

describe("normalisation: composed and decomposed text are judged the same", () => {
  const KANNADA_CERTIFIED = "ಪ್ರಮಾಣೀಕೃತ"; // contains U+0CC0, which decomposes to U+0CBF U+0CD5
  const SPEC = "Kittens for sale on my page, 500 rupees";

  test("a Kannada banned word (certified) the model wrote is refused whether it was composed or decomposed", async () => {
    assert.notEqual(nfd(KANNADA_CERTIFIED), KANNADA_CERTIFIED);
    for (const title of [`${KANNADA_CERTIFIED} ಬೆಕ್ಕು`, nfd(`${KANNADA_CERTIFIED} ಬೆಕ್ಕು`)]) {
      const listings = await draft(SPEC, () => ({ ...draftAnswer() as object, titles: { en: "Kittens", hi: "Kittens", ml: "Kittens", kn: title } }));
      assert.equal(listings.length, 0, `refused: ${[...title].map((c) => c.codePointAt(0)!.toString(16)).join(" ")}`);
    }
  });

  test("a claim the owner made in decomposed Malayalam matches the model's composed copy of it (and the reverse)", async () => {
    const phrase = "കൊച്ചു പൂച്ചക്കുട്ടി"; // ൊ is U+0D4A, which decomposes to U+0D46 U+0D3E
    assert.notEqual(nfd(phrase), phrase);
    for (const [ownerForm, modelForm] of [[nfd(phrase), phrase], [phrase, nfd(phrase)]]) {
      const listings = await draft(`Kittens for sale on my page, 500 rupees. ${ownerForm}`, () => draftAnswer("Kittens", "Small kittens.", "pets", [modelForm]));
      assert.equal(listings.length, 1, "the owner's own words carry the claim, whichever way it is spelt");
      assert.equal(listings[0].state, "draft");
    }
  });

  test("Hindi nukta: free (मुफ़्त) typed decomposed, or as the old single letter, is the same word as मुफ्त", async () => {
    const freeNukta = "मुफ़्त"; // फ + nukta
    const freeSingle = "मुफ़्त"; // U+095E
    const freePlain = "मुफ्त";
    assert.notEqual(freeNukta, freePlain);
    for (const ownerWord of [freeNukta, freeSingle, freePlain]) {
      // the owner promises it free; the model's Hindi text says free without the nukta: the owner said it, so the draft stands
      const listings = await draft(`Kittens for sale on my page, 500 rupees, delivery ${ownerWord}`, () => draftAnswer("Kittens", "Small kittens.", "pets"));
      assert.equal(listings.length, 1);
    }
    // and the model's own free offer, spelt with a nukta, that the owner never made, is refused
    for (const modelWord of [freeNukta, freeSingle, freePlain]) {
      const listings = await draft("Kittens for sale on my page, 500 rupees", () => ({ ...draftAnswer() as object, texts: { en: "Small kittens.", hi: `${modelWord} डिलीवरी`, ml: "Small kittens.", kn: "Small kittens." } }));
      assert.equal(listings.length, 0, `refused: ${modelWord}`);
    }
  });
});
