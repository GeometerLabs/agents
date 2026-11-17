# Stock orders: not built yet

Each row says what, why, the trigger and "done when". Strike a row through with "Done <date>" when it is finished.

| What | Why not now | Trigger | Done when |
| --- | --- | --- | --- |
| **Paying the supplier** (a UPI or bank payment made by or through the agent) | Out of the first version by decision: the owner pays as today and may note "paid po-3"; the agent cannot check it | An Operator's client asks for it and a payment provider is chosen; needs its own limits and the refund-like uncertainty design | A paid state read from a payment record, with a crash test for a lost reply |
| **Supplier portals and APIs** (Zoho purchase orders, a supplier's own system) | Only WhatsApp is a supplier channel here; uncertain submission must be qualified per provider | A named supplier with an API and an Operator who needs it | An adapter with the same one-order guarantee and a crash test |
| **A real WhatsApp test** with a real supplier, and Meta's approval of the six templates in `whatsapp-templates.json` | Needs a real account and an owner's step | The first pilot shop | The order, the reminder and the three owner templates approved and one real order made |
| **Native review** of the Hindi, Malayalam and Kannada messages and labels | Machine-written | A native speaker is found | The reviewer columns of `REVIEW-*.md` filled and changes applied |
| **RFQ / quote comparison** between suppliers (T12 extension) | The first version orders from the supplier the owner names or picks | Buyer evidence | A quote request, a comparison table in code and an approval bound to the chosen quote |
| **A runtime server, a saved store, the owner's page and "what needs me"** | The store is in memory; a restart in the middle of an approval is not tested. Needs `modules/runtime` wiring (a `RuntimeKit`, a snapshot codec, the inbox) like Orders' `server/` | Before any live shop | A shop runs under `geometer shop add --template stock-orders`, a restart between approval and send leaves one order message |
| **Panel setup forms and a registered kind** (`bundle/panel/setups.ts`, `bundle/lib/kinds.ts`) | The panel lists the template and a builder sets it up by hand; the go-live certificate and papers are not built | Before a non-builder sets one up | A phone form, and the certificate and Guard spec for the template |
| **Guard spec for the order message** (a limit on messages per supplier per day, in front of the real provider) | Needs the engine's Guard in front of the WhatsApp provider | With the runtime | A spec generated from the settings, tested against `geo-guard` |
| **Signed monthly report** (orders by supplier, budget used, what was never received) | `modules/report` needs the template's data and words | After the runtime | A report like Orders' in four languages |
| **Posting a purchase bill / accounting** | `modules/accounting` has no purchases or payables account; adding one is a shared-module change | When an accountant wants purchases | A bill posted when an order is received, with the books invariants |
| **A language model reading the owner's request** (the shared router) | Rules only; an unreadable request is asked, never guessed | When owners write in ways the rules do not read | The router wired with the same limits unchanged |
| **Voice notes** from the owner | Not wired | Owner demand | The shared voice turn used for the owner's commands |
| **Unfinished-work kinds** (an order with no supplier answer, goods not received) for the panel | Would add to `modules/unfinished/builtin.ts` (shared); the agent already tells the owner | With the runtime | Two kinds registered and listed in the panel |
| **Hindi, Malayalam and Kannada sell guides, a one-pager, the ask card** | The English master is written first | Before the template is "ready to sell" in those languages | The guides, `one-pager.*.html` and `ask-card.*.md` with their tests |
| **Several suppliers on one request, price quotes that differ from the catalogue, part-shipment notes from the supplier, returns, cancelling an order already with the supplier** | First version scope | Owner feedback | Each its own state and crash-test situation |
| **Month name in the owner's language** ("Nov 2026" is in English letters in every language) | A small formatter is needed in the shared language module | With the native review | The month written like dates are |
