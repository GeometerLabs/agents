// The panel and the owner's own asks (block S): the Operator's page shows that the owner asked for their file and for another Operator, with where each stands; the owner needs no
// Operator for either; the Operator cannot stop the file; the move still ends only with the owner's own code; and the stranded rule: an ask for another Operator that waited more than
// 14 days with no handover started shows the shop to Geometer's admin (a builder account), and a customer of the server's other Operators does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLeave } from "../leave.ts";
import { FILE_ASKED, FILE_TAKEN, OPERATOR_ASKED } from "../../../modules/approvals/leave.ts";
import { writeAtomic } from "../../lib/util.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-18T10:00:00Z");

/** The panel's own pieces, as small stand-ins: a shop's exported record, an assignment, and a handover that says what it is told. */
function world(shopsIn: Record<string, { entries: unknown[]; moves?: { at: string }[]; served?: string; handover?: "none" | "waiting" | "expired"; since?: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "panel-leave-"));
  for (const [id, s] of Object.entries(shopsIn)) { mkdirSync(join(dir, "exports", id), { recursive: true }); writeFileSync(join(dir, "exports", id, "record.json"), JSON.stringify(s.entries)); writeFileSync(join(dir, "exports", id, "bookings.json"), "[]"); }
  const shops = {
    paths: { exports: (id: string) => join(dir, "exports", id) },
    ids: () => Object.keys(shopsIn),
    assignment: (id: string) => (shopsIn[id].moves ? { history: shopsIn[id].moves } : undefined),
    settings: (id: string) => ({ name: `Shop ${id}` }),
    servedBy: (id: string) => ({ accountName: shopsIn[id].served ?? "Divya" }),
  };
  const handover = { check: (id: string) => { const h = shopsIn[id].handover ?? "none"; return h === "none" ? { state: "none" } : { state: h, move: { requestedAt: shopsIn[id].since ?? new Date(T0).toISOString() } }; } };
  return { dir, leave: createLeave(dir, shops as never, handover as never, () => T0), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const ask = (action: string, ageDays: number, id = "ask_0123456789ab") => ({ seq: 1, time: new Date(T0 - ageDays * DAY).toISOString(), conversation: "c-aaaaaaaaaaaa", booking: null, action, inputsDigest: "0123456789abcdef", outcome: "confirmed", decisions: [], language: "en", notes: "", refs: { ask: id, via: "page" } });

test("the Operator's page sees that the owner asked for their file, and where it stands", () => {
  const w = world({ glow: { entries: [ask(FILE_ASKED, 0.1)] } });
  try {
    assert.deepEqual(w.leave.view("glow")?.file, { askedAt: new Date(T0 - 0.1 * DAY).toISOString(), state: "asked" });
    writeAtomic(join(w.dir, "status", "leave", "glow.json"), JSON.stringify({ schema: 1, file: { ask: "ask_0123456789ab", state: "ready", askedAt: "x", madeAt: "x", expiresAt: "2026-11-21T10:00:00Z" } }));
    assert.equal(w.leave.view("glow")?.file?.state, "ready");
    assert.equal(w.leave.view("glow")?.file?.until, "2026-11-21T10:00:00Z");
  } finally { w.done(); }
});

test("once the owner took the file the panel says so; an ask nobody made shows nothing", () => {
  const w = world({ glow: { entries: [ask(FILE_ASKED, 1), ask(FILE_TAKEN, 0.5)] }, quiet: { entries: [] } });
  try {
    assert.equal(w.leave.view("glow")?.file?.state, "taken");
    assert.equal(w.leave.view("quiet"), undefined);
  } finally { w.done(); }
});

test("the owner's ask for another Operator is shown at once, with the days left before Geometer is shown the shop", () => {
  const w = world({ glow: { entries: [ask(OPERATOR_ASKED, 2)] } });
  try {
    const op = w.leave.view("glow")!.operator!;
    assert.equal(op.stranded, false);
    assert.equal(op.daysLeft, 12);
    assert.equal(op.handover, "none");
  } finally { w.done(); }
});

test("a move that finished after the ask closes it; an older move does not", () => {
  const closed = world({ glow: { entries: [ask(OPERATOR_ASKED, 20)], moves: [{ at: new Date(T0 - 5 * DAY).toISOString() }] } });
  const open = world({ glow: { entries: [ask(OPERATOR_ASKED, 20)], moves: [{ at: new Date(T0 - 40 * DAY).toISOString() }] } });
  try {
    assert.equal(closed.leave.view("glow")?.operator, undefined);
    assert.equal(open.leave.view("glow")?.operator?.stranded, true);
  } finally { closed.done(); open.done(); }
});

test("the stranded list: an ask older than 14 days with no handover started; a handover waiting for the owner's code keeps the shop off it", () => {
  const w = world({
    old: { entries: [ask(OPERATOR_ASKED, 15)], served: "Divya" },
    fresh: { entries: [ask(OPERATOR_ASKED, 13)] },
    started: { entries: [ask(OPERATOR_ASKED, 20)], handover: "waiting", since: new Date(T0 - 18 * DAY).toISOString() },
    onlyFile: { entries: [ask(FILE_ASKED, 30)] },
  });
  try {
    assert.deepEqual(w.leave.stranded().map((s) => [s.shop, s.operator]), [["old", "Divya"]]);
    assert.equal(w.leave.view("started")?.operator?.handover, "waiting");
  } finally { w.done(); }
});
