# Presets: a trade as data

The panel's first question is "What does the shop do?". Each answer is one small JSON file in this folder, named by its id (`salon.json`). A preset is DATA on top of one
existing template: it adds no agent code, no new settings field and no new rule. Everything it fills in goes into the same boxes of the phone form an Operator would type
into, in the language they read the panel in, and stays editable; `validateSettings` of the template is still the last gate when the shop is saved. The prices in a preset are
examples: the form tells the Operator to check each one.

The reader and validator are `../presets.ts` (`readPreset`, `loadPresets`); a broken file stops the panel at start with the file's name and what to fix. A preset is not a
template: `templates.ts` finds templates by `template.json` in `templates/<domain>/<name>/`, and this folder is not under `templates/`.

```json
{
  "schema": 1,
  "id": "salon",                                  // lowercase letters, digits, dashes; the file's name
  "names": { "en": "...", "hi": "...", "ml": "...", "kn": "..." },   // the trade's name; hi, ml, kn are machine-written and on the review sheets
  "template": "bookings",                         // bookings | fees | orders | stock-orders | listings (what the phone form can set up)
  "variant": "classes",                           // optional; only a variant the phone form can set up: fees "classes" or "creditBook" today
  "prefill": { },                                 // by template, see below
  "character": { "personality": "warm", "paint": "pink" }   // optional suggestions for the Character step; the Operator still chooses
}
```

Prefill, by template (every `names` is a name in the four languages, one short line):

| template | prefill |
| --- | --- |
| bookings | `services` (1 to 4: `names`, `priceInr`, `minutes`), `depositInr` (at most the cheapest service), `windowHours`, `opens`, `closes`, `days` (0 = Sunday), `capacity` |
| fees | `batches` (1 to 6: `names`, `feeInr`), `dueDay`, `graceDays`, `lateFeeInr` (at most the cheapest fee); variant `classes` also needs `timetable` (`batch` = the row, `day`, `time`, `minutes`) |
| fees, variant `creditBook` | `creditBook` (`maxPerPersonInr`, `remindEveryDays`), `reminderHour`, `reminderMost`: the credit book (decision 63); no person is ever prefilled, who owes what is the owner's |
| orders | `menu` (`names`, `priceInr`, `dailyStock`), `pickup` slots (`from`, `to`, optional `names`), `cutoffDays`, `cutoffTime`, `advance` (`full`, or `part` with `percent`), `maxItemsPerOrder` (times the dearest item at most a day's refund cap) |
| listings | `{}` (nothing: a listings-only shop has no example values; its first form starts empty) |
| stock-orders | `supplier` (a placeholder name, never a real person or number), `items` (`names`, `unit`, `priceInr`, optional `reorderQty`), `maxPerOrderInr`, `monthlyBudgetInr` |

A preset naming an unknown template, a variant the template does not have, or a variant the form cannot set up yet is refused. Tiffin (orders with `plans`) and equipment hire
(bookings with `rental`) wait for their form step (../Deferred.md); their files are not here until then.

"Other" is not a file: the Operator types the trade in their own words and picks the kind of work; the form starts empty.

Personality is the one "mood" an Operator chooses (warm, cheerful or brief); the faces' moods follow the shop's real state and are never chosen. Paint is one of the
signboard paints in `modules/channels/chat-paint.ts`.
