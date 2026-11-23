# The discount authority: what is not done yet (24 Nov 2026)

| What | Why not now | When |
| --- | --- | --- |
| **The panel's settings step** has no boxes for the floors and the caps. A shop gets the block from a builder's settings file. The panel keeps a saved block when it edits the shop (`bundle/panel/keep.ts` keeps every key it does not own). `validateSettings` refuses a floor above a price the Operator lowered, in plain words. | It is a form with one floor per service or item in four languages, for two templates. The decision, the binding and the money came first. | Before the first pilot shop asks for it (decision 64: one salon and one kitchen). |
| **The owner's page and the assistant's "what waits"** do not list a waiting price card. The owner answers it on WhatsApp. | Both read the template's owner items, and the page needs a new card kind with its words in four languages (`modules/channels/owner-page.ts`). | With the panel step. |
| **"Discounts this month" without a model.** It is a source of the owner's talk (`TalkFact`), so it is answered only when the talk model is on. No fixed phrase reads it by rule. | A rule phrase needs the shared owner reading (`modules/assistant`) and its words. | When a pilot shop runs without the talk model. |
| **"Offer the cap" on the owner's no.** On a no, the customer is offered the list price. | The brief: list price unless the design needs more. | If an owner asks for it. |
| **A numberless "any discount?"** has no reading. The rule parser reads only a named price ("for 300"). | Offering a price unasked would be a new policy, not the authority. | Owner's decision. |
| **The Service desk's estimates and Quotes (T09, T12).** | Not built yet. The package takes any priced item. | With those templates. |
| **The TypeScript demos** have no discounts. The decision is Go only, because there are no duplicates (decision 61). The differential tests run with the authority off. | The demos show the list price as the floor. | Not planned. |
