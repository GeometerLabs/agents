# Deferred: the open panel and the phone setup

Not built, or built only as far as said. The first block needs another part of the product to change; the rest is the panel's own.

## Needs the bundle (the deployer, compose) or Guard

- **Guard must list the three reads, or the connection checks are refused as unlisted routes.** Today `bundle/generate/guards.ts` lists only `POST /{version}/{phone_number_id}/messages` for WhatsApp and the events routes for the calendar. Add `GET /{version}/{phone_number_id}` (operation `read_number`, same exact `phone_number_id` allowlist) to the WhatsApp spec and `GET /calendar/v3/calendars/{calendarId}` (operation `get_calendar`, same exact `calendarId` allowlist) to the calendar spec, and a Guard agent for the panel (`panel-<shop>`, restricted to those operations plus the Razorpay `list_links` read, which is already listed). The same goes for the templates in `monorepo/deploy/pathways/bookings/`. Until then `PANEL_GUARD_URL` points at something else, or the checks say `refused_by_guard` with Guard's own words.
- **Proposals the bundle is asked to adopt** (all in `contract.ts`, each with a checker): `status/<shop>.json` (`updatedAt`, `deploy`, `limits {proven, of, unprovable}`, `versions`, `stopped {at, requestId}`, `backups`); the stop request `requests/<shop>.stop.json` (the deployer acts, then shows `stopped` in the status, and removes the request); `shops/<shop>/owner.json` and `pins.json`; `exports/<shop>/{record,bookings}.json` (what `client-report.ts` reads, written by the deployer from the runtime's store); the `razorpay_key` file as `<key id>:<key secret>` on one line (the deployer turns it into the Basic credential); and, when a shop has no `google_service_account.json` in its inbox, the server-wide service account is used (hosted mode: `PANEL_CALENDAR_SHARE_ADDRESS` is that account's address).
- **The panel's container.** Its mounts: `shops/` read-write, `secrets-inbox/` write-only, `status/` and `exports/` read-only, `requests/` read-write, `panel/` read-write (its own data), the data key and the signing key as files outside `panel/`. Its networks: it must reach each shop's runtime (`/readyz`, `/status`) and each shop's three Guards; those are on per-shop networks today, so the bundle decides how (`PANEL_RUNTIME_URL`, `PANEL_GUARD_URL`, `PANEL_WEBHOOK_URL`).
- **Resume after a stop.** The panel only stops. Starting a stopped shop again is done on the server with the bundle's command.
- **Hosting share measured per shop** (a setting today, `PANEL_HOSTING_SHARE_PAISE`).

## Razorpay's account, and the inbox

- **Pin the Razorpay account.** Pin the `account_id` of the first signed webhook and have the inbox refuse events from any other account. Until then the check proves the key works and is in the right mode, and the page tells the person to look for the shop's name on the first test payment link.
- **Pin the key id into Guard's allowlist** the same way the WhatsApp number and the calendar are pinned.

- **A shop name is reserved only by the panel's own drafts.** Between step 4 and the save, a shop folder made by hand with the same name is refused at the save (its folder is not touched), but this partner's keys already sit in `secrets-inbox/<id>/`. The bundle's `shop add` should refuse a name whose inbox already holds files.

## Cost line

- **The cost line does not read fleet's cost figures yet (5 Nov, updated 7 Nov).** "Geometer's plan" reads the shop's plan fee from the list of 7 Nov (Basic ₹99, Business ₹299, before GST): the plan fleet reports, or from the shop's settings Business when it takes a deposit and Basic when it does not. It shows the list price; the Innovator price is in the Plan block above it, and is not applied to the cost line yet. The AI, WhatsApp, server-share and support figures that fleet works out each month (B45) are not shown here either; the panel has no way to ask fleet (a credential, or fleet's answer carrying them). Revisit when: B32's margin view is built.
- **The warning codes are fleet's** (`allowance_80`, `balance_80`, `whatsapp_unsettled`); a code the panel does not know is not shown, and the plan words for hi, ml and kn have not been read by a native speaker.
- Real usage instead of assumptions: counts of messages from the runtime, so "early estimate" becomes "from the record" for those lines too (today only the number of bookings comes from the record).
- **Which price this builder pays.** The panel reads the plan's list price from the newest price list for every builder. An Innovator (40% off, up to 25 shops) and a builder on their own server (half the plan price) pay less, which the signed licence (B13) will carry per deployment; then the cost line should read that. Until it does, the Plan block shows the Innovator price and the cost line the list price.
- **The monthly model cap in the cost line.** The model is in Geometer's plan up to the plan's allowance and a cap per shop, and above it the agent falls back to its rule parser and the builder is told. The line says only that the model is included, because the per-shop cap does not exist yet (bundle/Deferred.md, "Per-shop model caps"). When it does, add the cap and where the builder sees that a shop went over it.
- A warning when the newest price list is more than 90 days old; the WhatsApp provider fee once a provider is chosen (`PANEL_WHATSAPP_PROVIDER`); Meta's own INR rate card, read once, replacing the second-hand figure.
- The line is not in the sell guide yet (B26 says setup and the sell guide).

