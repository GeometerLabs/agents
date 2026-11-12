// The relay's ask as a card (item 11e): a refund Guard holds is asked about, while the owner's window is open, with Approve and Refuse buttons whose ids carry the ask's
// one-use code. A tap is read exactly as the typed "approve K7M2QX": the same code, its one use, the same refund. A tap with a code the relay never issued counts as a
// wrong guess, as the typed one does. Outside the window the approved template goes, as before. Uses the approvals world (the real relay, a stub Guard, the runtime).
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalButtonId } from "../../../../modules/approvals/buttons.ts";
import { startApprovalsWorld } from "./helpers/approvals-world.ts";

const codeIn = (text: string) => /"?approve ([A-HJKMNP-Z2-9]{6})"?/u.exec(text)?.[1] ?? "";

test("with the owner's window open the ask goes as a card, and a tap on Approve does what the typed code does, once", async () => {
  const w = await startApprovalsWorld();
  try {
    await w.ownerWrites("hello"); // the owner's window is open
    await w.heldRefund();
    await w.relay.poll();
    const ask = w.whatsapp.sentTo(w.owner).filter((m) => m.kind === "interactive").at(-1);
    assert.ok(ask, "the ask went with buttons");
    const ids = ask.interactive!.buttons!.map((b) => b.id);
    const code = codeIn(ask.text);
    assert.deepEqual(ids, [approvalButtonId("approve", code), approvalButtonId("deny", code)], "the buttons carry the ask's own code, which the text also shows");
    w.relay.receive([{ id: "wamid.tap-1", from: w.owner, text: "Approve", timestamp: w.clock.now(), reply: { id: ids[0] } }]);
    await w.relay.idle();
    await w.runtime.idle();
    assert.equal(w.payments.refunds().length, 1, "the tap approved the held refund");
    w.relay.receive([{ id: "wamid.tap-2", from: w.owner, text: "Approve", timestamp: w.clock.now(), reply: { id: ids[0] } }]);
    await w.relay.idle();
    await w.runtime.idle();
    assert.equal(w.payments.refunds().length, 1, "a code is used once");
    assert.equal(w.relay.status().decided.approve, 1);
  } finally { await w.close(); }
});

test("a tap with a code the relay never issued is a wrong guess, like the typed one, and a tap from another number is nothing", async () => {
  const w = await startApprovalsWorld();
  try {
    await w.heldRefund();
    await w.relay.poll();
    w.relay.receive([{ id: "wamid.tap-x", from: w.owner, text: "Approve", timestamp: w.clock.now(), reply: { id: approvalButtonId("approve", "ZZZZZZ") } }]);
    w.relay.receive([{ id: "wamid.tap-y", from: "+919811111111", text: "Approve", timestamp: w.clock.now(), reply: { id: approvalButtonId("approve", codeIn(w.toOwner().at(-1)!.text)) } }]);
    await w.relay.idle();
    assert.equal(w.relay.status().wrongGuessesLastHour, 1);
    assert.equal(w.relay.status().ignored.notFromOwner, 1);
    assert.equal(w.payments.refunds().length, 0);
  } finally { await w.close(); }
});
