// "Limits, tightened by a tap" through the real runtime core (modules/runtime/core.ts with the limits kit), on a temp directory and the in-memory fakes: the owner's page
// event makes a Pending change that the agent's settings obey at once, the deployer's word settles it (Active, or failed and the previous limit is back), a redelivery is
// one, and the state is on disk. The core hands these events to the kit, not to the agent, so no assistant block is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKit } from "./runtime-kit.ts";

test("owner_limit then limit_settled, through the core: Pending is obeyed at once, failed puts the previous limit back, Active keeps the new one", async () => {
  const kit = createKit();
  try {
    const { runtime } = kit.open();
    const view = () => runtime.limits!.view();
    assert.deepEqual(view().limits.map((l) => [l.id, l.inForce, l.file]), [["refund_limit", 200, 200]]);

    runtime.submit([{ kind: "owner_limit", id: "o-1", limit: "refund_limit", to: 100 }]);
    runtime.kick(); await runtime.idle();
    assert.deepEqual(view().changes.map((c) => [c.id, c.state, c.direction, c.by, c.from, c.to]), [["l-1", "pending", "tighten", "owner_app", 200, 100]]);
    assert.equal(kit.settings.cancellation.refundLimitInr, 100, "the agent's own checks use the tighter value at once");
    assert.equal(view().limits[0].file, 200, "the file's own value is still what the runtime started with");

    // the deployer could not finish it: the previous limit is back, in the same step
    runtime.submit([{ kind: "limit_settled", id: "r-1", change: "l-1", result: "failed", why: "the deploy did not go through" }]);
    runtime.kick(); await runtime.idle();
    assert.equal(view().changes[0].state, "failed");
    assert.equal(kit.settings.cancellation.refundLimitInr, 200);

    // a second try, this time settled Active; a redelivery of the same word is one
    runtime.submit([{ kind: "owner_limit", id: "o-2", limit: "refund_limit", to: 150 }]);
    runtime.kick(); await runtime.idle();
    runtime.submit([{ kind: "limit_settled", id: "r-2", change: "l-2", result: "active" }, { kind: "limit_settled", id: "r-2", change: "l-2", result: "active" }]);
    runtime.kick(); await runtime.idle();
    assert.deepEqual(view().changes.map((c) => [c.id, c.state]), [["l-1", "failed"], ["l-2", "active"]]);
    assert.equal(kit.settings.cancellation.refundLimitInr, 150);
  } finally { kit.cleanup(); }
});

test("a loosening past the template's bound and a limit that is not declared change nothing, and the record says so", async () => {
  const kit = createKit();
  try {
    const { runtime, db } = kit.open();
    runtime.submit([{ kind: "owner_limit", id: "o-1", limit: "refund_limit", to: 900 }, { kind: "owner_limit", id: "o-2", limit: "deposit", to: 1 }]);
    runtime.kick(); await runtime.idle();
    assert.deepEqual(runtime.limits!.view().changes, []);
    assert.equal(kit.settings.cancellation.refundLimitInr, 200);
    const record = db.loadState().record.filter((e) => e.action === "limit_change");
    assert.deepEqual(record.map((e) => e.outcome), ["blocked"], "the one for an undeclared limit is dropped without a line; the bound one is recorded");
  } finally { kit.cleanup(); }
});
