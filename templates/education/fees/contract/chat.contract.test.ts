// The chat on the centre's page (W1): PUBLIC questions only. A guest is nobody the centre knows, so no fee, payment or student is read or shown; "talk to the owner" tells the owner
// once an hour and says so; anything else gets the one fixed line of what this chat is for, with the owner's button (no assistant here). The thread is read back by the guest's
// own handle hash, and a guest's sends are rate limited. Expected values from test/chat and chat-parent.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { contract, lines, makeCentre, sends } from "./harness.ts";
import type { Centre } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

describe("the centre's public chat", () => {
  contract("a guest's question gets the chat's fixed line with the owner's button, and reads no fee; 'talk to the owner' tells the owner; the thread is the guest's own", async () => {
    const c = await makeCentre({ tickSeconds: 3600 }); centres.push(c);
    await c.start();
    const g = c.guest();
    assert.equal((await c.chat(g.hash, "what are your fees for class 10")).status, 200);
    const said = sends(c).filter((l) => l.refs.to === "customer");
    assert.equal(said.at(-1)!.refs.templates, "fee_chat_public");
    assert.ok(lines(c, "receive_message").some((l) => l.refs.channel === "chat"));
    const thread = await c.call(`/internal/channel/chat?handle=${g.hash}`);
    assert.equal(thread.status, 200);
    const words = JSON.stringify(thread.body);
    assert.match(words, /what are your fees for class 10/u);
    assert.ok(!words.includes("Rohan") && !words.includes("+9198"), "no student and no number in a public thread");
    await c.chat(g.hash, "I want to talk to the owner");
    assert.ok(sends(c).some((l) => l.refs.to === "owner" && l.refs.templates === "owner_wants_to_talk"));
    assert.equal(sends(c).filter((l) => l.refs.to === "customer").at(-1)!.refs.templates, "fee_told_owner");
    const other = c.guest();
    const empty = await c.call(`/internal/channel/chat?handle=${other.hash}`);
    assert.equal(empty.status, 200);
    assert.ok(!JSON.stringify(empty.body).includes("class 10"), "another guest sees nothing of this thread");
  });
});
