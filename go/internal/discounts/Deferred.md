# The discount authority: what is not done yet (24 Nov 2026)

Done before the pilot (`e1-finish-24nov`, see Explanation.md): the panel's boxes, the card on the owner's page and in the assistant's "what needs me", a numberless "any discount?", and the order's page at the agreed price.

| What | Why not now | When |
| --- | --- | --- |
| **A contract case for the order's page with a deal.** The page (Orders `OrderView`) shows a deal's line at the agreed price, and a Go test (`orders/discount_view_test.go`) proves that the lines add up to the total. No black-box case exists, because no HTTP path gives a page or MCP order a deal today. Such an order is placed with exact items and no price, in its own `web:` conversation, which WhatsApp and the chat never reach. A deal is agreed only on WhatsApp or in the chat, and those orders have no page. | Building that path would be a new feature, not this check. | With the first way to ask for a price from the page. |
| **A discount asked after the link was sent.** On an order or booking already held, "any discount?" (and a named price) is answered as today: the order waits for its advance. The agent offers nothing new. | A new price after the link would need the link and the hold made again. | If a pilot shop asks for it. |
| **"Discounts this month" without a model.** It is a source of the owner's talk (`TalkFact`), so it is answered only when the talk model is on. No fixed phrase reads it by rule. | A rule phrase needs the shared owner reading (`modules/assistant`) and its words. | When a pilot shop runs without the talk model. |
| **"Offer the cap" on the owner's no.** On a no, the customer is offered the list price. A later "any discount?" gets the cap price. | The brief: list price unless the design needs more. | If an owner asks for it. |
| **The owner's page words for the card** (`OWNER_MORE.discount`, `OWNER_LOOK.tag.discount`) are machine-written in hi, ml, kn. They are not yet on a review sheet: the owner page's words have none. | The owner page has no review sheet of its own. | With the owner page's review sheet. |
| **The Service desk's estimates and Quotes (T09, T12).** | Not built yet. The package takes any priced item. | With those templates. |
| **The TypeScript demos** have no discounts. The decision is Go only, because there are no duplicates (decision 61). The demos' reader reads `askDiscount` (it is the same rule parser) and ignores it. | The demos show the list price as the floor. | Not planned. |
