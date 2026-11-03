# Deferred: what the Bookings pathway v0 core leaves open

3 November 2026. Each item is left out on purpose, with the reason and what would make it worth doing. Nothing here is claimed as done anywhere else in this folder.

## Real services and the engine

| Left open | Why | Revisit when |
| --- | --- | --- |
| Adapters for a real WhatsApp provider, Razorpay and Google Calendar | Phase 0 here is local, zero cost, no network. The fakes are shaped like the real services (Razorpay field names and paise, WhatsApp message ids and the 24-hour window, a calendar that can lose or drop a write) so each can be swapped for an adapter without changing the agent | Test-mode accounts exist (the plan's Phase 0 prototype against real test-mode services) |
| Guard enforcing the limits outside the AI | Guard needs its fail-closed production minimum first (W14). The limits are written as pure functions so they can move | Guard passes its fail-closed minimum |
| The engine's crash test: simulated services, injected faults at every step, exact replay, saved checks | Phase 2 work (W1 to W5, W8). The situations here are hand-written stand-ins, and they try only the faults listed | Phase 2 starts; then port the situations as saved checks |
| Webhook signature checks | The fake events carry no signature. The real adapter or Guard must verify them | A real Razorpay adapter |
| Message delivery status (sent, delivered, read, failed) | The product says a message counts when WhatsApp reports it delivered. v0 treats "the provider's outbox holds it" as the read-back | A provider with status callbacks |
| Retrying a message whose reply was lost | There is nothing to look it up by (no client reference), and a resend could duplicate a message. It is recorded as `unconfirmed` and not sent again | A provider that accepts a client reference |

## Language and messages

| Left open | Why | Revisit when |
| --- | --- | --- |
| Model-written text around the templates | v0 is template-only. The outgoing check already reads final text, but it cannot catch a promise made in words ("it's confirmed") or a quantity spelled out in words in every language | Real-model testing; add a check for confirmation words |
| A real model parser | Only a stub exists (`createOpenAICompatibleParser`); it is never called, and a model call needs approval and a key | The owner approves a model and a spend cap |
| Tamil, Telugu and other languages; more Hindi coverage | Hindi, English, Malayalam and Kannada are built. Each new language is one entry in every per-language table (the type system lists what is missing), its word list in `src/language/words.ts`, and a review sheet. The rule-based parser knows common Hindi and a little Hindi in Latin letters, not slang or mixed sentences | Tamil and Telugu are wanted by a client |
| STOP acknowledgement and opting back in (START) | STOP is strict: no message at all, even if the customer writes again. One confirmation of the STOP is common practice; allowing it, and a way back in, is a policy call | The owner decides the policy |
| Meta template wording and variables | Template bodies are plain text here. Real templates need approved wording with numbered variables | WhatsApp templates are submitted for approval |
| The check compares values, not labels | An amount only has to be one of this booking's own values, so a deposit and a price swapped between themselves ("Pay a ₹450 deposit") still pass. Another service's price is refused outside the menu. A per-label check needs the templates to declare which value goes where | Model-written text, or a template change that mixes amounts |
| Number words and symbols the check does not read ("Rs 450", "four hundred", "18:00") | They are blocked (nothing the check cannot explain is sent), but a future model would be blocked from using them too | Model-written text |

## Malayalam and Kannada

| Left open | Why | Revisit when |
| --- | --- | --- |
| **Native-speaker review of every Malayalam and Kannada line** | Written by a model. Word choices that need a native ear: "അഡ്വാൻസ്" and "ಮುಂಗಡ ಹಣ" for the deposit, "ഉടമ" and "ಮಾಲೀಕರು" for the owner, the day-part words and their hours (is 4 pm evening or afternoon; is 5 am "രാവിലെ" or dawn), the hyphen after a business name ("Glow Salon-ലേക്ക്"), and whether the tone is polite and short enough for a shop customer. The owner reads Malayalam; Kannada goes to native readers. The sheets are [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) | **Before any real shop sees either language.** Fold the answers back into `templates.ts`, `format.ts` and `words.ts`, regenerate the sheets, keep the reviewers' notes |
| Numbers spelled out in words ("ആറ് മണി", "ಆರು ಗಂಟೆ") | The parser reads digits only. A customer who writes the hour in words is asked again. Common in speech, less on WhatsApp | A real conversation log shows how often it happens |
| A day of the month without its month ("10-ാം തീയതി", "10ನೇ ತಾರೀಖು"), and a month name with an ending ("നവംബറിൽ", "ನವೆಂಬರ್‌ನಲ್ಲಿ") | Month names are matched whole so a short word like "ಮೇ" (May) does not match inside other words | Same |
| Long weekday forms written by a future model ("ചൊവ്വാഴ്ച, 10 നവംബർ") in outgoing text | The formatters write the short forms (ചൊവ്വ, ಮಂಗಳವಾರ). The check reads only what the formatters write, so a long form with a date is blocked (it fails closed) rather than checked | Model-written text |
| Which language "nale" and "naale" alone are | Both mean tomorrow in both languages. Alone, they leave the language unchanged; with another word ("mani", "gante") the language is clear | A reviewer or a log shows a better rule |
| Sentences that mix scripts or languages | The language is the script of the whole message, so "haircut നാളെ 6 മണി" is Malayalam. Words are matched in all four languages anyway | Real conversations |
| WhatsApp template approval for Malayalam and Kannada | The stand-in approves all three template names for every language. A real provider approves each name per language, with numbered variables | The first real shop in either language |
| Tamil and Telugu | Wanted next; not built | A client in Chennai or Hyderabad |

## Booking behaviour

| Left open | Why | Revisit when |
| --- | --- | --- |
| More than one staff member, room or chair; group bookings | The calendar is one resource: one customer per slot | A client needs two chairs |
| Suggesting other free times when a slot is taken | The agent says the time is not available and asks for another | Real conversations show it matters |
| Payments of a different amount, partial payments, a payment on a link that was already cancelled | Only whole-deposit payments are modelled. A cancelled link cannot be paid in the fake | A real Razorpay account shows what happens |
| Setting `expire_by` on the payment link | The hold expiry is the agent's own timer; the fake ignores link expiry | Razorpay link expiry rules are checked (it may have a minimum) |
| Cleaning up an event that could not be deleted | The failed delete is recorded as `unconfirmed`; nothing retries it later | A scheduled sweep exists |
| Rescheduling inside the cancellation window | Any confirmed booking can be moved to a free time before it starts, with no extra rule | The owner wants a limit on late moves |
| Capturing the customer's name | Only the WhatsApp number is stored. The cleaning-firm story in the product doc ("name and phone not provided") is about a voice agent, but a name may still be wanted | A client asks for it |
| Completing a booking from the calendar (no-shows, walk-ins) | `completed` happens when the end time passes | The report needs attendance |

## Running it for real

| Left open | Why | Revisit when |
| --- | --- | --- |
| Persistence and restarts | State lives in an in-memory store passed to the agent. A crash loses it (the calendar and payments records survive, and every step looks before it writes) | The hosted runtime (W9) |
| Two events at the exact same instant | Steps are handled one at a time; there is no locking | The runtime can run steps concurrently |
| Owner approvals through Guard | The owner is recognised by their WhatsApp number alone. Anyone who can spoof that number could approve a refund | WhatsApp approvals through Guard (W10) |
| Customer data retention, consent text and deletion (DPDP) | The record keeps message text only as a digest, but the store holds phone numbers and bookings, and there is no retention setting | Before a real client goes live |
| The builder panel | A separate workstream (W10) built on this record. (The monthly client report and the certificates are built: see below.) | After the first live client |
| Time zones with daylight saving | India has none; the time helpers handle offsets through `Intl`, but no daylight-saving case is tested | A client outside India |

## The partner demo (`demo/`)

| Left open | Why | Revisit when |
| --- | --- | --- |
| A hosted demo link a partner can send | It needs hosting, a public address and abuse limits, and the owner's approval before anything is deployed. The local demo has no login and answers only the private network on purpose | The owner approves a hosted demo and a spend |
| A QR code in the terminal for the phone | A QR needs an encoder written by hand (no dependencies), or a library. The address is printed instead | Partners ask for it |
| Buttons that break things on purpose (calendar saves nothing, lost reply) | Strong in a pitch ("it did not say booked"), but they need the fault injection of the stand-ins exposed through the page, and care that they do not confuse an owner | The first partner tries the demo with a sceptical shop |
| "Stop it now", the product's kill switch, and a crash-test line for the shop ("we tried 27 things; it handled 27") | The agent has no kill switch yet, and the situations run on Glow Salon's settings, so claiming them for a personalised shop would mislead | Guard exists; situations can run against any settings |
| Reviewed Hindi, Malayalam and Kannada screen words | `demo/strings.ts` has English and Hindi (not reviewed by a native speaker). Other languages show English screens while the agent's own messages follow the language pack | A native speaker reviews the words |
| A PIN for the shop form; the shop is one per server | Anyone on the same Wi-Fi can change the shop or press Start again. Fine for a laptop in a shop, not for a shared network | A shared-network use appears |
| Looking more like WhatsApp (ticks, voice notes, the 30-second voice summary) | The product doc plans a voice note for the owner; the demo shows text only | The voice-note work (W12) exists |
| Starting on a chosen day or time | The clock starts on the real date at 10:00 shop time; suggestions skip closed days, but typed requests do not | Partners ask |

## The monthly report and the certificates (`report/`)

| Left open | Why | Revisit when |
| --- | --- | --- |
| **The verify page on geometer.dev (`/verify/<code>`)** | The documents print their short code and the path `/verify/<code>`, but no page answers it. A page needs hosting, a place that keeps each issued document (or its digest) so a code can be looked up, and **the owner's approval before anything is deployed**. Until then a reader checks a file with `scripts/verify-report.ts`, or asks the partner. The printed path is text, not a link | The owner approves the deploy; decide whether Geometer keeps issued documents or only digests |
| A QR code on the certificates | It needs an encoder written by hand (no dependencies) and a test against a known reference vector, and it would point at the verify page above, which does not exist. Not built rather than built unchecked | The verify page exists |
| **Native review of the report and certificate words** | The Hindi, Malayalam and Kannada strings in `report/strings.ts` are machine-written. Section 6 of [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) lists them; Hindi has no sheet yet. Word choices to look at: "പരിധി"/"ಮಿತಿ"/"सीमा" for the shop's limits, "അഡ്വാൻസ്"/"ಮುಂಗಡ ಹಣ" for the deposit, the label forms ("label: number") for the owner's lines, and that nothing reads as a promise | **Before any real shop sees either language**; a Hindi sheet before the Hindi pilot |
| The Guard anchor | Every document has `anchor: null`, inside the signed bytes. Guard's hash-chained ledger does not exist yet | Guard passes its fail-closed minimum; then fill the field before signing and write the matching anchor file |
| `geo-verify` reading these files | Same conventions, not the same format: geometer-verify writes integers as strings and its schemas are strict and generated. Joining them means adding the report and certificate records to the contract schemas | The anchor work above |
| Key custody beyond a file | One Ed25519 key in a file the caller names, 0600, never in a repository. No rotation, no revocation list, no key log, no hardware key. A lost key means old documents can still be checked (the public key is in the file) but nothing can be re-issued under it | Before documents from more than one partner are signed |
| A go-live certificate from real services in test mode | The hand check runs on stand-in services only, so the go-live certificate says so and has no `source` choice. When the checks run against test-mode accounts (Phase 1) it needs its own wording | Test-mode accounts exist |
| The situations run on the shop's own settings | Still true from above: the hand check runs on Glow Salon's example settings, so any other shop's certificate says "these checks on this shop's own settings" is not tested (15, not 14) | Situations can run against any settings |
| Sending the report | The scripts write the text and the files; nothing sends them. Sending needs the WhatsApp provider, an approved template for a message outside the 24-hour window, and the owner's number | The runtime server and the provider are live |
| The 30-second voice note | The product doc plans a voice note beside the message. Not built (needs a text-to-speech choice and a spend) | The owner approves a voice service |
| Who turned up, whether messages were read | The record has no attendance and no delivery status (a booking is "completed" when its time passes; a message is "confirmed" when the provider's outbox holds it). Listed as "not counted" on every report | The provider reports delivery; the report needs attendance (see the booking section above) |
| What slipped past a limit | The report counts what the limits stopped. It does not re-read the record for a break (a reminder after STOP, a "booked" with no deposit). Listed as "not counted" | Before "raise the limit" (autonomy levels), which needs exactly this |
| Month-on-month and per-service breakdowns | One month at a time; no trend, no "this month vs last" | Owners ask |
| Very large months | The page lists every entry of the month (fingerprints only). A month of ten thousand entries is a page of about 2 MB. It is collapsed and prints closed | A shop that big |
| Looking at the pages on a real phone | The pages were checked by structure (self-contained, escaped, no script or link, phone viewport, print rules) and not opened in a browser or on a phone. System fonts only, so Malayalam and Kannada shaping depends on the device | The first partner opens one |
| The runtime server calling these functions | `buildMonthlyReport` takes the whole record and the store's bookings as plain arrays; `report/run.ts` writes the files. Nothing schedules a monthly run or stores an issued document | The runtime server (W9) |
| Entries made before the record kept amounts | They are counted but add nothing to a ₹ total, and the report says how many (`missing`). Nothing live exists yet, so nothing is missing today | Only if an older record is ever reported on |

## WhatsApp coexistence (check before any shop goes live)

**What:** the shop must keep its existing WhatsApp number and its normal WhatsApp Business app working alongside the official API the agent uses. A builder or partner should use one shared provider account across their shops, not one plan per shop.

**Why it's deferred:** v0 talks only to an in-memory messaging stand-in. One reviewer of a WhatsApp provider reported being locked out of their normal app after moving their number to the API. Meta's free Business AI also lives in the same app, and Geometer is meant to work alongside it.

**Revisit trigger:** choosing the WhatsApp provider (implementation plan B22), before the first real shop.
