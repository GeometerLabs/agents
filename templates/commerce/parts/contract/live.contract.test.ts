// A LIVE shop takes parts and lets one go (decision 65), over HTTP and its own files: the pickup-hold shop runs on its template's program (go/cmd/orders) with a hold held; the
// panel's rule (bundle/panel/parts.ts addPart) adds the credit book and Stock orders, and the shop moves onto go/cmd/parts on the same folder and data: the hold is still
// there and is collected, its record lines from before are still the record's (no part), the new parts answer their own words, and the saved state is now under `parts`.
// Then Stock orders, with nothing of it open, is taken out (removePart): the shop runs on, Stock orders' record lines stay in the record and its saved state stays in the store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createGoWorld, VERSION as ORDERS_VERSION } from "../../orders/crash-test/go-world.ts";
import { parseSettings } from "../../orders/src/settings.ts";
import { goProgram, goProgramsDir } from "../../../../modules/crash-test/programs.ts";
import { closeOpened } from "../../../../modules/crash-test/situations.ts";
import { addPart, openCasesOf, removePart } from "../../../../bundle/panel/parts.ts";
import { PARTS_VERSION } from "./via-parts.ts";

if (process.env.PARTS_GO_BIN) process.env.GEOMETER_GO_PROGRAMS = join(process.env.PARTS_GO_BIN, "..");
const SKIP = ["parts", "orders"].every((p) => existsSync(join(goProgramsDir(), p))) ? undefined : "the Go programs parts and orders are not built (cd go && go build -o bin/ ./cmd/...)";
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<string, any>;
const hold = read("../../orders/settings/ganesh-electricals-hold.example.json");
const starter = read("../settings/ganesh-electricals-starter.example.json");

test("a live hold shop takes the credit book and Stock orders, moves onto the parts program with its hold, then lets Stock orders go", SKIP ? { skip: SKIP } : {}, async () => {
  const w = await createGoWorld({ settings: parseSettings(hold) });
  try {
    await w.say("1 MCB 16A today evening");
    await w.ownerSays("approve o-1");
    const before = w.record.entries().length;
    assert.ok(w.record.entries().some((e) => e.action === "pickup_hold" && e.refs?.step === "held"), "the hold is held on the Orders program");
    assert.ok(w.record.entries().every((e) => e.refs?.part === undefined), "a single-template shop's lines carry no part");

    // the panel adds two parts: the hold first and carried, the pin the parts template's
    const credit = { ...starter.parts.fees, creditBook: { ...starter.parts.fees.creditBook, people: [] } };
    const one = addPart({ settings: hold, lock: `orders@${ORDERS_VERSION}`, part: "fees", block: credit });
    assert.ok(one.ok, JSON.stringify(one));
    const two = addPart({ settings: one.settings, lock: one.lock, part: "stock-orders", block: starter.parts["stock-orders"] });
    assert.ok(two.ok, JSON.stringify(two));
    assert.equal(two.lock, `parts@${PARTS_VERSION}`);
    const program = goProgram("parts");
    assert.ok(program.ok);
    await w.shop.restartAs({ program: program.path, pathway: "parts", version: PARTS_VERSION, settings: two.settings });

    // the hold is still the shop's, and collected through the router
    await w.ownerSays("collected o-1");
    const lines = w.shop.record();
    assert.equal(lines.slice(0, before).filter((e) => e.refs?.part !== undefined).length, 0, "the record's lines from before are as they were");
    assert.ok(lines.some((e) => e.action === "pickup_hold" && e.refs?.step === "collected" && e.refs?.part === "orders"), "the hold was collected by the Orders part");
    await w.ownerSays("Ramesh owes 300");
    assert.ok(w.shop.record().some((e) => e.action === "owner_need_number" || (e.refs?.part === "fees")), "the credit book answered its own words");
    const saved = JSON.parse(w.shop.snapshot() ?? "{}") as Record<string, any>;
    assert.ok(saved.parts?.orders?.orders !== undefined && saved.orders === undefined, "the hold's state moved under parts.orders");

    // a Stock orders card the owner says no to: nothing of it stays open
    await w.ownerSays("order 10 box LED bulb 9W from Ravi");
    const code = /\byes ([A-Z0-9]{4,6})\b/u.exec(w.textsTo(w.owner).reverse().join("\n"))?.[1];
    assert.ok(code, "the owner was sent the reorder's card");
    await w.ownerSays(`no ${code}`);
    // the card said no; the order it would have sent waits to be cancelled, and while it is open the part cannot be taken out
    const waiting = removePart({ settings: two.settings, lock: two.lock, part: "stock-orders", openCases: openCasesOf((await w.shop.status()).cases, "stock-orders") });
    assert.ok(!waiting.ok && /open case/u.test(waiting.errors[0]), JSON.stringify(waiting));
    await w.ownerSays("cancel po-1");
    const status = await w.shop.status();
    const out = removePart({ settings: two.settings, lock: two.lock, part: "stock-orders", openCases: openCasesOf(status.cases, "stock-orders") });
    assert.ok(out.ok, JSON.stringify({ out, cases: status.cases }));
    const stockLines = w.shop.record().filter((e) => e.refs?.part === "stock-orders").length;
    assert.ok(stockLines > 0, "Stock orders wrote its lines");
    await w.shop.restartAs({ program: program.path, pathway: "parts", version: PARTS_VERSION, settings: out.settings });
    await w.ownerSays("collected o-1"); // read again by the Orders part, which already has it collected
    assert.equal(w.shop.record().filter((e) => e.refs?.part === "stock-orders").length, stockLines, "the removed part's lines stay in the record");
    const after = JSON.parse(w.shop.snapshot() ?? "{}") as Record<string, any>;
    assert.ok(after.parts?.["stock-orders"] !== undefined, "the removed part's saved state stays in the store");
  } finally {
    await closeOpened();
  }
});
