# Fixtures for the WhatsApp providers

Sample payloads for `gupshup.ts`, `webhooks.ts` (messages and statuses) and `statuses.ts`. None of them came from a call to a real service: nothing in this folder has touched Gupshup or Meta.

**Copied from Gupshup's partner documentation, read on 11 Nov 2026.** Changes from the pages: customers' numbers became `919800000001` and profile names became `CUSTOMER_NAME`. The ids, timestamps, error codes and structure are as published. Where the page writes a number as a string or as a number, the fixture keeps the page's choice.

- `gupshup-v3-status-set-callback.json`, `-enqueued.json`, `-sent.json`, `-delivered.json`, `-read.json`, `-failed.json`, `-failed-internal.json`, `gupshup-v3-message-audio.json`, `gupshup-v3-message-image.json`, `gupshup-v3-message-call-permission-reply.json` come from https://partner-docs.gupshup.io/docs/events (updated 30 Oct 2026). These are the "V3" events: Meta's body plus `gs_app_id`, with `gs_id` on statuses. "Failed (internal)" is Gupshup's own refusal before Meta saw the message. It has no wamid, no metadata and no `gs_app_id`.
- `gupshup-v3-message-text.json` and `gupshup-v3-status-read-passthrough.json` come from https://partner-docs.gupshup.io/docs/whatsapp-passthrough-apis-for-partners (updated 21 Jul 2026). In that page's status example, `id` is a second UUID and not a wamid, while the events page has a wamid there. This is why the parser keeps both ids and the record is searched for either.
- `gupshup-v3-send-reply.json`, `gupshup-error-authentication.json` and `gupshup-error-callback-billing.json` come from https://partner-docs.gupshup.io/docs/whatsapp-passthrough-apis-for-partners (the reply's id) and https://partner-docs.gupshup.io/reference/post_partner-app-appid-v3-text-message (the error bodies, the same on every v3 message page).

**Copied from Meta's documentation, read on 11 Nov 2026:**

- `meta-status-failed.json` comes from https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status.md ("a message that failed to be sent"). Meta's delivered example is in `templates/commerce/bookings/test/fixtures/whatsapp-webhook-status-delivered.json`.

**What Gupshup's docs do not show:** a v3 callback for a tapped reply button or list row. The tests wrap Meta's own examples (`templates/commerce/bookings/test/fixtures/whatsapp-webhook-button-reply.json` and `-list-reply.json`) in Gupshup's `gs_app_id`. The call-permission reply above shows Gupshup keeping Meta's `interactive` object as Meta writes it. A real Gupshup app must confirm this (Deferred.md).
