// The `report` block of runtime.json (what switches the monthly report on), its live settings, and a client started with it: the report goes out on the 1st,
// signed with the key the block names, from a folder that a restart finds again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { reportOptionsReader, validateRuntimeConfig } from "../server/config.ts";
import { generateKeyFiles } from "../../../../modules/report/keys.ts";
import { verifyEnvelopeText } from "../../../../modules/report/sign.ts";

const EXAMPLE = new URL("../clients/glow-salon.example", import.meta.url).pathname;
const TOKEN = "0123456789abcdef0123456789abcdef";
const BLOCK = { preparedBy: "Divya, local Operator", pageBaseUrl: "https://reports.example.com/r" };
const check = (report: unknown, extra: object = {}) => validateRuntimeConfig({ mode: "fakes", ...extra, report }, "/clients/glow");

test("with no report block there is no monthly report; with one, the paths are measured from the client folder and the page folder defaults to the data folder's reports", () => {
  const none = validateRuntimeConfig({ mode: "fakes" }, "/clients/glow");
  assert.ok(none.ok && none.config.report === undefined);
  const r = check({ ...BLOCK, innovator: true, source: "live", signingKeyFile: "keys/report-key.pem", goLiveFile: "go-live-certificate.json" });
  assert.ok(r.ok);
  assert.deepEqual(r.config.report, {
    preparedBy: "Divya, local Operator", pageBaseUrl: "https://reports.example.com/r", pagesDir: "/clients/glow/data/reports", innovator: true, source: "live",
    signingKeyFile: "/clients/glow/keys/report-key.pem", goLiveFile: "/clients/glow/go-live-certificate.json",
  });
  const elsewhere = check({ ...BLOCK, pagesDir: "/srv/reports" }, { dataDir: "/srv/data" });
  assert.ok(elsewhere.ok && elsewhere.config.report?.pagesDir === "/srv/reports");
  const inData = check(BLOCK, { dataDir: "/srv/data" });
  assert.ok(inData.ok && inData.config.report?.pagesDir === "/srv/data/reports");
});

test("a report block that cannot work is refused in plain words, all at once", () => {
  const problems = (report: unknown) => { const r = check(report); assert.ok(!r.ok); return (r as { errors: string[] }).errors.join("\n"); };
  assert.match(problems("yes"), /must be an object/);
  assert.match(problems({ pageBaseUrl: BLOCK.pageBaseUrl }), /report\.preparedBy/);
  assert.match(problems({ ...BLOCK, preparedBy: "Divya\nNair" }), /report\.preparedBy/);
  assert.match(problems({ ...BLOCK, preparedBy: "x".repeat(121) }), /report\.preparedBy/);
  assert.match(problems({ preparedBy: BLOCK.preparedBy }), /report\.pageBaseUrl/);
  assert.match(problems({ ...BLOCK, pageBaseUrl: "http://reports.example.com/r" }), /https/);
  assert.match(problems({ ...BLOCK, pageBaseUrl: "https://reports.example.com/r/" }), /slash/);
  assert.match(problems({ ...BLOCK, pageBaseUrl: "https://u:p@reports.example.com/r" }), /user name/);
  assert.match(problems({ ...BLOCK, pageBaseUrl: "https://reports.example.com/r?key=1" }), /query/);
  assert.match(problems({ ...BLOCK, innovator: "yes" }), /report\.innovator/);
  assert.match(problems({ ...BLOCK, source: "stand-in" }), /report\.source/);
  assert.match(problems({ ...BLOCK, banner: 1 }), /"banner"/);
  const many = problems({ preparedBy: 3, pageBaseUrl: 4, extra: true });
  assert.ok(/preparedBy/.test(many) && /pageBaseUrl/.test(many) && /extra/.test(many), many);
});

test("the badge and the name are read again when runtime.json changes, a half-written file leaves them as they were, and a file with no report block changes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-report-options-"));
  try {
    const file = join(dir, "runtime.json");
    const write = (text: string, secondsAhead: number) => { writeFileSync(file, text); const t = new Date(Date.now() + secondsAhead * 1000); utimesSync(file, t, t); };
    write(JSON.stringify({ mode: "fakes", report: { ...BLOCK, innovator: false } }), 0);
    const read = reportOptionsReader(dir, { preparedBy: BLOCK.preparedBy, innovator: false });
    assert.deepEqual(read(), { preparedBy: "Divya, local Operator", innovator: false });
    write(JSON.stringify({ mode: "fakes", report: { ...BLOCK, innovator: true } }), 10);
    assert.deepEqual(read(), { preparedBy: "Divya, local Operator", innovator: true }, "fleet said innovator: the next report carries the badge");
    write('{"mode": "fakes", "report": {"prepared', 20);
    assert.deepEqual(read(), { preparedBy: "Divya, local Operator", innovator: true }, "a write in the middle changes nothing");
    write(JSON.stringify({ mode: "fakes" }), 30);
    assert.deepEqual(read(), { preparedBy: "Divya, local Operator", innovator: true });
    write(JSON.stringify({ mode: "fakes", report: { ...BLOCK, preparedBy: "Arjun, Kochi Automations", innovator: false } }), 40);
    assert.deepEqual(read(), { preparedBy: "Arjun, Kochi Automations", innovator: false }, "and the badge is taken away the same way");
    write(JSON.stringify({ mode: "fakes", report: { ...BLOCK, preparedBy: "bad\nname", innovator: "maybe" } }), 50);
    assert.deepEqual(read(), { preparedBy: "Arjun, Kochi Automations", innovator: false }, "values that are not usable are not taken");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** A temp copy of the example client with a runtime.json that holds a report block, and a token file. */
function client(report: object | undefined) {
  const root = mkdtempSync(join(tmpdir(), "geo-report-start-"));
  const folder = join(root, "glow");
  cpSync(EXAMPLE, folder, { recursive: true });
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600, ...(report ? { report } : {}) }));
  const tokenFile = join(root, "token");
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  return { root, folder, tokenFile, done: () => rmSync(root, { recursive: true, force: true }) };
}

const START = zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, "Asia/Kolkata");
const message = (id: string, text: string) => ({ kind: "message" as const, message: { id, from: "+919811111111", text, timestamp: START } });
