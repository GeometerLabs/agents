# Every pathway ships with a sell guide

Owner's decision, 3 November 2026: every pathway comes with a guide to pitching and selling it locally, in every language the pathway speaks, and **a pathway isn't ready to sell until its guide is.** The Bookings pathway is the first; copy its shape from [`bookings/sell/`](bookings/sell/).

**Who reads what.** The guide is read by a young local partner (18 and over, maybe shy, pitching for the first time) and by a builder (a freelancer or micro-agency). The shop owner never reads the guide. The owner gets the one-page sheet.

## What a pathway ships

| File | What it is |
| --- | --- |
| `sell/guide.en.md` | The master, in English |
| `sell/guide.<lang>.md` | One per other language the pathway speaks (`LANGUAGES` in `src/settings.ts`) |
| `sell/one-pager.<lang>.html` | A printable single page the partner leaves with the owner, one per language |
| `test/sell-guide.test.ts` | Checks all of the above |

## The 11 sections, in this order

Number the headings `## 1.` to `## 11.` exactly. Short pages, one example each, numbered steps, scripts in quotes, small tables. No essays.

| # | Section | It must give the reader |
| --- | --- | --- |
| 1 | Is this shop a fit? | Good fits, bad fits, three quick questions to ask yourself |
| 2 | Before you go | The partner ladder: practise with a friend, a friendly shop, a stranger. Run the demo twice. Know your price. |
| 3 | The first three sentences | Exactly three sentences for the door, in the owner's language |
| 4 | Show it on the owner's own phone | The demo: the command, the Wi-Fi link, exactly what to tap, what the owner sees, what to say. Test money, nothing real sent. |
| 5 | Questions owners ask | Honest answers to the questions below, in quotes |
| 6 | Price | Who pays whom and how much; Geometer's fee; the suggested shop price as "a starting point; you decide"; the setup fee the partner keeps; the price in the shop terms; pass-through fees; **any platform access the user pays for themselves** (for example X's paid API tiers for a social posting pathway) |
| 7 | Never say | A table: phrase, why, what to say instead |
| 8 | The setup visit | A checklist of everything done with the owner at the shop, ending with the go-live certificate read together and the shop terms signed. **Say what platform access the pathway needs and how long it takes** (for example Meta's app review before Instagram publishing), so nobody promises a start date the platform controls. |
| 9 | The first month | A check in week 1, the first monthly report read together, one introduction asked for (never a reward) |
| 10 | When something goes wrong | Stop the agent, call the owner before they find out, look at the record, own it |
| 11 | Be honest about what's true today | One short paragraph, dated: what exists, what isn't tested or built yet |

**Section 5 must cover at least:** what if it makes a mistake; who sees my customers' messages; Meta gives AI for free, so why pay; will I lose my number or my app; what does it cost; what happens if it stops working; can I switch it off; who do I call. A pathway adds its own.

## Variants

A pathway can be sold to more than one kind of business (Bookings to a salon, or to a hiring centre that rents out a tractor). Do not copy the whole guide for each. Write a **variant**: `sell/variants/<name>.<lang>.md`, in every language the guide has.

- **It covers only what differs.** Section 1 (who is a fit), 3 (the first three sentences), 4 (the demo taps), 5 (the questions that business asks), 6 (price), 7 (more rows for "Never say"), 8 (setup visit items) and 11 (what is true today for this business). It never restates 2, 9 or 10.
- **It keeps the main guide's section numbers**, in order, so "section 5" means the same thing in both. Section titles may be adapted. Sections 1, 3, 4, 5, 6 and 8 are required.
- **It points to the main guide** for everything else, in the first lines: a link to `../guide.<lang>.md`, and which sections are the same.
- **It follows every rule below:** the claim rules and banned words, `₹` amounts in Western digits, the same amounts and numbers in every language, the machine-written banner with the date on Hindi, Malayalam and Kannada, and the demo words and taps checked against the demo itself.
- **It is checked against the business it describes.** Anything it says about the example settings or the hand check ("29 of 29 situations held") is compared with the real run, so it cannot drift.
- **It adds a Deferred row** for what the business needs that the pathway cannot do yet, so section 1 and section 11 stay honest.
- **The one-page sheet is the main guide's** until the variant has its own. Say so at the top, and list the missing sheet in Deferred.

The test for variants is in `test/sell-guide.test.ts` ("variant guide: ..."). The first variant is [`bookings/sell/variants/equipment-rental.en.md`](bookings/sell/variants/equipment-rental.en.md).

## The one-pager

A single page the partner leaves behind. Self-contained: inline CSS, no scripts, no external fonts, images or URLs, system fonts that render Devanagari, Malayalam and Kannada. Green and white, other colours only as accents. Readable on a phone, printable on A4. It has:

- **one example**, drawn as a step flow in HTML and CSS: a customer messages, books, pays, and the owner gets the monthly report;
- **three things the owner can check**, in the owner's words, for example "It can't go below your prices.";
- **a space** for the partner's name and phone number;
- **the not-checked line** in short form, dated, as in the report: what was not checked, and that checks were run by hand.

## Languages

- English is the master. The other files are real translations in natural spoken register, with the loanwords locals use ("booking", "deposit", "link").
- Amounts, numbers and the order of sections are identical in every language. Write every amount as `₹450` in Western digits, a range as `₹999 to ₹1,999`.
- Each translation starts with a banner: machine-written, needs native review, plus the date. On a one-page sheet it is an HTML comment, so the owner's printed copy stays clean. It stays until a native speaker has reviewed the file. Add a Deferred row for the review.
- Anything the owner will tap, read or hear is quoted exactly as the product shows it, and the test checks it against the product's own strings. If a demo step is taught, the test drives the demo through it for every language, on each of the seven days a partner might start (a shop's closed day changes what the demo does).

## Rules every guide follows

- The claim rules (company doctrine, section 4). Never "safe", "guaranteed" or "certified". Never "we take the risk". The test reuses the per-language `BANNED` lists of the report, so no word is banned twice.
- **Money flow yes, amounts no.** Say who pays whom and how much a fee is. Never say how much anyone will make, not even as an example.
- Serious and sober. No hype, no emojis, no gamification.
- Use the owner's own words for the limits: "It can't go below your ₹450 price."
- Where the true answer is "it depends" (a WhatsApp account's age, a Razorpay website), say so.

## Keeping it true

A guide must never claim more than the day's truth. Section 11 and the one-pager's not-checked line carry a date and change whenever the pathway's status changes: a first live shop, a new check, a native review done. When a native speaker has reviewed a translation, remove its banner and its Deferred row in the same commit.

## Copying it for the next pathway

If the next business uses the same pathway, write a variant (above) instead. For a new pathway, copy `bookings/sell/` and its test, then rewrite what is specific: who is a fit (section 1), the demo and the taps (section 4), the questions (section 5), the prices (section 6), the setup visit (section 8) and the report lines (section 9). Keep the section order, the file names, the banner rule and the test. For fee and dues collection the demo's key moment will be a reminder that stops once the parent has paid.
