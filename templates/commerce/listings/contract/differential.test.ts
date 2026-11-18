// The two runtimes given the SAME requests, their answers compared. The contract (listings.contract.test.ts) says what each must do; this catches the places where a port can drift
// without the contract looking: whitespace and rounding in the owner's form, the four languages' lengths, the place and the registration, the feed's items, and which of the model's
// drafts are let through by the grounding checks (the number, claim and health words in four languages). Signatures are replaced (the keys differ by design) and times by a mark.
// Skipped when no Go binary is built.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PAGE, REPO, draftAnswer, makeShop, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";

const bin = process.env.LISTINGS_GO_BIN ?? join(REPO, "go", "bin", "listings");
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
];

// Words the TypeScript runtime does NOT take as a listing although they say "put it on my page", or takes as something else, because the assistant first reads them with its owner
// rules (modules/assistant/intents.ts readOwnerRules: a number and a unit read as a stock count, "rice" read as a question) and, when the words are no listing at all, answers them
// with the talk model. The Go runtime does not port those rules (go/TRIAL.md, "left out"), so these three DIFFER and are not compared; they are here so the difference is on record.
//   ["something nice" -> TS asks the owner-talk model (1 call, no draft); Go asks nothing]
//   ["put it on my page: 5 kg rice, 60 rupees per kg" -> TS: 0 calls (read as another kind of request); Go: drafts it]
//   ["put it on my page: rice" -> TS: 0 calls; Go: 1 call, refused by the grounding check]

describe("TypeScript and Go answer the same", { skip: !existsSync(bin) && `no Go binary at ${bin}` }, () => {
  test("the owner's form, the place, the public read and the signed feed's items", async () => {
    const seen: Record<string, unknown[]> = {};
    for (const impl of ["ts", "go"] as const) {
      const s = await makeShop(); shops.push(s); await s.start(impl);
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
      seen[impl] = log;
    }
    for (let k = 0; k < seen.ts.length; k++) assert.deepEqual(seen.go[k], seen.ts[k], `step ${k} ${k < OPS.length ? JSON.stringify(OPS[k]) : ""}`);
  });

  test("which of the model's drafts the grounding checks let through", async () => {
    const outcome: Record<string, string[]> = {};
    for (const impl of ["ts", "go"] as const) {
      let next = draftAnswer();
      const fake = await startFakeModel(() => next); fakes.push(fake);
      const s = await makeShop({ modelPort: fake.port, budget: { monthlyMicroInr: 500_000_000, daily: { listing_draft: 500 } } }); shops.push(s); await s.start(impl);
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
      outcome[impl] = results;
    }
    assert.deepEqual(outcome.go, outcome.ts, DRAFTS.map(([w, t, x], i) => `${i}: ${w} / ${t} / ${x}\n  ts: ${outcome.ts[i]}\n  go: ${outcome.go[i]}`).filter((_, i) => outcome.go[i] !== outcome.ts[i]).join("\n"));
  });
});
