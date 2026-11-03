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
| Tamil, Telugu and other languages; more Hindi coverage | Hindi, English, Malayalam and Kannada are built. Each new language is one entry in every per-language table (the type system lists what is missing), its word list in `src/language/words.ts`, and a review sheet. The rule-based parser knows common Hindi and a little Hindi in Latin letters, not slang or mixed sentences | Tamil and Telugu are wanted by a client |
| STOP acknowledgement and opting back in (START) | STOP is strict: no message at all, even if the customer writes again. One confirmation of the STOP is common practice; allowing it, and a way back in, is a policy call | The owner decides the policy |
| Meta template wording and variables | Template bodies are plain text here. Real templates need approved wording with numbered variables | WhatsApp templates are submitted for approval |
| The check compares values, not labels | An amount only has to be one of this booking's own values, so a deposit and a price swapped between themselves ("Pay a ₹450 deposit") still pass. Another service's price is refused outside the menu. A per-label check needs the templates to declare which value goes where | Model-written text, or a template change that mixes amounts |
| Number words and symbols the check does not read ("Rs 450", "four hundred", "18:00") | They are blocked (nothing the check cannot explain is sent), but a future model would be blocked from using them too | Model-written text |

## The model parser and its eval

| Left open | Why | Revisit when |
| --- | --- | --- |
| A run against a real model | No key was available to the build, so both wire shapes are tested only against a local stub server. The model ids and extra request fields in `eval/models.json` were read from each provider's docs and not tried (newer OpenAI models and Sarvam's variants are the least certain) | The owner puts a key in `.env` and runs the eval; fix any candidate that fails every message with an HTTP error |
| Native review of the eval labels | The 136 messages and their labels are machine-written, Hindi, Malayalam and Kannada included. A wrong label would reward or punish a model for nothing | A native speaker reviews `eval/messages.jsonl`, as for the Malayalam and Kannada word lists |
| A bigger and harder eval | About 33 messages a language means one message moves a score by 3 points. The set is one message at a time with no conversation, so a bare "yes" never has to be understood in context. Each run is one pass at temperature 0 with no repeat to measure noise. The rule parser already gets about 86 percent, so the set separates models mostly on the hard cases | Two models are within a few points of each other |
| Prices in `eval/models.json` | Left empty on purpose: prices change, and are filled from each provider's current price page. Until then the cost row says "no price set" | The candidates are chosen |
| Model cost in the action record | The plan's record has a "model cost" field. `parseDetailed` already returns the tokens the model reported, but the agent records only why a fallback happened | The report (W12) needs spend per shop |
| Reading the model's `language` for the reply language | The agent switches the customer's language from the intent's `language`. A model may call a code-mixed message by the wrong language where the rule parser would use the script | The eval shows language misses that matter, or a shop complains |
| Retries, streaming and prompt caching | One try, then the rule parser reads the message. A retry would add seconds to a WhatsApp reply, and the prompt (about 4,300 characters) is probably under the size most providers cache | A model that is often slow, or a longer prompt |
| The model call going through Guard | The parser points at any base URL. Guard's route to a model provider, per-client spend caps and the allowance are Guard and gateway work (W14, W19) | Guard has a model upstream |
| Sending real customers' messages to a model provider | The eval sends only invented messages. A live shop would send customers' text to a provider, which needs the consent text, a provider that does not train on the data (plan section 7) and a retention decision | Before a real client goes live with the model parser |
| Letting the model flag a trick the rule parser misses | `overrideAttempt` is true if the model or the rule parser's patterns say so, so a fooled model cannot hide a known trick. A trick the model misses and the patterns do not know is not flagged. It changes nothing either way, because the limits decide, but the record would not note it | The eval shows tricks going unflagged |

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
| Persistence and restarts | Built in `server/` (SQLite, one file per client agent); what it leaves open is in "The runtime server" below | n/a |
| Two events at the exact same instant | The agent still has no locking; the runtime server runs steps one at a time through a serial queue, so two events at once are handled in order. Running the agent any other way (the demo does its own queue) needs the same care | The runtime can run steps concurrently |
| Owner approvals through Guard | The owner is recognised by their WhatsApp number alone. Anyone who can spoof that number could approve a refund | WhatsApp approvals through Guard (W10) |
| Customer data retention, consent text and deletion (DPDP) | The record keeps message text only as a digest, but the store holds phone numbers and bookings, and there is no retention setting | Before a real client goes live |
| The monthly client report and the builder panel | Separate workstreams (W12 and W10) built on this record | After the first live client |
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

