<!--
What this is for: the one-page plan for B14 item 5, Geometer's own demo salon agent running through Guard for two weeks before the first client. Checkpoint item 10, second half.
Who runs it: the owner (or the partner they name) checks daily; the lead reads the weekly summary. Read README.md in this folder first (set-up, the record, procedures P1 to P6).
-->

# Demo salon through Guard: two-week soak (B14 item 5)

## What runs

- **One shop**, the Bookings template as "Glow Salon DEMO", on a Geometer server with its own Guards for WhatsApp, Razorpay and Google Calendar, the approvals relay and the deploy bundle as a real client would have them. Start it after bookings.md has passed or its findings are closed.
- **Real services, test money:** the provider's sandbox number (or a real number kept for this, if the lead says), Razorpay **test mode**, a **test** Google calendar. UPI at ₹1 only if the lead asks for it; never a real customer.
- **Traffic.** Two or three people (the owner, the lead, a friend) act as customers every day with the mix below, plus the owner answering as the salon owner. If no one is free some day, run the day's minimum (one booking, one payment) so the days stay in row.
  - daily: one booking and deposit; one change (reschedule or cancel inside the window, with the refund);
  - three times a week: a refund above the limit that the owner approves or refuses; a payment event sent twice; a booking for a time already taken;
  - once a week: a Guard container stopped for 2 minutes under traffic, started again (P3); a night with no customer message, then a reminder after 24 hours (P4);
  - once in the two weeks: the whole runtime restarted (P6) and a day of the nightly snapshot restored with `geometer restore` to a spare folder (a drill, not on the live shop).
- Settings are not changed during the two weeks except by the lead, and each change goes in the log below.

## What to watch every day (10 minutes)

1. `node bundle/geometer.ts status`: the shop running, every Guard ready, the line "N of M limits proven to bite" with N equal to M (any rule that cannot be self-tested is named; note it), the last backup and the last restore drill.
2. The panel's "What we did" for the day: count entries by outcome. Note every `failed`, `unconfirmed` and `blocked` and say, in a sentence, whether it was expected (the test you made on purpose) or not.
3. The unfinished-work list: anything older than a day with no owner action is written down.
4. Money against Razorpay's test dashboard: the day's deposits and refunds equal the record's `record_deposit` and `refund` confirmed entries. Any difference is a finding.
5. WhatsApp: no message that arrived twice on a phone; every reply that should have gone, did; the sandbox number still working (a token or sandbox expiry shows here first; **check in the provider's console**).
6. Guard's own logs (`geometer logs`): any restart you did not cause; the heartbeat and fleet's "Guard not ready" alert are quiet.
7. The server: disk and memory (a note of the numbers each day, so growth shows: the size of the runtime's saved state grows with the shop's age, though since layout 3 (11 Nov) a step writes only the rows it changed, so the daily disk writes should not grow with it; write the size of the saved state and the day's disk writes each day).
8. One line in the log below.

## Daily log (copy a row a day)

| Day | Date | Tests run | Guards ready, N of M | Outcomes: failed / unconfirmed / unexpected | Money matches dashboard (yes/no) | Saved-state size, disk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |

## What counts as done

All of these, for 14 days in a row (a day lost to the machine being off extends the soak by a day; a day with a finding is not lost, but the finding is closed before the count goes on):

1. Every day has a log row, and every `failed`, `unconfirmed` or unexpected `blocked` entry has a written reason.
2. The money matches Razorpay's test dashboard every day: no deposit counted twice, no refund sent twice, no refund the record does not show.
3. Each Guard stopped on purpose: the customer's message was answered once after it came back, nothing was lost, nothing went twice, and the tripwire count came back to N of N.
4. The restart and the restore drill each worked once.
5. No message left the shop that Guard had not seen: nothing in the provider's console that the record does not show (**check in the provider's console**: sent messages against `send_message` confirmed).
6. The saved-state size and the disk are written down and have not grown in a way that needs a change before the first client; if they have, that is a finding to the lead, not a pass.
7. The owner's summary: what was tried, what was found, what was changed, and what was **not** tried (real customers, real cards, real UPI beyond ₹1, more than one shop, a long outage).

Done means these conditions held on these days on these services. It does not show the agent is right for a real shop, and the first client's go-live still has its own checks.

## Send back to the lead (end of week 1 and end of week 2)

The daily log; `entries.json` exported at the end; the list of findings with the day, the entry `seq` and what was done; screenshots of any message that looked wrong; Razorpay's test payment and refund counts for the period.
