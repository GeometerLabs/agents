// `words-fresh`: the owner's words the Go runtime says are packed files (go/internal/assistant/words/*.json.gz) made by go/scripts/gen_words.ts from the TypeScript words. This fails
// when a committed file is stale (someone changed a word in modules/assistant/words*.ts or modules/listings/words.ts and did not run `node go/scripts/gen_words.ts`). It compares the
// UNPACKED text, not the gzip bytes (those may differ between zlib versions), and it needs no Go and no running shop.
// The TypeScript's built patterns the Go runtime matches with (go/internal/language/patterns.json, and the vectors its matcher is tested on), made by
// go/scripts/gen_patterns.ts, are checked the same way: run  node go/scripts/gen_patterns.ts  after a change to one of the patterns it names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { OUT, generate, staleFiles } from "../../../../go/scripts/gen_words.ts";
import * as patterns from "../../../../go/scripts/gen_patterns.ts";
import * as reportWords from "../../../../go/scripts/gen_report_words.ts";
import * as reportVectors from "../../../../go/scripts/gen_report_vectors.ts";
import * as booksWords from "../../../../go/scripts/gen_books_words.ts";
import * as booksVectors from "../../../../go/scripts/gen_books_vectors.ts";
import * as bookingsReportWords from "../../../../go/scripts/gen_bookings_report_words.ts";
import * as bookingsReportVectors from "../../../../go/scripts/gen_bookings_report_vectors.ts";
import * as voiceVectors from "../../../../go/scripts/gen_voice_vectors.ts";
import * as assistantVectors from "../../../../go/scripts/gen_assistant_vectors.ts";
import * as talkFactsVectors from "../../../../go/scripts/gen_talk_facts_vectors.ts";

test("words-fresh: the committed packed words equal a fresh render of the TypeScript words", () => {
  assert.deepEqual([...generate().keys()].sort(), ["en.json", "hi.json", "kn.json", "ml.json", "rules.json"]);
  assert.deepEqual(staleFiles(OUT), [], "a packed file is out of date: run  node go/scripts/gen_words.ts  and commit the result");
  // the Bookings assistant's words are in the same packs (wave 2, step 5): a pack without them is from before that generator change
  const en = JSON.parse(generate().get("en.json")!).m as Record<string, string>;
  assert.equal(en["closed.n"], "Closed {date}. Bookings that day: {n}. I've asked them to pick another day. Reply undo to open it again.");
});