## WhatsApp coexistence (check before any shop goes live)

**What:** the shop must keep its existing WhatsApp number and its normal WhatsApp Business app working alongside the official API the agent uses. A builder or partner should use one shared provider account across their shops, not one plan per shop.

**Why it's deferred:** v0 talks only to an in-memory messaging stand-in. One reviewer of a WhatsApp provider reported being locked out of their normal app after moving their number to the API. Meta's free Business AI also lives in the same app, and Geometer is meant to work alongside it.

**Revisit trigger:** choosing the WhatsApp provider (implementation plan B22), before the first real shop.

## The runtime server (`server/`)

| Left open | Why | Revisit when |
| --- | --- | --- |
| A WhatsApp message can go out twice if the process dies mid-step | A cut-off step runs again from the last saved state. The calendar, payment-link and refund writes look before they repeat, but a WhatsApp send has nothing to look up by (see "Retrying a message whose reply was lost" above). The window is one step, from its first send to its save. Writing "about to send" to the store before each send would shrink it to a send whose reply was lost, at the cost of a change to `say` in the agent | Before the first live client, or when a provider accepts a client reference |
| One process per data folder is not enforced | A second runtime on the same folder would run the same pending task twice. SQLite's write lock keeps the file intact, but nothing stops two queues. The bundle starts one per client | A deploy that could start two (restart policies, blue/green) |
| Failed tasks are only counted | They stay in the store with their error and wait. There is no command to look at, retry or drop one, and no alert on `failed > 0`. The status endpoint carries the count for the heartbeat | The first failed task on a real client; the builder panel |
| The state is one snapshot, rewritten whole after every step | Simple and exact for a shop's volume. The set of seen message and event ids, the bookings and the whole record (kept in memory too) only grow. Fine to some thousands of bookings; no pruning, paging or per-booking rows yet | A client with thousands of bookings, or memory growing |
| Retention, deletion and backups | Message text is not kept once a task is done (the task's payload is emptied; the record keeps digests), but phone numbers and bookings stay in the snapshot and the window table, and the record is append-only by design. No per-client retention setting, no DPDP deletion, no backup job (copy `agent.db` with SQLite's backup, not a plain file copy while it runs) | Before a real client goes live; the daily backups the bundle sets up |
| The heartbeat sender and the panel | `/status` is their source (counts only). Nothing sends it anywhere yet | The licence and heartbeat service |
| The model-backed parser | The server uses the rule parser. The model parser is built elsewhere and plugs in through `parser` in `startClient` | Its branch merges |
| The live adapters | Live mode loads `src/adapters/live/index.ts` by dynamic import and fails with a clear message when it is missing, as on this branch. Its wiring is tested against a stand-in module, not the real one, and no live run has happened | The live-services branch merges; then run one client through Guard in test mode |
| Fakes mode forgets | The stand-in services are in memory, so after a restart the saved bookings point at calendar events and payment links that no longer exist (the server warns). The stand-in WhatsApp never hears that a customer wrote, so replies go as templates | Persisting the stand-ins is not planned: local runs are for looking, not for keeping |
| Modules in `pathway.lock` | The lock may one day list client modules. The runtime refuses a lock that does, rather than start without what it pins | Client modules are built |
| Hardening beyond a token and a body limit | No rate limit, no TLS (the inbox or a reverse proxy does that), no IP allow list. It listens on 127.0.0.1 unless told otherwise and should be reached only from the inbox on a private network | The deploy bundle (the HTTPS entry and the internal network) |
| A hung step blocks shutdown | Stopping waits for the step in hand. If a service call hangs (the live adapters carry a timeout), the process is killed and the task runs again at the next start | The first time it happens |
| A tick runs between tasks, not after all the tasks that arrived before it | A tick asks the queue for its turn; tasks that arrive while it waits can come after it. The agent copes with either order (a late payment re-checks the slot), but a strict "events first" order would need the tick to wait for the pending tasks | A case where the order shows |
