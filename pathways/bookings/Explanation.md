# Explanation: how the Bookings pathway v0 core was built, and why

3 November 2026. This explains the choices in `pathways/bookings/`. It builds the first pathway of the product decision "Geometer: the product" (section 3) as laid out in the implementation plan (sections 1, 4 and 7); both live in the Geometer monorepo's `docs/` folder, not in this repository. What is intentionally left open is in [Deferred.md](Deferred.md).

## What was asked, and what v0 is

A Bookings agent for businesses that take a deposit and have a cancellation rule, with its limits, its record and a way to check it, running **locally, at zero cost, with no network and no npm dependencies**. It is the "Phase 0" prototype core: the same code is meant to run later against real services through Guard, and against the engine's simulated services for the crash test. So the design keeps the seams the plan names: adapters, pure limits, a record, one step per call.

Everything here runs against in-memory fakes. That is a stand-in for real services, not a claim about them.

## The decisions that matter

**1. "Confirmed" is a read, never a reply.** Every write (hold a slot, create a link, confirm the event, refund, send a message) is followed by a read from that service's own store, and only the read is recorded as `confirmed`. This is the central idea of the product ("a booking counts when the calendar's record shows it") and it is what catches the calendar that says ok and saves nothing. Each write is also preceded by a look: after a lost reply the agent finds its own earlier event, link or refund by the booking id instead of making a second one (the refund-desk pattern, applied everywhere).

**2. Payment events say "look", the payments record says what happened.** `payment_link.paid` and `payment.captured` describe the same payment, and either can arrive twice, late, or never. The agent counts payments from the link's own list, by payment id, so no combination of events can create a second deposit or lose one. When a hold is about to expire, the agent looks at the payments record first.

**3. The hold is a tentative calendar event.** The plan leaves open where a hold lives. Keeping it in the calendar means a hold is visible to every other booking and survives the agent losing its own state; confirming is an update from tentative to confirmed. The cost is one more calendar operation (`update`), which the plan's list (insert, get, list, delete) did not include.

**4. A payment after the hold expired re-checks the slot.** If the slot is still free, the agent holds it again and confirms. If not, it refunds the deposit (within the limit) and tells the owner. The customer paid in good faith, so the agent never keeps money for a booking it cannot give.

**5. The limits are pure, and each message is gated.** `src/limits.ts` has no side effects and reads nothing but its arguments, so Guard can run the same functions later. Every outgoing message passes through one function (`say`) that renders the templates from the record, runs the limits on the **final text**, sends only if none blocks, and reads the message back from the provider's outbox. "Booked" additionally requires `confirm-only-when-recorded`. Hours and double-booking are checked again whenever a booking is moved, at the customer's yes as well as at the request, because someone else may have taken the time in between.

**6. Templates only, and the check reads text like a customer.** No v0 message is model-written. Templates take their values from one `MessageFacts` object built from the booking and settings (only the menu carries every service's price; any other message may state only its own booking's service); the outgoing check (`src/language/check.ts`) reads the final text again from scratch (rupee amounts, dates with their weekday, times with their period word such as शाम, links, any leftover number) and blocks whatever the record cannot explain. It does not care how the text was made, so it will keep working when a model writes the free text around the templates. It compares values, not which label a value sits under: a ₹450 deposit where the record says ₹200 passes if ₹450 is also this booking's price (a known limit, in Deferred.md). Two tests keep templates and check in step: a drift test (every template, in both languages, passes the check) and a mutation test (changing any one value in any template makes it fail, including swapping in another service's price; about 400 mutations are tried).

**7. Dates have written rules.** "अगले मंगलवार" is the Tuesday of the next calendar week (Monday to Sunday). A bare weekday is the first one after today. "कल" is tomorrow in the business's time zone, not UTC. Every weekday phrase and every time without am/pm is read back with the full date, and nothing is held until the customer says yes. The rules are in the header of `src/language/dates.ts` and in the README.

