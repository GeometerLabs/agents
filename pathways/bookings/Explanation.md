# Explanation: how the Bookings pathway v0 core was built, and why

3 November 2026. This explains the choices in `pathways/bookings/`. It builds the first pathway of [Geometer: the product](../../../docs/product/geometer.md) as laid out in the [implementation plan](../../../docs/plans/implementation-plan.md) (sections 1, 4 and 7). What is intentionally left open is in [Deferred.md](Deferred.md).

## What was asked, and what v0 is

A Bookings agent for businesses that take a deposit and have a cancellation rule, with its limits, its record and a way to check it, running **locally, at zero cost, with no network and no npm dependencies**. It is the "Phase 0" prototype core: the same code is meant to run later against real services through Guard, and against the engine's simulated services for the crash test. So the design keeps the seams the plan names: adapters, pure limits, a record, one step per call.

Everything here runs against in-memory fakes. That is a stand-in for real services, not a claim about them.

## The decisions that matter

**1. "Confirmed" is a read, never a reply.** Every write (hold a slot, create a link, confirm the event, refund, send a message) is followed by a read from that service's own store, and only the read is recorded as `confirmed`. This is the central idea of the product ("a booking counts when the calendar's record shows it") and it is what catches the calendar that says ok and saves nothing. Each write is also preceded by a look: after a lost reply the agent finds its own earlier event, link or refund by the booking id instead of making a second one (the refund-desk pattern, applied everywhere).

**2. Payment events say "look", the payments record says what happened.** `payment_link.paid` and `payment.captured` describe the same payment, and either can arrive twice, late, or never. The agent counts payments from the link's own list, by payment id, so no combination of events can create a second deposit or lose one. When a hold is about to expire, the agent looks at the payments record first.

**3. The hold is a tentative calendar event.** The plan leaves open where a hold lives. Keeping it in the calendar means a hold is visible to every other booking and survives the agent losing its own state; confirming is an update from tentative to confirmed. The cost is one more calendar operation (`update`), which the plan's list (insert, get, list, delete) did not include.

**4. A payment after the hold expired re-checks the slot.** If the slot is still free, the agent holds it again and confirms. If not, it refunds the deposit (within the limit) and tells the owner. The customer paid in good faith, so the agent never keeps money for a booking it cannot give.

**5. The limits are pure, and each message is gated.** `src/limits.ts` has no side effects and reads nothing but its arguments, so Guard can run the same functions later. Every outgoing message passes through one function (`say`) that renders the templates from the record, runs the limits on the **final text**, sends only if none blocks, and reads the message back from the provider's outbox. "Booked" additionally requires `confirm-only-when-recorded`.

**6. Templates only, and the check reads text like a customer.** No v0 message is model-written. Templates take their values from one `MessageFacts` object built from the booking and settings; the outgoing check (`src/language/check.ts`) reads the final text again from scratch (rupee amounts, dates with their weekday, times with their period word such as शाम, links, any leftover number) and blocks whatever the record cannot explain. It does not care how the text was made, so it will keep working when a model writes the free text around the templates. Two tests keep templates and check in step: a drift test (every template, in both languages, passes the check) and a mutation test (changing any one value in any template makes it fail; about 390 mutations are tried).

**7. Dates have written rules.** "अगले मंगलवार" is the Tuesday of the next calendar week (Monday to Sunday). A bare weekday is the first one after today. "कल" is tomorrow in the business's time zone, not UTC. Every weekday phrase and every time without am/pm is read back with the full date, and nothing is held until the customer says yes. The rules are in the header of `src/language/dates.ts` and in the README.

**8. STOP is strict.** After STOP, nothing goes to the customer: no acknowledgement, no reminder, no reply if they write again. The booking itself stays. Messages to the owner still go. Two rules cover it (`opt-out` for every message, `no-message-after-stop` for reminders) so either one alone would hold.

**9. The cancellation window means "enough notice".** Cancel at least `windowHours` before the start and the deposit is refunded, if it is within `refundLimitInr`. Cancel later, or ask for more than the limit, and the owner decides by replying "approve b-3" or "deny b-3". "Within the limit" includes the limit itself. The late-cancellation case uses the `refund-limit` rule id rather than inventing a tenth rule.

**10. One state per step, state in a store that is passed in.** `agent.handle(event)` takes one message, one payment event or one tick and returns. Conversation state lives in a `Store` handed to the agent, never in module variables, so every situation starts clean and the engine can run each step as a task. Inbound messages are marked seen when they arrive (a customer who is ignored can write again); payment events are marked seen only after they were processed (a failed step can be run again with the same event, and processing is idempotent anyway).

## How the checks were made, and why they should not be vacuous

- **Situations, not only unit tests.** `crash-test/situations.ts` holds 26 situations: the rows of plan 4.4 that fakes can express (1 to 14, with #3, #8 and #9 split into variants and #8 and #9 in both languages), plus a few the plan implies (a normal booking, cancellation inside the window, a refund above the limit, STOP, two customers on one slot, a conflict at the moment of the hold, outside opening hours, reschedule, reminders). Each one starts a fresh world, makes something go wrong on purpose, and judges **from the fakes' own records**: what the calendar holds, what the payments service holds, what the messaging outbox holds. The agent's return values are never consulted. The same situations back both the tests and `scripts/hand-check.ts`.
- **A mutation check by hand.** To see whether the situations can fail, 15 deliberate bugs were put into a scratch copy, one at a time (trust the calendar's reply, no inbound de-duplication, count every payment as a deposit, no look before creating a link, refunds always allowed, late cancellations refunded automatically, weekday phrases not confirmed, no double-booking check, hours not checked, "booked" without both confirmations, outgoing check switched off, and others). 13 were caught directly. Two were not: switching off only the `opt-out` gate (the `no-message-after-stop` gate still holds the reminders, which is the point of having two) and removing only the "I can't go lower" sentence (the quote still states ₹450; a check on that sentence was added). Also fixed during this: one test regex mistook "is free" (the slot is available) for "free of charge".
- **A type check that is not part of the folder.** Node strips types without checking them. The code was checked once with TypeScript 5.9 borrowed read-only from another project's `node_modules` (`strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUnusedLocals`), with no errors. No tsconfig is committed, because it would need `@types/node` installed, and this folder has no dependencies.

## Syntax rules used

Only erasable TypeScript: no enums, namespaces, parameter properties or decorators. Type-only imports use `import type`. Imports carry their `.ts` extension. Files that read the settings JSON use `new URL(…, import.meta.url)`, so they work from any directory.

## Size

About 2,900 lines in `src/` (of which the agent is about 750, the templates 150, the date and time reading 200), about 1,500 lines of tests, situations and script, 103 tests, 26 situations, 129 checks inside them. No dependencies. The two largest costs are the two languages of templates and the flow's honesty (look first, read back, reconcile), which is the point of the pathway.

## Choices to review

1. The hold as a tentative calendar event, and the added `update` operation (decision 3).
2. A late payment re-holds the slot if it is free, otherwise refunds (decision 4).
3. STOP is strict: no acknowledgement message (decision 8). A confirmation of the opt-out is common practice; whether to allow exactly one is a policy call for the owner.
4. The meaning of `windowHours` (decision 9), and that a late cancellation is "ask the owner", not "no refund".
5. A bare weekday means the first one after today, so "Tuesday" said on a Tuesday means a week from today (decision 7).
6. Owner commands (`approve b-3`, `deny b-3`, `retry b-3`) are recognised by the owner's number alone. Real approvals belong in Guard.
7. The commit trailer on this branch names Claude Sonnet 5.5, the model that wrote it, not Opus 5.5 as the task text said.