## Accounts and operations

- No page to list or revoke invitations, change a passphrase, sign out everywhere (the version counter is there, the button is not), or reset a forgotten passphrase (the server's owner makes a new invitation). No second factor.
- The login limit is in memory: a restart forgets it. Drafts of a setup that was never finished stay on disk.
- Retention and deletion on request for the shops Geometer hosts (B25 names the data duties): no page or command yet; the panel's own data is accounts, invitations as hashes, drafts, which secrets arrived, the last checks, and the papers it made.
- The monthly report is made on a button, in the owner's language. Sending it to the owner on WhatsApp, a schedule, the QR and the verify page (needs a deploy yes) are not here.
- Alerts. The panel shows status when you open it; alerts from outside the server are fleet's.

## Setup

- Only the `bookings` form exists. A contributed template with its own `setup` kind is listed and says a builder sets it up; a form generated from the template's settings schema is the next step.
- The shop's services are four rows, names typed once (the other languages reuse them, as the demo does); a service's names in each language, and per-day hours, are changed in `settings.json` by a builder.
- The checks need the server to have applied the shop. There is no "check before saving" for the connection checks, because the keys are in the inbox and only Guard holds them.
- Going live itself is the deployer's: "Ready to go live" makes the certificate and says so; it does not switch anything on.
- Others who approve refunds (B37, 8 Nov): the form takes two people and gives them the ids `approver-1` and `approver-2`; names, more people and removing one are done in `settings.json`. The shop page and the go-live checks do not show who approves yet. In a Bookings shop the panel sets the refund limit at or above the deposit, so a deposit refund is never held and the approvers are asked only about other refunds (an extra payment). The new words are machine-written in Hindi, Malayalam and Kannada, waiting for native review (section 7 of the review sheets).

## Languages and looks

- Hindi, Malayalam and Kannada are machine-written. Nothing can be called reviewed until a named native reader has signed section 7 of the sheets and `REVIEW_STATE` is changed. Tamil and Telugu are not here.
- Known doubts from the writers: "deposit" is one word in the pricing document's four fixed lines and another in the rest of the same screen in Hindi, Malayalam and Kannada; "passphrase" is written as the everyday "password" in Hindi and Kannada; "builder" in Kannada can read as a building contractor; "the helper" in the WhatsApp steps is read as "the agent".
- No browser was used. The pages were not looked at on a phone, a screen reader was not tried, and the tab bar's sign-out button is a form styled like a link.

## To do, export and handover (B31, B38; 7 Nov)

- The list is as fresh as the deployer's export of the record (every quarter of an hour). A button's effect shows after the next export. A live read from the runtime would be fresher, but the panel does not reach the runtime (see "The panel's view of the runtime" in `../Deferred.md`).
- A recovery request that the runtime did not take for an hour is dropped by the deployer (said once in its log). The panel does not show the state of a request it filed.
- The handover needs the shop to be running, because the owner's message has to reach the agent. A shop pinned to a template version older than this one does not know `move CODE` (the owner's message gets the usual "I did not understand"); update the shop first.
- The new person does not accept the shop; the person moving it and the owner agree. A partner could be handed a shop they do not want. Add an accept step if that happens.
- A move is within one server. Moving a shop between two servers (a builder's own server to Geometer's hosted one, or the other way) is an export and a new `shop add` there; the keys are entered again. There is no import.
- Hindi, Malayalam and Kannada for the new pages (to do, export, handover) are machine-written like the rest, listed in section 7 of the review sheets; the new lines wait for a native reader.
- The export holds the record as the deployer exports it (customers as short hashes). A copy with the raw numbers, for the owner who asks for it, is the shop's own database (`geometer restore` makes one from the backup); an export mode that reads the database inside the shop's volume and keeps the numbers is not built.

## UPI in the panel (B33)

- No live check of a UPI ID: nothing can read one without paying it. The partner types it and reads it back to the owner; a wrong but well-formed ID is not caught by the panel.
- Switching a saved shop from Razorpay to UPI (or back) in the panel changes the settings and the notes only. The old Razorpay secrets stay in the write-only inbox until whoever runs the server removes them.
- The new Hindi, Malayalam and Kannada sentences (the `upi` block and the two inbox kinds) wait for a native reader.
- A phone-width look at the new step has not been done (no browser).
- The papers page's sentences and the shop page's link to it (B28, B35, B36) wait for a native reader in Hindi, Malayalam and Kannada, and the page has not been looked at on a phone (no browser).
- A statement's language follows the person's latest case; the page has no language choice yet (the POST takes `lang`, the form does not offer it).

## The shop's licence (B13, 8 Nov)

- **The renew link is fleet's, as fleet last said it.** The panel shows the link from the last heartbeat's answer; a link that has expired at Razorpay is not checked.
  Revisit when: fleet re-links an expired invoice and partners find stale links.
- **No licence page across shops.** The state is on each shop's page and its card; a builder with many shops has no one list of the ones that owe. Revisit when: a
  builder asks for it.