test("words-fresh: the check is not vacuous: a copy with one word changed, or one file missing, is reported stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "words-fresh-"));
  try {
    cpSync(OUT, dir, { recursive: true });
    const en = gunzipSync(readFileSync(join(dir, "en.json.gz"))).toString("utf8");
    assert.ok(en.includes("Nothing needs you right now."));
    writeFileSync(join(dir, "en.json.gz"), gzipSync(Buffer.from(en.replace("Nothing needs you right now.", "Nothing needs you right now!"))));
    rmSync(join(dir, "kn.json.gz"));
    assert.deepEqual(staleFiles(dir).sort(), ["en.json", "kn.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the committed patterns and their vectors equal a fresh render of the TypeScript patterns", () => {
  assert.deepEqual([...patterns.generate().keys()].sort(), ["patterns.json", join("testdata", "pattern-vectors.json")]);
  assert.deepEqual(patterns.staleFiles(patterns.OUT), [], "a pattern file is out of date: run  node go/scripts/gen_patterns.ts  and commit the result");
  const dir = mkdtempSync(join(tmpdir(), "patterns-fresh-"));
  try {
    cpSync(patterns.OUT, dir, { recursive: true });
    const p = readFileSync(join(dir, "patterns.json"), "utf8");
    writeFileSync(join(dir, "patterns.json"), p.replace("tomorrow", "tomorrrow"));
    assert.deepEqual(patterns.staleFiles(dir), ["patterns.json"], "the check is not vacuous");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the report's words, style sheet, claim rules and Unicode tables (go/internal/report) equal a fresh render of the TypeScript", () => {
  assert.deepEqual([...reportWords.generate().keys()].sort(), ["report/graphemes_gen.go", "report/words/words.json.gz"]);
  assert.deepEqual(reportWords.staleFiles(reportWords.OUT), [], "a report words file is out of date: run  node go/scripts/gen_report_words.ts  and commit the result");
  const dir = mkdtempSync(join(tmpdir(), "report-words-fresh-"));
  try {
    cpSync(join(reportWords.OUT, "report"), join(dir, "report"), { recursive: true });
    const gz = join(dir, "report", "words", "words.json.gz");
    const text = gunzipSync(readFileSync(gz)).toString("utf8");
    assert.ok(text.includes("What this checks"));
    writeFileSync(gz, gzipSync(Buffer.from(text.replace("What this checks", "What this checked"))));
    assert.deepEqual(reportWords.staleFiles(dir), ["report/words/words.json.gz"], "the check is not vacuous");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the report's test vectors (canonical JSON, seals, summaries, pages, grapheme cuts) equal a fresh run of the TypeScript", () => {
  assert.deepEqual([...reportVectors.generate().keys()].sort(), ["report/testdata/graphemes.json", "report/testdata/vectors.json"]);
  assert.deepEqual(reportVectors.staleFiles(reportVectors.OUT), [], "the report vectors are out of date: run  node go/scripts/gen_report_vectors.ts  and commit the result");
});

test("words-fresh: the books' words, style sheets and the document page's CSS (go/internal/accounting) equal a fresh render of the TypeScript", () => {
  assert.deepEqual([...booksWords.generate().keys()].sort(), ["accounting/words/words.json.gz"]);
  assert.deepEqual(booksWords.staleFiles(booksWords.OUT), [], "the books' words file is out of date: run  node go/scripts/gen_books_words.ts  and commit the result");
  const dir = mkdtempSync(join(tmpdir(), "books-words-fresh-"));
  try {
    cpSync(join(booksWords.OUT, "accounting"), join(dir, "accounting"), { recursive: true });
    const gz = join(dir, "accounting", "words", "words.json.gz");
    const text = gunzipSync(readFileSync(gz)).toString("utf8");
    assert.ok(text.includes("Send to my accountant"));
    writeFileSync(gz, gzipSync(Buffer.from(text.replace("Send to my accountant", "Send to my accountants"))));
    assert.deepEqual(booksWords.staleFiles(dir), ["accounting/words/words.json.gz"], "the check is not vacuous");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the books' test vectors (numbers, journal, post, figures, summary, invariants, accountant's files, owner's money, pages, settlement job) equal a fresh run of the TypeScript", () => {
  const names = [...booksVectors.generate().keys()].sort();
  assert.ok(names.includes("accounting/testdata/numbers.json") && names.includes("accounting/testdata/world-bookings.json") && names.includes("accounting/testdata/pages-fyend.json"));
  assert.deepEqual(booksVectors.staleFiles(booksVectors.OUT), [], "the books' vectors are out of date: run  node go/scripts/gen_books_vectors.ts  and commit the result");
  const node = JSON.parse(readFileSync(join(booksVectors.OUT, "accounting/testdata/misc.json"), "utf8")).node as string;
  assert.match(node, /^v\d+\.\d+\.\d+/, "the vectors name the Node that made them");
});

test("words-fresh: the Bookings report's words, lists, constants and WhatsApp templates (go/internal/bookingsreport) equal a fresh render of the TypeScript", () => {
  assert.deepEqual([...bookingsReportWords.generate().keys()].sort(), ["bookingsreport/words/words.json.gz"]);
  assert.deepEqual(bookingsReportWords.staleFiles(bookingsReportWords.OUT), [], "the Bookings report's words file is out of date: run  node go/scripts/gen_bookings_report_words.ts  and commit the result");
  const dir = mkdtempSync(join(tmpdir(), "bookings-report-words-fresh-"));
  try {
    cpSync(join(bookingsReportWords.OUT, "bookingsreport"), join(dir, "bookingsreport"), { recursive: true });
    const gz = join(dir, "bookingsreport", "words", "words.json.gz");
    const text = gunzipSync(readFileSync(gz)).toString("utf8");
    assert.ok(text.includes("Monthly report"));
    writeFileSync(gz, gzipSync(Buffer.from(text.replace("Monthly report", "Monthly reports"))));
    assert.deepEqual(bookingsReportWords.staleFiles(dir), ["bookingsreport/words/words.json.gz"], "the check is not vacuous");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the Bookings report's test vectors (reports, pages, certificates, messages, summaries, ledger head, go-live readings, files, the job's wiring) equal a fresh run of the TypeScript", () => {
  assert.deepEqual([...bookingsReportVectors.generate().keys()], ["bookingsreport/testdata/vectors.json.gz"]);
  assert.deepEqual(bookingsReportVectors.staleFiles(bookingsReportVectors.OUT), [], "the Bookings report's vectors are out of date: run  node go/scripts/gen_bookings_report_vectors.ts  and commit the result");
  const v = JSON.parse(gunzipSync(readFileSync(join(bookingsReportVectors.OUT, "bookingsreport/testdata/vectors.json.gz"))).toString("utf8")) as { node: string };
  assert.match(v.node, /^v\d+\.\d+\.\d+/, "the vectors name the Node that made them");
});

test("words-fresh: the Bookings unit vectors (go/internal/bookings/testdata) equal a fresh run of the TypeScript Bookings functions", async () => {
  const bookings = await import("../../../../go/scripts/gen_bookings_vectors.ts");
  assert.deepEqual([...(await bookings.generate()).keys()].sort(), ["coerce-vectors.json", "golive-vectors.json", "guard-spec-vectors.json", "limits-vectors.json", "ondc-vectors.json", "parser-vectors.json", "report-vectors.json", "router-vectors.json", "runner-vectors.json", "scenarios-vectors.json", "settings-vectors.json", "standin-faults-vectors.json", "templates-vectors.json"]);
  assert.deepEqual(await bookings.staleFiles(bookings.OUT), [], "a Bookings vector file is out of date: run  node go/scripts/gen_bookings_vectors.ts  and commit the result");
});

test("words-fresh: the Guard-client vectors (payments, messaging, calendar, qr, terms, the shared core) equal a fresh run of the TypeScript clients", async () => {
  const guardVectors = await import("../../../../go/scripts/gen_guard_vectors.ts");
  const fresh = await guardVectors.generate();
  assert.ok(fresh.size >= 20, "the generator writes the vector files of every Guard client package");
  assert.deepEqual(await guardVectors.staleFiles(guardVectors.OUT, fresh), [], "a vector file is out of date: run  node go/scripts/gen_guard_vectors.ts  and commit the result");
  // the check is not vacuous: a file that is missing is reported
  const dir = mkdtempSync(join(tmpdir(), "guard-vectors-"));
  try {
    const stale = await guardVectors.staleFiles(dir, fresh);
    assert.equal(stale.length, fresh.size);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the Bookings words and the shared formats (go/internal/bookings/words, go/internal/language/formats.json) equal a fresh render of the TypeScript", async () => {
  const bookings = await import("../../../../go/scripts/gen_bookings_words.ts");
  assert.deepEqual([...bookings.generate().keys()].sort(), ["go/internal/bookings/words/en.json.gz", "go/internal/bookings/words/hi.json.gz", "go/internal/bookings/words/kn.json.gz", "go/internal/bookings/words/ml.json.gz", "go/internal/language/formats.json"]);
  assert.deepEqual(bookings.staleFiles(), [], "a Bookings words file is out of date: run  node go/scripts/gen_bookings_words.ts  and commit the result");
  // the check is not vacuous: a copy with one word changed is reported stale
  const dir = mkdtempSync(join(tmpdir(), "bookings-words-fresh-"));
  try {
    const files = bookings.generate();
    const name = "go/internal/language/formats.json";
    writeFileSync(join(dir, "formats.json"), files.get(name)!.replace("Sun", "Sunn"));
    assert.deepEqual(bookings.staleFiles(dir, new Map([["formats.json", files.get(name)!]])), ["formats.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the voice vectors the Go voice module is proved on (go/internal/voice/testdata) equal a fresh render of the TypeScript voice module", () => {
  assert.equal(voiceVectors.stale(), false, "the voice vectors are out of date: run  node go/scripts/gen_voice_vectors.ts  and commit the result");
});


test("words-fresh: the Orders shop's generated Go data (go/internal/orders: settings and store vectors, words, reading; go/internal/ordersreport) equals a fresh render of the TypeScript", async () => {
  const words = await import("../../../../go/scripts/gen_orders_words.ts");
  assert.deepEqual(words.staleFiles(), [], "an Orders words file is out of date: run  node go/scripts/gen_orders_words.ts  and commit the result");
  const reading = await import("../../../../go/scripts/gen_orders_reading.ts");
  assert.deepEqual(await reading.staleFiles(), [], "an Orders reading file is out of date: run  node go/scripts/gen_orders_reading.ts  and commit the result");
  const settings = await import("../../../../go/scripts/gen_orders_settings.ts");
  assert.deepEqual(await settings.staleFiles(settings.OUT), [], "the Orders settings and store vectors are out of date: run  node go/scripts/gen_orders_settings.ts  and commit the result");
  const reportWords = await import("../../../../go/scripts/gen_orders_report_words.ts");
  assert.deepEqual(reportWords.staleFiles(reportWords.OUT), [], "the Orders report's words are out of date: run  node go/scripts/gen_orders_report_words.ts  and commit the result");
  const reportVectors = await import("../../../../go/scripts/gen_orders_report_vectors.ts");
  assert.deepEqual(reportVectors.staleFiles(reportVectors.OUT), [], "the Orders report's vectors are out of date: run  node go/scripts/gen_orders_report_vectors.ts  and commit the result");
});

test("words-fresh: the assistant's lines and their outgoing check (go/internal/runtime/testdata/assistant-lines.json) equal a fresh render of the TypeScript words and check", () => {
  assert.equal(assistantVectors.stale(), false, "the assistant line vectors are out of date: run  node go/scripts/gen_assistant_vectors.ts  and commit the result");
});

test("words-fresh: what the owner's talk on a Bookings shop is given (go/internal/bookings/testdata/talk-facts-vectors.json) equals a fresh render of the TypeScript skill and prompt", () => {
  assert.equal(talkFactsVectors.stale(), false, "the talk facts vectors are out of date: run  node go/scripts/gen_talk_facts_vectors.ts  and commit the result");
});

test("words-fresh: the stock vectors the Go stock count is proved on (go/internal/stock/testdata) equal a fresh run of modules/stock/stock.ts", async () => {
  const stockVectors = await import("../../../../go/scripts/gen_stock_vectors.ts");
  assert.equal(stockVectors.stale(), false, "the stock vectors are out of date: run  node go/scripts/gen_stock_vectors.ts  and commit the result");
});

test("words-fresh: the Stock orders words the Go runtime says and reads (go/internal/stockorders/words.json) equal a fresh render of the TypeScript templates", async () => {
  const stockOrdersWords = await import("../../../../go/scripts/gen_stockorders_words.ts");
  assert.equal(stockOrdersWords.stale(), false, "the Stock orders words are out of date: run  node go/scripts/gen_stockorders_words.ts  and commit the result");
});

test("words-fresh: the Stock orders vectors (go/internal/stockorders/testdata) equal a fresh run of the TypeScript templates, outgoing check and reader", async () => {
  const stockOrdersVectors = await import("../../../../go/scripts/gen_stockorders_vectors.ts");
  assert.equal(stockOrdersVectors.stale(), false, "the Stock orders vectors are out of date: run  node go/scripts/gen_stockorders_vectors.ts  and commit the result");
});

test("words-fresh: the stock count's own words (go/internal/stock/words.json, modules/stock/words.ts STOCK_LINE_WORDS) equal a fresh render of the TypeScript", async () => {
  const stockWords = await import("../../../../go/scripts/gen_stock_words.ts");
  assert.deepEqual(stockWords.staleFiles(stockWords.OUT), [], "the stock words are out of date: run  node go/scripts/gen_stock_words.ts  and commit the result");
});
