// The bundle's side of B72's "What to ask the shop for" card (modules/ask-card): the card is made for exactly the templates the bundle can run, and its review
// markers are the panel's REVIEW_STATE. Moved here from modules/ask-card/test/ask-card.test.ts, since a shared module's tests may not import the bundle
// (modules/test/boundary.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_REVIEW_STATE, CARD_TEMPLATES } from "../../modules/ask-card/render.ts";
import { KINDS } from "../lib/kinds.ts";
import { REVIEW_STATE } from "../panel/languages.ts";

test("the card is made for exactly the templates the bundle can run", () => {
  assert.deepEqual([...CARD_TEMPLATES].sort(), Object.keys(KINDS).sort());
});

test("the card's machine-written markers are the panel's REVIEW_STATE: change both together, when a named reader has signed", () => {
  assert.deepEqual(CARD_REVIEW_STATE, REVIEW_STATE);
});
