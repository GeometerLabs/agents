// UPI, marked paid by the owner (B33), for a centre: a restart keeps the ledger (a live code, the marks and a refund owed), and the unfinished work is read from the
// record as the deployer exports it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { DEFAULT_OPTIONS, obligations } from "../../../../modules/unfinished/index.ts";
import { notTestedFor } from "../report/data.ts";
import { STRINGS } from "../report/strings.ts";

test("a go-live certificate of a UPI centre says that automatic payment checking does not apply, in the centre's words", () => {
  const ids = notTestedFor(settings);
  assert.ok(ids.includes("upi-not-automatic") && ids.includes("real-upi") && !ids.includes("real-razorpay") && !ids.includes("payments-outside-razorpay"));
  for (const language of ["en", "hi", "ml", "kn"] as const) assert.ok(STRINGS[language].notTested["upi-not-automatic"].length > 0);
  assert.match(STRINGS.en.notTested["upi-not-automatic"], /automatic payment checking/);
});

const settings = parseSettings(JSON.parse(readFileSync(new URL("../settings/bright-tuition-upi.example.json", import.meta.url), "utf8")));

test("a restart keeps a UPI centre's ledger: the live code, the marks and a refund owed come back byte for byte", async () => {
  const w = createWorld({ settings });
  await w.advance(61); // the first reminder: every student's request, and the owner told what to look for
  await w.ownerMarksReceived("Rohan Mehta", { amountInr: 500 });
  await w.ownerMarksReceived("Meera Nair", { amountInr: 1600 }); // ₹100 more than the fee: owed back
  const json = serializeStore(w.store);
  const back = parseStore(json);
  assert.deepEqual(back.upi, w.store.upi);
  assert.equal(serializeStore(back), json);
  assert.ok(back.upi!.requests.some((r) => r.code) && back.upi!.refunds.length === 1 && back.upi!.refunds[0].state === "owed");
  assert.equal(parseStore(serializeStore(createWorld().store)).upi, undefined, "a Razorpay centre's snapshot has no ledger, as before");
});

test("the unfinished work, from the exported record: the rest the parent says they paid, not yet confirmed, and a refund owed", async () => {
  const w = createWorld({ settings });
  await w.advance(61);
  await w.ownerMarksReceived("Rohan Mehta", { amountInr: 500 });
  // the rest has a request of its own; it is the parent's to pay (the reminders go on), and the owner's to look at once the parent says it is paid
  await w.say("I already paid the fee");
  await w.ownerMarksReceived("Meera Nair", { amountInr: 1600 });
  w.clock.advanceMinutes(15);
  const exported = JSON.parse(JSON.stringify(w.record.entries().map((e) => ({ ...e, conversation: "c-aaaaaaaaaaaa" }))));
  const found = obligations.detect({ template: "fees", entries: exported, cases: JSON.parse(JSON.stringify([...w.store.dues.values()])), nowMs: w.clock.now(), options: DEFAULT_OPTIONS }).found.filter((o) => o.kind.startsWith("upi_"));
  assert.deepEqual(found.map((o) => [o.kind, o.facts.amountInr]).sort(), [["upi_payment_unconfirmed", 1300], ["upi_refund_owed", 100]]);
});
