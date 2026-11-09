# Razorpay: what a shop needs

Only for a shop that chose it (B71: UPI is the default and needs none of this).

- **The shop's own Razorpay account**, opened by the shop. Geometer never opens one for a shop and never holds its money. A live account can be opened as an unregistered individual, but Razorpay asks for KYC and a website or app with policy pages, for each shop's own account too; whether an Instagram page counts is not known (monorepo `docs/research/2026-11-phase0-providers-and-accounts.md`).
- **An API key** (Settings, API keys: the Key ID and the Key secret) and **a webhook** (Settings, Webhooks: the address the panel shows, and a secret the shop chooses). They are handed in through the panel's secrets inbox and read only by the shop's Razorpay Guard and the inbox.
- **What it costs:** 2% of each payment and 18% GST on that fee, paid by the shop to Razorpay, not returned when a deposit is refunded (a refunded ₹500 deposit costs the shop about ₹11.80). The panel's cost line reads the rates from the price list (`razorpay.platform-fee`, `razorpay.gst-on-fee`).
- **What it gives:** a payment counts when Razorpay's own record shows it, refunds within the owner's limit go through Guard by themselves, and one above the limit waits for the owner's approval on WhatsApp.
