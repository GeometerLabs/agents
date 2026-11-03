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
| The monthly client report and the builder panel | Separate workstreams (W12 and W10) built on this record | After the first live client |
| Time zones with daylight saving | India has none; the time helpers handle offsets through `Intl`, but no daylight-saving case is tested | A client outside India |

## WhatsApp coexistence (check before any shop goes live)

**What:** the shop must keep its existing WhatsApp number and its normal WhatsApp Business app working alongside the official API the agent uses. A builder or partner should use one shared provider account across their shops, not one plan per shop.

**Why it's deferred:** v0 talks only to an in-memory messaging stand-in. One reviewer of a WhatsApp provider reported being locked out of their normal app after moving their number to the API. Meta's free Business AI also lives in the same app, and Geometer is meant to work alongside it.

**Revisit trigger:** choosing the WhatsApp provider (implementation plan B22), before the first real shop.
