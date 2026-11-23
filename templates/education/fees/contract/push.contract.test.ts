// THE PARENTS' WEB PUSH (24 Nov 2026; the TypeScript runtime's release-flow batch 3: push.ts alsoPushTo in server/runtime.ts, tested by test/parent-push.test.ts, deleted with the
// runtime on 24 Nov). A parent who allowed alerts on their private page also hears the centre's messages to their number as web push: the push goes to the parent's
// conversation (their stable ref, never the link, which is made again), says the message's words with every address taken out (a reminder carries the parent's private link
// and a payment link; no address travels in a push), and the WhatsApp message itself still carries its links. Ported from parent-push.test.ts: a family with two children gets
// one reminder that lists both, so one push. Also: one parent's alerts are not another's; STOP ends every message to that parent and so every push; and the subscription is kept under the parent's
// stable ref, field for field as the TypeScript kept it. Every push goes through the centre's push Guard (the fake Guard of modules/test/contract/push-harness.ts, which keeps what it is sent), encrypted for that phone.
// A UPI centre in fakes mode on the test clock (Mon 2 Nov 2026, as month.contract.test.ts), its stand-in WhatsApp kept (runtime.json `services.messaging` named) and push turned
// on as the deployer does (enablePush). What the stand-in WhatsApp "sent" is read from the centre's own output, where it says each message.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fitNotification } from "../../../../modules/push/sender.ts";
import { enablePush, softBrowser, startFakeGuard } from "../../../../modules/test/contract/push-harness.ts";
import type { FakeGuard } from "../../../../modules/test/contract/push-harness.ts";
import { KIRAN, MEERA, PAGE, ROHAN, SHARMA, at, contract, lines, makeCentre, parentLinkHash, sends, sleep } from "./harness.ts";
import type { Centre } from "./harness.ts";

const centres: Centre[] = [];
const guards: FakeGuard[] = [];
after(async () => {
  for (const c of centres) await c.cleanup();
  for (const g of guards) await g.close();
});

const reminderIds = (c: Centre, phone: string): string[] =>
  sends(c, phone).filter((l) => l.refs.to === "customer" && l.outcome === "confirmed").map((l) => l.refs.templates).filter((t) => /^fee_(reminder|overdue)/u.test(t));

/** Push on, the stand-in WhatsApp kept; on the test clock at Mon 2 Nov 10:00, once the five fees are open and the four parents reminded (month.contract.test.ts's november). */
async function november(): Promise<{ c: Centre; guard: FakeGuard }> {
  const guard = await startFakeGuard(); guards.push(guard);
  const c = await makeCentre({ runtime: { services: { messaging: {} } } });
  centres.push(c);
  enablePush(c, guard);
  await c.start();
  await c.started();
  c.goto(at(2, 10, 0) + 1000);
  await c.waitFor(() => lines(c, "open_fee").length === 5 && [SHARMA, MEERA, KIRAN, ROHAN].every((p) => reminderIds(c, p).length === 1), "five fees opened and four parents reminded");
  return { c, guard };
}

/** Every message the stand-in WhatsApp says it sent to `to`, oldest first (go/internal/messaging fake.go: "[stand-in WhatsApp] to <to>: <text>", the text running to the next line it says). */
function whatsapp(c: Centre, to: string): string[] {
  const out: string[] = [];
  for (const part of c.log().split("[stand-in WhatsApp] to ").slice(1)) {
    if (part.startsWith(`${to}: `)) out.push(part.slice(to.length + 2).replace(/\n$/u, ""));
  }
  return out;
}

/** The parent's private link's hash, from the newest message to them that carries it. */
function linkHash(c: Centre, to: string): string {
  const re = new RegExp(`${PAGE.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")}/f/([A-Za-z0-9_-]{32})`, "u");
  for (const t of whatsapp(c, to).reverse()) { const m = re.exec(t); if (m) return parentLinkHash(m[1]); }
  throw new Error(`no private link was sent to ${to}:\n${c.log()}`);
}

/** The words the TypeScript pushed for a message (server/runtime.ts withoutAddresses, at 6a51bf7a), fitted as every notification. */
const pushedWords = (text: string): string => fitNotification(text.replace(/\bhttps?:\/\/\S+/giu, "").replace(/[ \t]+/gu, " ").replace(/\n[ \t]*\n+/gu, "\n").trim());

async function heard(c: Centre, guard: FakeGuard, n: number): Promise<void> {
  for (let i = 0; i < 200 && guard.calls.length < n; i++) await sleep(50);
  await sleep(400);
  assert.equal(guard.calls.length, n, `${n} push(es) to the Guard:\n${c.log()}`);
}

const push = (c: Centre, body: Record<string, unknown>) => c.call("/internal/channel/push", { body });

describe("a parent who allowed alerts on their private page", () => {
  contract("a reminder is pushed to the parent's page conversation without its links, one for a family with two children; the WhatsApp message keeps them", async () => {
    const { c, guard } = await november();
    const sharma = linkHash(c, SHARMA);
    const b = softBrowser();
    assert.deepEqual((await push(c, { op: "customer_subscribe", handle: sharma, subscription: b.subscription })).body, { on: true, phones: 1 });
    // kept under the parent's stable ref, never the link (the TypeScript's push.sqlite row, field for field)
    const ref = (await c.parent(sharma)).body.ref as string;
    const db = new DatabaseSync(join(c.dataDir, "push.sqlite"), { readOnly: true });
    try { assert.deepEqual(db.prepare("SELECT who, signer, ref FROM subs WHERE dead_at IS NULL").all().map((r) => ({ ...r })), [{ who: `parent:${ref}`, signer: "own", ref: null }]); } finally { db.close(); }
    assert.deepEqual((await push(c, { op: "customer_state", handle: linkHash(c, ROHAN) })).body, { on: true, phones: 0 }, "one parent's alerts are not another's");
    const before = whatsapp(c, SHARMA).length;
    c.goto(at(5, 10, 0) + 1000); // the due day
    await c.waitFor(() => reminderIds(c, SHARMA).length === 2 && reminderIds(c, ROHAN).length === 2, "the due day's reminders");
    await heard(c, guard, 1);
    const sent = whatsapp(c, SHARMA).slice(before);
    assert.equal(sent.length, 1, "the Sharmas have two children: one reminder that lists both");
    assert.match(sent[0], /https:\/\/pages\.example\/bright\/f\//u, "the message on WhatsApp still carries the parent's private link");
    const said = b.open(guard.calls[0].call);
    assert.equal(guard.calls[0].path, "/v1/push/customer");
    assert.doesNotMatch(said.body, /https?:\/\//u, "no address travels in a push");
    assert.deepEqual(said, { title: c.settings.name, body: pushedWords(sent[0]), tag: "update" });
  });

  contract("STOP ends every message to that parent, and with them the pushes", async () => {
    const { c, guard } = await november();
    const b = softBrowser();
    assert.equal((await push(c, { op: "customer_subscribe", handle: linkHash(c, ROHAN), subscription: b.subscription })).status, 200);
    await c.inbound(ROHAN, "STOP");
    assert.equal(lines(c, "opt_out", "confirmed").length, 1);
    await sleep(1000);
    const pushed = guard.calls.length;
    c.goto(at(5, 10, 0) + 1000);
    await c.waitFor(() => reminderIds(c, MEERA).length === 2, "Meera's due-day reminder");
    await sleep(1500);
    assert.equal(reminderIds(c, ROHAN).length, 1, "nothing more went to the parent who said STOP");
    assert.equal(guard.calls.length, pushed, "and nothing more was pushed to them");
  });
});
