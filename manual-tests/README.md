<!--
What this is for: the index of the manual tests on the REAL services (Razorpay test mode, the WhatsApp provider's sandbox number, a test Google calendar).
They replace the simulated Razorpay, WhatsApp and Calendar that the owner dropped on 10 Nov 2026 (plan decision 36, checkpoint item 10).
Who runs it: the owner, or a partner, by hand, one sitting per script. The lead reads the results tables that come back.
Why a top-level folder: the three templates share one set-up and one way of reading the record, and the soak plan is not about one template.
-->

# Manual tests on the real services

Three scripts, one per partner template, and the plan for the two-week soak. Nothing here runs by itself: a person follows the numbered steps with a phone in hand.

| File | What it checks | Time |
| --- | --- | --- |
| [bookings.md](bookings.md) | Bookings: deposit, calendar, refunds, outage, 24-hour window, report | one sitting, plus a day-2 step |
| [fees.md](fees.md) | Fees: reminders, payment, waivers, refunds, outage, 24-hour window, report | one sitting, plus a day-2 step |
| [orders.md](orders.md) | Orders: stock, cut-off, advance, approvals, refunds, outage, 24-hour window, report | one sitting, plus a day-2 step |
| [demo-salon-soak.md](demo-salon-soak.md) | B14 item 5: the demo salon through Guard for two weeks | 14 days |

**Order: Bookings first** (it has every step the other two reuse, and the calendar), then Orders, then Fees. Run the soak plan last.

## What these tests are, and are not

They use only test accounts and test money. They show what happened on these services on the day, in the cases tried. They do not show the agent is right in a real shop, and a pass in one step says nothing about a step that was not run. Where a script says "check in the provider's console", the repository could not confirm that detail: write down what you saw.

## Set up once

1. **A test shop on a Geometer server** (`node bundle/geometer.ts init` with the server's `--licence-key`, `shop add`, `check`, `deploy`, and the deployer kept running; see [bundle/README.md](../bundle/README.md), "The licence": a paired server's trial covers a test shop, and a release's Guard takes no new work for a shop the lease does not list). Use the template's example settings as the start: `glow-salon.example.json` (Razorpay) and `glow-salon-upi.example.json` (UPI) for Bookings; `bright-tuition.example.json` and `bright-tuition-upi.example.json` for Fees; `annapurna-tiffins-razorpay.example.json` and `annapurna-tiffins.example.json` (UPI) for Orders. Put the owner's number and the test shop's UPI ID in. **The shop's name must say "TEST".**
2. **Two phones.** The *owner phone* (its number is `owner.whatsapp` in the settings) and the *customer phone* (a second number, added as a recipient of the sandbox). A third number is useful for the "two customers" steps; a friend's phone does.
3. **WhatsApp.** The scripts run on either provider; write down which one you used. Since 11 Nov (item 11b) the live adapter speaks both Meta's WhatsApp Cloud API (Graph v26.0) and **Gupshup's v3 pass-through**, chosen in the shop's `runtime.json` (`services.messaging.provider`):
   - **Meta's WhatsApp Cloud API test number** (App dashboard, WhatsApp, API setup: a free test number, up to five recipient numbers you verify by a code), for development only (plan decision 3). This is the default: `runtime.json` names no provider. Callback address and verify token as in bundle/README step 7.
   - **Gupshup** (the pilot's provider, and what a shop goes live on): `"provider": "gupshup"` and the shop's `"appId"` in `services.messaging`; hand in `gupshup_authorization` and `whatsapp_path_token`; add a v3 callback subscription. The steps are in bundle/README, "A shop on Gupshup". It needs Geometer's Gupshup partner account with the test app linked to it. Nothing in the repository has been run against a real Gupshup app yet, so the first run is also the first check of the mapping: if a step fails only because of Gupshup's shape (a path, a header, a callback body), write it down as "provider mapping", not as a product fault, and keep the request and callback bodies (without the token).
   - **On either provider:** WhatsApp's delivered, read and failed reports now land in the record as `message_status` lines beside each send. At every "look at the phone" step, also note the `message_status` line for that message. A `failed` one about a booking or a fee, or to the owner, also shows on the owner's to-do list.
   - Message templates (reminders, report, owner messages outside the 24-hour window) must be approved by the provider before they can be sent. Whether the sandbox lets unapproved templates through is **check in the provider's console**.
4. **Razorpay test mode.** In the Razorpay dashboard, switch to Test Mode, make a key id and secret (the key id starts with `rzp_test_`), and a webhook to the shop's address (`.../webhooks/razorpay`) with its own secret. Hand them to `geometer` as the bundle README says. **Stop if a key does not start with `rzp_test_`.** Values Razorpay publishes for testing (confirm on Razorpay's "test card and UPI details" page on the day): test UPI ID `success@razorpay` pays, `failure@razorpay` fails; test card `4111 1111 1111 1111`, any future expiry, any CVV, any OTP. **Never type a real card, a real UPI ID or a real bank login.**
5. **UPI (the default).** The UPI path has no test mode: the customer pays the shop's own UPI ID by hand and the owner marks it received. For the UPI steps use **a UPI ID of your own that you control, and pay ₹1 only**. The shop's deposit, advance or fee is set to ₹1 in the UPI settings file for these runs (set `deposit.amountInr`, the advance and the fee to 1; the owner's own account is the payee, so the ₹1 comes back to you). Nothing else on the UPI path is a real-money step.
6. **A test Google calendar** (Bookings only): create a new calendar named "GEOMETER TEST", share it with the shop's service account (the `google-key` command in bundle/README), and put its id in the settings. **Never the shop's real calendar.**
7. **Where to look.** *The record* (every step below names the entries) is in the panel under the shop's "What we did", and as a file with `node bundle/geometer.ts export <shop>` (`entries.json`). *Guard's side* is `node bundle/geometer.ts status` and `logs <shop>`. Take a screenshot of each WhatsApp screen you are asked about.

## Procedures the scripts point to

**P1. Read the record.** Open the record, find the entries after the time you noted. Each entry has `action`, `outcome` (`attempted`, `confirmed`, `unconfirmed`, `failed`, `blocked`, `held_for_owner`), the rules' decisions and `refs` (ids from the provider's own records). Copy the `seq` numbers into the results table. `confirmed` means the agent read the result back from the service's own list.

**P2. Make a refund wait for the owner.** Set the template's refund limit below the amount (Bookings `cancellation.refundLimitInr: 100` against a ₹200 deposit; Orders and Fees `refund.limitInr` below the amount). Guard then holds a bigger refund and the approvals relay asks the owner once, with a one-use code ("approve K7M2QX" / "deny K7M2QX", valid for the hours the message names). Put the limit back afterwards.

**P3. A Guard outage (B14).** Stop only the shop's Guard container for the service named (`docker ps` shows them; `docker stop <guard container>`). Do **not** use `geometer stop`: that is the kill switch, a different thing (it lets refunds through). What B14 expects: a customer's message *waits* for the Guard, up to 15 minutes from when it arrived, nothing is lost and nothing is sent in the meantime; a send, a refund or a write whose outcome is unknown is never repeated; when the Guard comes back the waiting message is answered once. After 15 minutes the step runs once more with waiting off, the owner's to-do list gets one item and the customer hears the template's "could not confirm" words only if the WhatsApp Guard is up. Order is shop-wide: while one message waits, other customers' messages wait behind it. Then `docker start` it. **A wrong key** (put a wrong Razorpay secret or WhatsApp token in the secrets and redeploy) is a *different* case: the provider answers "no", which is not an outage and must not wait; expect the template's "could not make the link" / "could not confirm" words and an entry with outcome `failed` or `unconfirmed`. Put the right key back.

**P4. The 24-hour window.** WhatsApp lets the agent send free text, buttons and pictures only for 24 hours after the customer's last message; after that only an approved template. The window is the runtime's own knowledge (WhatsApp has no way to report it). To test: the customer writes once, then stays silent for over 24 hours (do it the evening before), then something the agent must send happens (a reminder, a report, an owner decision). Expect a template message, not free text; if the template is not approved, the send fails with Meta's error 131047 (window closed) or 132001 (no such template) and the record shows a `send_message` entry that is not `confirmed`. A "confirmed" for a send on the live service means the provider *accepted* it: delivery comes from the phone, so always look at the phone. **On Gupshup** the refusal comes later: Gupshup accepts first, so the `send_message` line is `confirmed`, and then a `message_status` line with outcome `failed` and `refs.errorCode` 131047 or 132001 follows (and, for a message about a booking or to the owner, a to-do item).

**P5. Lost reply (a provider does the thing and the answer never arrives).** The repository has no switch that forces this on a real provider (the fault injection exists only in the stand-ins). Do it as a pair, with the lead: approve a refund, and in the same second cut the shop server's network or stop the Guard container, then restore it; check in the Razorpay dashboard whether the refund landed. If it landed with no reply seen, that is the case. If it did not land, repeat with different timing; if after three tries it never lands, write "not reproduced" in the table: that is a result, not a pass. What must hold either way is in the step.

**P6. Restart the shop's server.** `node bundle/geometer.ts stop <shop> --reason test` and then `start <shop>` only restarts the runtime if the lead says so; the plain way is `docker restart <runtime container>` (Guard left running). After the restart the shop must carry on from what it saved.

## What to send back to the lead (every script)

The filled results table; the exported `entries.json`; the screenshots named in the table; the Razorpay test-mode payment and refund ids you used (not keys); a list of every step marked "check in the provider's console" with what you saw; the date, the template version (`pathway.lock`) and the provider used.
