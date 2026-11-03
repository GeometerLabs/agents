# Fixtures

Sample payloads for the live adapters and the webhook parsers. None of them is a call to a real service.

**Reproduced from the providers' own documentation pages (read 3 Nov 2026) through a summarising fetch tool, and trimmed to the fields the code reads. Spot-check against the pages before relying on an exact value:**

- `razorpay-payment-link-create.json`, `razorpay-payment-link-fetch.json`, `razorpay-payment-links-list.json`, `razorpay-payment.json`, `razorpay-refund-create.json`, `razorpay-error-not-exist.json`: https://razorpay.com/docs/api/payments/payment-links/ , https://razorpay.com/docs/api/payments/fetch-with-id/ , https://razorpay.com/docs/api/refunds/create-normal/
- `razorpay-webhook-*.json`: https://razorpay.com/docs/webhooks/payloads/payment-links/ , /payments/ , /refunds/ (trimmed)
- `whatsapp-webhook-text.json`, `whatsapp-webhook-button-reply.json`, `whatsapp-webhook-list-reply.json`, `whatsapp-webhook-template-button.json`, `whatsapp-webhook-status-delivered.json`, `whatsapp-send-reply.json`: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages.md and `/messages/{text,interactive,button,status}.md`, and `.../messages/send-messages.md`. The `contacts` block and the `metadata` block are the text sample's, reused around the other message types.

**Assembled from the documented field lists (the docs show no complete sample to copy):**

- `google-events-list.json`, `google-freebusy.json`, `google-error-not-found.json`: https://developers.google.com/workspace/calendar/api/v3/reference/events/list , .../freebusy/query , https://developers.google.com/workspace/calendar/api/guides/errors
