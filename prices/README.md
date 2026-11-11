# Prices

This folder is **the only place a Geometer price is written**: one dated price list per change, `prices/<date>.json`.

Everything else reads this folder, or reads a generated copy that a test compares with it. Change a price here and nowhere else.

## The rule

- **A change is a new file, never an edit.** Start one with:

  ```
  node prices/new.ts 2026-12-01
  ```

  It copies the newest list to that date and changes only its `date`. It refuses to overwrite a file or to go backwards. Then edit the new file: the prices that change, each one's `read` day, `source` and `note`, and the `about` text. Once it is final, add its sha256 to `PINNED` in `bundle/panel/test/cost.test.ts`: that pin is what makes an edit after the commit fail a test.
- **A list is in force from its date.** A month is priced with the newest list dated on or before the month's last day, so an old month can always be worked out again with the list it was worked out with.
- **Every entry says where it came from**: `quality` (how sure we are, named at the top of the file), `source` (an https address, or a `docs/` path for a Geometer document), `read` (the day it was read or decided) and a short `note`.
- **Amounts are whole numbers.** Money is micro-units of the entry's `currency` (1,000,000 micro-rupees = ₹1), shares are `basisPoints` (10,000 = 100%), and plain numbers are `count`.
- A list with `"status": "proposed"` waits for the owner's yes. Nothing is billed or priced from it.

## What is in a list

Since 9 Nov 2026, two price lists and nothing else:

| Ids | What |
|---|---|
| `plan.basic.*`, `plan.business.*`, `plan.operations.*` | **Partners**: the three plans, each a fee and an allowance of messages a month |
| `overage.extra`, `overage.block` | Extra messages above the allowance, and the block fleet takes them in |
| `ai.cap` | The model-spend cap per 1,000 messages a shop has |
| `whatsapp.pass-through`, `recharge.*` | WhatsApp at cost, and the partner's balance top-up: its payment fee (passed on at cost), limits, expiry and warning |
| `licence.builder.*` | **Builders**: the flat licence per live client business, and its fair-use line |
| `innovator.places` | The Innovator badge's 100 places (a badge, not a price) |
| `guide.*` | What Geometer suggests a partner or builder charges, for the sell guides and the website's calculators. Suggestions, not Geometer's prices |
| `whatsapp.in.*`, `whatsapp.provider.*`, `razorpay.*`, `model.*`, `exchange` | The outside rates the cost lines use: Meta, the WhatsApp providers, Razorpay, the models, and the rupee rates |

## Who reads it

| Reader | How |
|---|---|
| The deploy bundle's panel (`bundle/panel/cost.ts`) | Reads this folder directly: the running-cost line, the plan on the shop page |
| The sell guides (`templates/*/*/sell/guide.*.md` and `sell/variants/`) | Made from a source file beside each (`guide.<lang>.src.md`) with `{{id}}` placeholders and `{{date}}`, by `node prices/render.ts` (`--check` writes nothing and fails if one is behind). `render.test.ts` and each template's sell-guide test fail if a guide is not what its source and the list in force make |
| Fleet (`monorepo/apps/fleet/prices/list/`) | A byte-for-byte copy of the lists from 9 Nov 2026 on, made by `npm run prices:sync` in `apps/fleet`. Fleet's drift test fails if its copy differs from this folder. Fleet's own cost estimates (server share, support minute) are not prices and live only in fleet |
| The website (`public-web/src/data/price-list.json`) | A copy pulled by `npm run prices:pull` |

After adding a list here, run `node prices/render.ts`, then each copy's sync and its tests.

## The lists

| File | What changed |
|---|---|
| `2026-11-03.json` | The first list: outside rates only |
| `2026-11-04.json` | Decision 13's flat fee |
| `2026-11-05.json` | The plans, proposed |
| `2026-11-07.json` | The plans in force (5 Nov decision), at ₹94 to the dollar |
| `2026-11-09.json` | Two price lists: partners (Basic ₹149, Business ₹299, Operations ₹999 flat) and builders (₹149 per live client business). The first-100 discount and the half-price self-host licence are gone |
| `2026-11-11.json` | The builder licence becomes ₹199 per live client business (owner, 10 Nov, decision 36). Nothing else changes. It prices all of November 2026: no invoice had been issued |
