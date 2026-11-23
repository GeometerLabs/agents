# internal/orders/reading: what is left

- `plansLine` (words.ts: the plans as one line of words, "Lunch plan ₹2,400, ...") and `planName` are not here: they format a message from the settings, so they belong with the
  Orders words and templates (the lead's), not with the reading.
- `createOrdersRouter` and `createOrdersModelParser` (reading.ts): wiring over `internal/understanding`, done where the Orders runtime builds its router.
- The `PLAN_WORDS` and `ORDER_WORDS` lists for the review sheets (REVIEW-hi/ml/kn.md) stay with the TypeScript until the sheets move; the patterns made from them are here.
- A `date` or `time` that is not an object is refused by `CoerceIntent` (see Explanation.md); the TypeScript copies it.
