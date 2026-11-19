// The shop given fixed requests, its answers compared WHOLE with the GOLDEN answers (golden.ts, golden/differential.json). The contract (listings.contract.test.ts) says what a shop
// must do; this catches the places where a port can drift without the contract looking: whitespace and rounding in the owner's form, the four languages' lengths, the place and the
// registration, the feed's items, and which of the model's drafts are let through by the grounding checks (the number, claim and health words in four languages). Signatures are
// replaced (the keys differ by design) and times by a mark. Until 19 Nov 2026 the TypeScript and Go runtimes were given the requests side by side; the TypeScript answers were
// recorded before its runtime was deleted (decision 61, wave 1b), so the Go shop is now held to them.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { PAGE, draftAnswer, makeShop, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { goldenFor } from "./golden.ts";

const golden = goldenFor(import.meta.url);
const shops: Shop[] = [];
const fakes: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const f of fakes) await f.close(); });

const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === "signature" ? "<sig>" : typeof x === "number" && x > 1.7e12 ? "<ms>" : typeof x === "string" && /^\d{4}-\d\d-\d\dT/u.test(x) ? "<iso>" : x)));

const OPS: Record<string, unknown>[] = [
  { op: "publish_form", category: "pets", title: "  Healthy   kitten  ", priceInr: 8000.5, qty: 2.5, photos: [] },
  { op: "publish_form", category: "home", title: "മലയാളം ".repeat(11), photos: [] },
  { op: "publish_form", category: "home", title: "ब".repeat(81), photos: [] },
  { op: "publish_form", category: "home", title: "Lamp", priceInr: 450.555, priceNote: "  per piece  ", qty: 3, photos: [] },
  { op: "publish_form", category: "vehicles", title: "Cycle", priceInr: 1, photos: [] },
  { op: "publish_form", category: "pets", title: "Puppy", photos: [] },
  { op: "edit", id: "l-1", title: "Kitten", priceInr: null, priceNote: "   ", qty: 4 },
  { op: "edit", id: "l-2", category: "bogus" },
  { op: "edit", id: "l-3", title: "Lamp two", priceNote: null },
  { op: "shop", visible: true, town: "  Kochi   Fort ", pincode: " 682001 ", point: { lat: 9.9312339, lon: 76.2673041 }, registration: " PSR  12 " },
  { op: "shop", pincode: "", town: null },
  { op: "sold", id: "l-3" }, { op: "remove", id: "l-3" }, { op: "remove", id: "l-1" },
];

/** [what the owner says, what the model writes (title, text, claims)] */
const DRAFTS: [string, string, string, string[]?][] = [
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "Free toys with each kitten."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "Free time to visit us."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "मुफ्त खिलौने."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "ಉಚಿತ ಆಟಿಕೆಗಳು."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "ഉറപ്പ് നൽകുന്നു."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "Ten of them, and a dozen toys."],
  ["ten kittens for sale on my page, 500 rupees", "Ten Persian kittens", "Playful."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "Only 20% left."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "We will bring them to you."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "The owner says they are kind."],
  ["healthy kittens for sale on my page, 500 rupees", "Healthy kittens", "Playful."],
  ["two kittens for sale on my page, 500 rupees", "Vaccinated kittens", "Playful."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "Playful.", ["fully vaccinated"]],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "Vaccinated yesterday."],
  ["two kittens for sale on my page, 500 rupees", "Persian kittens", "A safe home wanted."],
  ["kittens, safe with children, for sale on my page", "Persian kittens", "A safe home wanted."],
  ["list this: a brass lamp for 1,500 rupees", "Brass lamp", "Old and heavy."],
  ["list this: a brass lamp for 1,500 rupees", "Brass lamp", "Costs 1500."],
  ["list this: a brass lamp for 1,500 rupees", "Brass lamp", "Costs 15,000."],
  ["put it on my page: 5 kg rice, 60 rupees per kg", "Rice", "Fresh rice."],
  ["put it on my page: rice", "Rice", "Fresh rice, for sale at 12 rupees."],
  ["put it on my page: rice", "Rice", "Fresh rice."],
];

// The one phrase left out: words that are no listing at all ("something nice") are answered with the assistant's talk model (one call, and a call whose answer cannot be used then puts
// the shop's model on a 5-minute pause, ai-state.ts), which would change what comes after it in a shared shop; models.contract.test.ts covers the talk. ("put it on my page: 5 kg
// rice, 60 rupees per kg" and "put it on my page: rice" once looked different only because that pause was in force; in fresh shops they are compared below.)

describe("the shop answers as the TypeScript runtime did (the golden answers)", () => {
  test("the owner's form, the place, the public read and the signed feed's items", async () => {
    const seen = await golden("the owner's form, the place, the public read and the feed", async () => {
      const s = await makeShop(); shops.push(s); await s.start();
      const log: unknown[] = [];
      let i = 0;
      for (const op of OPS) {
        const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: `r-${++i}`, op } });
        log.push([r.status, norm(r.body)]);
        await s.settle();
      }
      log.push(norm((await s.call("/internal/channel/owner-listing", { owner: s.owner })).body));
      log.push(norm((await s.call("/internal/channel/listings")).body));
      log.push(norm((await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "Glow", languages: ["ml", "en"] } })).body));
      const st = (await s.call("/status")).body;
      log.push(norm({ listings: st.listings, tasks: st.tasks, recordLength: st.recordLength }));
      return log;
    });
    assert.equal(seen.length, OPS.length + 4);
  });

  test("which of the model's drafts the grounding checks let through", async () => {
    const results = await golden("which drafts the grounding checks let through", async () => {
      let next = draftAnswer();
      const fake = await startFakeModel(() => next); fakes.push(fake);
      const s = await makeShop({ modelPort: fake.port, budget: { monthlyMicroInr: 500_000_000, daily: { listing_draft: 500 } } }); shops.push(s); await s.start();
      const results: string[] = [];
      let n = 0;
      for (const [words, title, text, claims] of DRAFTS) {
        next = draftAnswer(title, text, "pets", claims ?? []);
        const before = fake.calls;
        await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id: `m-${++n}`, text: words }] } });
        await s.settle();
        const v = (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body;
        const draft = v.listings.find((l: { state: string }) => l.state === "draft");
        results.push(`${fake.calls - before} call(s); ${draft ? `draft price=${draft.pricePaise ?? "-"} qty=${draft.qty ?? "-"} note=${draft.priceNote ?? "-"} lang=${draft.ownerLang}` : "no draft"}`);
        for (const l of v.listings) await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id: `rm-${n}-${l.id}`, op: { op: "remove", id: l.id } } });
        await s.settle();
      }
      return DRAFTS.map(([w, t, x], i) => `${i}: ${w} / ${t} / ${x} => ${results[i]}`);
    });
    assert.equal(results.length, DRAFTS.length);
  });
});