**8. STOP is strict.** After STOP, nothing goes to the customer: no acknowledgement, no reminder, no reply if they write again. The booking itself stays. Messages to the owner still go. Two rules cover it (`opt-out` for every message, `no-message-after-stop` for reminders) so either one alone would hold.

**9. The cancellation window means "enough notice".** Cancel at least `windowHours` before the start and the deposit is refunded, if it is within `refundLimitInr`. Cancel later, or ask for more than the limit, and the owner decides by replying "approve b-3" or "deny b-3". "Within the limit" includes the limit itself. The late-cancellation case uses the `refund-limit` rule id rather than inventing a tenth rule.

**10. One state per step, state in a store that is passed in.** `agent.handle(event)` takes one message, one payment event or one tick and returns. Conversation state lives in a `Store` handed to the agent, never in module variables, so every situation starts clean and the engine can run each step as a task. Inbound messages are marked seen when they arrive (a customer who is ignored can write again); payment events are marked seen only after they were processed (a failed step can be run again with the same event, and processing is idempotent anyway).

## How the checks were made, and why they should not be vacuous

- **Situations, not only unit tests.** `crash-test/situations.ts` holds 27 situations: the rows of plan 4.4 that fakes can express (1 to 14, with #3, #8 and #9 split into variants and #8 and #9 in both languages), plus a few the plan implies (a normal booking, cancellation inside the window, a refund above the limit, STOP, two customers on one slot, a conflict at the moment of the hold, outside opening hours, reschedule, a reschedule confirmed after the time was taken, reminders). Each one starts a fresh world, makes something go wrong on purpose, and judges **from the fakes' own records**: what the calendar holds, what the payments service holds, what the messaging outbox holds. The agent's return values are never consulted. The same situations back both the tests and `scripts/hand-check.ts`.
- **A mutation check by hand.** To see whether the situations can fail, 17 deliberate bugs were put into a scratch copy, one at a time (trust the calendar's reply, no inbound de-duplication, count every payment as a deposit, no look before creating a link, refunds always allowed, late cancellations refunded automatically, weekday phrases not confirmed, no double-booking check, hours not checked, "booked" without both confirmations, outgoing check switched off, and others). At first 14 were caught. Three were not: removing only the "I can't go lower" sentence (the quote still states ₹450; a check on that sentence was added), letting every message state every service's price (invisible to the situations because the templates never do; a unit test on the facts was added), and switching off only the `opt-out` gate (the `no-message-after-stop` gate still holds the reminders, which is the point of having two; a test that the record shows the opt-out decision was added). A review also found that a reschedule confirmed with "yes" skipped the slot rules; it is fixed, with a situation for it. One test regex had mistaken "is free" (the slot is available) for "free of charge". Checks that read the agent's own record (rather than the fakes) live in `test/record-decisions.test.ts`, apart from the situations.
- **A type check that is not part of the folder.** Node strips types without checking them. The code was checked once with TypeScript 5.9 borrowed read-only from another project's `node_modules` (`strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUnusedLocals`), with no errors. No tsconfig is committed, because it would need `@types/node` installed, and this folder has no dependencies.

## Demo mode (a partner shows it on the owner's phone)

Added 3 November 2026 in `demo/`. The product doc's partner journey asks for "a live demo on the shopkeeper's own phone" that passes the mom test. This is that, locally: no hosting, no network out, no dependencies, nothing in `src/` changed.

**1. The real agent, not a mock.** `createWorld` gives the agent, the stand-ins and a fake clock; the demo only adds a chat transcript (the fakes keep what was sent out, not what came in), the meaning of the buttons, and one-at-a-time handling. Because the agent has no locking (Deferred.md), every session runs its taps through a promise queue: three quick taps on "Pay" make one payment.

**2. The buttons are plain calls on the stand-ins.** "Pay" is `customerPays` on the link of the latest booking waiting for its deposit, followed by the payment provider's webhooks reaching the agent, exactly as the situations do. "Pay it twice" is two payments on one link (two phones), not the same webhook delivered twice. "1 hour" and "1 day" move the clock in steps of 15 minutes, each followed by a tick, because the agent sends only the latest due reminder per tick and a single big jump would skip one. Owner buttons send `approve b-1`, `deny b-1` or `retry b-1` from the owner's number, as the owner would type it; the command is shown in the owner's chat.

**3. The owner's lines are counted, not written.** Each line comes from the stand-ins' records or the agent's action record: "in your calendar, we checked" needs a "booked" message that really is in the outbox, a confirmed event on the calendar's own list at the booking's start, and a payment on the link. The ₹ amount of a refused discount is read from the price rule's decision. Lines about things that have not happened are rules, not results ("Nobody has asked for a discount yet. It never goes below your price."). The strings exist in English and Hindi; any other language shows English until a reviewed set is added to `demo/strings.ts`.

**4. The fake clock starts at the real time**, so "tomorrow" on the owner's phone is the real tomorrow (tests pin it to Tue 3 Nov 2026, 10:00). The suggestions under the chat are written from the shop's own first service, prices and opening days, and move to the next open day when tomorrow is closed.

**5. One shop per server.** The shop form replaces the shop for every device on this server (other open pages start again on their next request), so a partner can set it up on the laptop and open it on the phone. A failed form changes nothing. An untouched service keeps all its names, and untouched hours keep each day's own hours; a renamed service uses the new name in every language. The refund limit is raised to at least the deposit.

**6. Safety, because a laptop on Wi-Fi is a server.** It listens on the machine's private addresses and 127.0.0.1, never 0.0.0.0, and refuses any client that is not on a private network (even one a router forwards in). The Host header must be an address or a .local name (no DNS rebinding), a POST must be JSON and its Origin must match the page, the cookie is HttpOnly and SameSite=Strict and never chosen by the client, and bodies, messages, sessions and requests per device are capped. The page is served with a Content-Security-Policy that allows only its own nonced script and style; every piece of typed text reaches the page through `textContent`. The deposit link is shown as text, never a tappable link, because the fake mints real-looking `rzp.io` addresses. A test runs the page's real script against the real server with a stand-in for the browser's page and checks that no markup is ever made from typed text.

**Choices to review**
1. One shop for the whole server, not per phone (decision 5).
2. The clock starts at the real time, not a fixed day, so a script that says "tomorrow" fails when tomorrow is closed unless the suggestions are used.
3. "Pay it twice" is only offered while a deposit is waiting, or once more after it was paid.
4. The record layer ("What we did") is English only; it is for the person showing the demo.
5. The demo's screens use Hindi written without a native review.

## Syntax rules used

Only erasable TypeScript: no enums, namespaces, parameter properties or decorators. Type-only imports use `import type`. Imports carry their `.ts` extension. Files that read the settings JSON use `new URL(…, import.meta.url)`, so they work from any directory.

## Size

About 2,900 lines in `src/` (of which the agent is about 760, the templates 150, the date and time reading 200), about 1,600 lines of tests, situations and script, 116 tests, 27 situations, 130 checks inside them. The demo adds about 1,600 lines in `demo/` and 22 tests. No dependencies. The two largest costs are the two languages of templates and the flow's honesty (look first, read back, reconcile), which is the point of the pathway.

## Choices to review

1. The hold as a tentative calendar event, and the added `update` operation (decision 3).
2. A late payment re-holds the slot if it is free, otherwise refunds (decision 4).
3. STOP is strict: no acknowledgement message (decision 8). A confirmation of the opt-out is common practice; whether to allow exactly one is a policy call for the owner.
4. The meaning of `windowHours` (decision 9), and that a late cancellation is "ask the owner", not "no refund".
5. A bare weekday means the first one after today, so "Tuesday" said on a Tuesday means a week from today (decision 7).
6. Owner commands (`approve b-3`, `deny b-3`, `retry b-3`) are recognised by the owner's number alone. Real approvals belong in Guard.
