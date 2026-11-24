// A case asked about from another number, in a shop of several parts (decision 65 with refund-paths, 25 Nov 2026; Go internal/parts agent.go caseAskedPart, runtime
// CaseHolder). Whether a conversation "holds a case" is the shop's question, over ALL its parts: a number that holds no case in any part and names a case one part's record
// holds gets that part's one line (nothing of the case shown), and the owner that part's notice, at most once an hour per asker and case; a number that holds a case in any
// part is answered as before. On the starter shop (the credit book, Stock orders and the pickup hold), over HTTP and the shop's own files, on its Go program.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPartsWorld } from "../crash-test/go-world.ts";
import type { PartsFile, PartsWorld } from "../crash-test/go-world.ts";
import { goProgramsDir } from "../../../../modules/crash-test/programs.ts";
import { closeOpened } from "../../../../modules/crash-test/situations.ts";

if (process.env.PARTS_GO_BIN) process.env.GEOMETER_GO_PROGRAMS = join(process.env.PARTS_GO_BIN, "..");
const SKIP = existsSync(join(goProgramsDir(), "parts")) ? undefined : "the Go program parts is not built (cd go && go build -o bin/ ./cmd/parts, or set PARTS_GO_BIN)";
const starter = JSON.parse(readFileSync(new URL("../settings/ganesh-electricals-starter.example.json", import.meta.url), "utf8")) as PartsFile;
type Obj = Record<string, any>;

// each test's world (its shop program and stand-ins) is closed when the test ends, so the file ends by itself (go-world.ts registers every world it opens)
afterEach(async () => { await closeOpened(); });

const STRANGER = "+919877766655"; // a number the starter shop does not name
const fees = starter.parts.fees as Obj;
const person = fees.creditBook.people[0] as { name: string; phone: string };
const hold = starter.parts.orders as Obj;
const supplier = ((starter.parts["stock-orders"] as Obj).suppliers as Obj[]).find((s) => s.approved)!;
const evening = `1 ${hold.menu[0].names.en[0]} today ${hold.pickup.slots.at(-1).names.en[0]}`;

const asks = (w: PartsWorld): any[] => w.record.entries().filter((e) => e.action === "case_asked_elsewhere");
const ownerSends = (w: PartsWorld, who: string): string[] =>
  w.record.entries().filter((e) => e.action === "send_message" && e.outcome === "confirmed" && e.conversation === who && e.refs?.to === "owner").flatMap((e) => String(e.refs?.templates ?? "").split("+"));
/** The credit book's entry for its first person, after the owner's "<name> owes 500" (a credit account's entries are fees: f-<n>). */
async function creditEntry(w: PartsWorld): Promise<string> {
  await w.tick(); // the shop's first beat: the credit book opens the people its settings name
  await w.ownerSays(`${person.name} owes 500`);
  const ids = JSON.stringify(w.partState("fees") ?? {}).match(/"(f-\d+(?:\.\d+)?)"/u);
  assert.ok(ids, `the credit book holds an entry: ${JSON.stringify(w.partState("fees"))}`);
  return ids[1];
}

test("a stranger names the credit book's entry: the credit book's one line, the owner told once by it, though the hold takes new customers", SKIP ? { skip: SKIP } : {}, async () => {
  const w = await createPartsWorld(starter);
  const ref = await creditEntry(w);
  const ask = `What about ${ref.toUpperCase().replace("-", "")}? I am his brother`;
  await w.say(ask, { from: STRANGER });
  assert.equal(asks(w).length, 1, JSON.stringify(w.record.entries().map((e) => `${e.refs?.part}:${e.action}:${e.outcome}`)));
  assert.equal(asks(w)[0].refs?.part, "fees", "the credit book's record line");
  assert.equal(asks(w)[0].refs?.case, ref);
  assert.equal(w.linesOf("orders").filter((e) => e.conversation === STRANGER).length, 0, "the hold did not read it as new business");
  const said = w.textsTo(STRANGER);
  assert.equal(said.length, 1, "one line to the stranger");
  assert.ok(!/₹|500/u.test(said[0]) && !said[0].includes(ref) && !said[0].replace(/\D/gu, "").includes(person.phone.slice(-10)), `nothing of the entry shown: ${said[0]}`);
  assert.deepEqual(ownerSends(w, STRANGER), ["owner_credit_case_other_number"], "the credit book's notice to the owner");
  await w.say(ask, { from: STRANGER });
  assert.equal(w.textsTo(STRANGER).length, 2, "the same line again");
  assert.equal(ownerSends(w, STRANGER).length, 1, "the owner not told again within the hour");
  assert.equal(asks(w).at(-1).outcome, "blocked");
});

test("a stranger names the hold's order: the hold's one line and notice; a false reference writes no ask", SKIP ? { skip: SKIP } : {}, async () => {
  const w = await createPartsWorld(starter);
  await w.say(evening, { from: "+919833333333" });
  await w.say("Where is O1? My mother asked for it", { from: STRANGER });
  assert.equal(asks(w).length, 1, JSON.stringify(w.record.entries().map((e) => `${e.refs?.part}:${e.action}:${e.outcome}`)));
  assert.equal(asks(w)[0].refs?.part, "orders");
  assert.equal(asks(w)[0].refs?.case, "o-1");
  assert.deepEqual(ownerSends(w, STRANGER), ["owner_case_other_number"]);
  await w.say("Where is O9?", { from: STRANGER });
  assert.equal(asks(w).length, 1, "o-9 is not the shop's: no ask");
});

test("a number that holds a case in one part, naming another part's case, is answered as before: no ask, no notice", SKIP ? { skip: SKIP } : {}, async () => {
  const w = await createPartsWorld(starter);
  const ref = await creditEntry(w);
  await w.say(evening, { from: "+919833333333" }); // o-1, someone else's hold
  // the person in the credit book (their account is a case) names the hold's o-1; a customer with a hold names the credit book's entry; the supplier names o-1
  await w.say("Where is O1?", { from: person.phone });
  await w.say(`What about ${ref.toUpperCase().replace("-", "")}?`, { from: "+919833333333" });
  await w.say("Where is O1?", { from: supplier.whatsapp });
  assert.deepEqual(asks(w), [], JSON.stringify(asks(w)));
  for (const who of [person.phone, "+919833333333", supplier.whatsapp]) assert.deepEqual(ownerSends(w, who).filter((t) => /case_other_number/u.test(t)), [], `no case notice about ${who}`);
});
