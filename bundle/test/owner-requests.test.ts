// The pilot's daily check for owner requests (re-review ops condition of "no Operator holds a shop hostage"): `geometer owner requests` and the deployer's status/owner-requests.json
// list every shop with an Operator's removal request or a changed owner number waiting for its 48 hours, read from the shops' exported records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../geometer.ts";
import { OWNER_REQUESTS_FILE, pendingFromRecord, writeOwnerRequests } from "../lib/owner-requests.ts";
import { tempServer } from "./helpers.ts";

const line = (time: string, what: string, refs: Record<string, string> = {}) => ({ time, action: "owner_session", outcome: "confirmed", refs: { what, ...refs } });

test("a request is open from its first sight until the owner cancels, it applies, or Geometer resets; a restart's extension moves its time", () => {
  const asked = line("2026-11-19T10:00:00Z", "removal_asked", { by: "Divya", effectiveAt: "2026-11-21T10:00:00Z" });
  assert.deepEqual(pendingFromRecord("glow", [asked]), [{ shop: "glow", kind: "removal", askedBy: "Divya", firstSeen: "2026-11-19T10:00:00Z", appliesAt: "2026-11-21T10:00:00Z" }]);
  assert.equal(pendingFromRecord("glow", [asked, line("2026-11-19T12:00:00Z", "removal_cancelled")]).length, 0);
  assert.equal(pendingFromRecord("glow", [asked, line("2026-11-21T10:00:01Z", "removal_applied")]).length, 0);
  assert.equal(pendingFromRecord("glow", [asked, line("2026-11-20T00:00:00Z", "owner_reset")]).length, 0);
  assert.equal(pendingFromRecord("glow", [asked, line("2026-11-20T09:00:00Z", "removal_extended", { effectiveAt: "2026-11-21T09:00:00Z" })])[0].appliesAt, "2026-11-21T09:00:00Z");
  const both = pendingFromRecord("glow", [asked, line("2026-11-19T11:00:00Z", "owner_change_asked", { effectiveAt: "2026-11-21T11:00:00Z" })]);
  assert.deepEqual(both.map((r) => r.kind), ["removal", "owner_change"]);
  assert.deepEqual(pendingFromRecord("glow", [{ time: "t", action: "something_else" }]), []);
});

test("`geometer owner requests` lists them, and the deployer's file is written when the list changes and not otherwise", async () => {
  const t = tempServer();
  try {
    const out: string[] = []; const log = console.log;
    const run = async (...args: string[]) => { out.length = 0; console.log = (...a: unknown[]) => out.push(a.join(" ")); try { await main([...args, "--server", t.root]); } finally { console.log = log; } return out.join("\n"); };
    assert.match(await run("owner", "requests"), /No owner request is waiting/u);
    mkdirSync(join(t.root, "exports", "glow-salon"), { recursive: true });
    writeFileSync(join(t.root, "exports", "glow-salon", "record.json"), JSON.stringify([line("2026-11-19T10:00:00Z", "removal_asked", { by: "Divya", effectiveAt: "2026-11-21T10:00:00Z" })]));
    const said = await run("owner", "requests");
    assert.match(said, /glow-salon: removal of every phone; asked by Divya; first seen 2026-11-19T10:00:00Z; applies 2026-11-21T10:00:00Z\. Phone the owner\./u);
    const now = new Date("2026-11-19T10:05:00Z");
    assert.equal(writeOwnerRequests(t.root, ["glow-salon"], now).length, 1);
    const file = join(t.root, "status", OWNER_REQUESTS_FILE);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).requests[0].shop, "glow-salon");
    assert.deepEqual(writeOwnerRequests(t.root, ["glow-salon"], new Date("2026-11-19T10:10:00Z")), [], "unchanged: not written again");
    writeFileSync(join(t.root, "exports", "glow-salon", "record.json"), JSON.stringify([line("2026-11-19T10:00:00Z", "removal_asked", { by: "Divya", effectiveAt: "x" }), line("2026-11-19T11:00:00Z", "removal_cancelled")]));
    assert.equal(writeOwnerRequests(t.root, ["glow-salon"], new Date("2026-11-19T11:05:00Z"))[0], "No owner request is waiting any more.");
  } finally { t.done(); }
});
