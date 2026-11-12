// The one front door (item 11e, modules/assistant/route.ts): which skill a message to the shop's one number is for, cheapest first and never by a model. The relay's
// replies go to the relay, the owner's to the assistant, a tap to the skill that issued it, then a reference, the words, an open case, one skill, else a menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { menuRowId, routeMessage } from "../route.ts";
import type { RoutingSkill } from "../route.ts";
import { approvalButtonId } from "../../approvals/buttons.ts";
import { cardButtonId } from "../cards.ts";

const OWNER = "+919000000000";
const PRIYA = "+919811111111";
const skill = (name: string, refs: RegExp, buttons: string[], words: string[], live: Record<string, string> = {}): RoutingSkill =>
  ({ name, routing: { refs, buttonPrefixes: buttons, words: { en: words }, liveCaseOf: (p) => live[p] } });
const bookings = skill("bookings", /^b-\d+$/u, ["svc:", "slot:"], ["book", "appointment", "haircut"]);
const fees = skill("fees", /^[fq]-\d+$/u, ["fee:"], ["fee", "fees", "tuition"]);
const route = (m: { from: string; text: string; reply?: { id: string } }, skills = [bookings, fees]) => routeMessage(m, { owner: OWNER, approvers: ["+919000000001"], skills });

test("the relay's replies, typed or tapped, go to nobody in the runtime; the owner's words and card taps go to the assistant", () => {
  assert.deepEqual(route({ from: OWNER, text: "approve K7M2QX" }), { to: "relay" });
  assert.deepEqual(route({ from: OWNER, text: "Approve", reply: { id: approvalButtonId("approve", "K7M2QX") } }), { to: "relay" });
  assert.deepEqual(route({ from: "+919000000001", text: "deny K7M2QX" }), { to: "relay" });
  assert.deepEqual(route({ from: OWNER, text: "close Sunday" }), { to: "assistant", why: "owner" });
  assert.deepEqual(route({ from: OWNER, text: "Approve", reply: { id: cardButtonId("yes", "K7M2QX") } }), { to: "assistant", why: "card" });
  // a customer typing the relay's words is just a customer
  assert.equal(route({ from: PRIYA, text: "approve K7M2QX" }).to, "menu");
});

test("a customer's message: a tap, then a reference, then the words, then the open case; otherwise a menu", () => {
  assert.deepEqual(route({ from: PRIYA, text: "Haircut", reply: { id: "svc:haircut" } }), { to: "skill", skill: "bookings", why: "button" });
  assert.deepEqual(route({ from: PRIYA, text: "Fees", reply: { id: menuRowId("fees") } }), { to: "skill", skill: "fees", why: "button" });
  assert.deepEqual(route({ from: PRIYA, text: "about f-3, can I pay next week?" }), { to: "skill", skill: "fees", why: "reference" });
  assert.deepEqual(route({ from: PRIYA, text: "I want to book a haircut" }), { to: "skill", skill: "bookings", why: "words" });
  const withOpenFee = skill("fees", /^[fq]-\d+$/u, ["fee:"], ["fees"], { [PRIYA]: "f-3" });
  assert.deepEqual(route({ from: PRIYA, text: "ok thanks" }, [bookings, withOpenFee]), { to: "skill", skill: "fees", why: "open_case" });
  assert.deepEqual(route({ from: PRIYA, text: "hello" }), { to: "menu", candidates: ["bookings", "fees"] });
});

test("a shop of one skill: everything a customer sends is that skill's, as today", () => {
  assert.deepEqual(route({ from: PRIYA, text: "hello" }, [bookings]), { to: "skill", skill: "bookings", why: "only_skill" });
  assert.deepEqual(route({ from: PRIYA, text: "what are your fees" }, [bookings]), { to: "skill", skill: "bookings", why: "only_skill" });
});
