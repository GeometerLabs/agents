// The daily fingerprint on a server (B28): the head of each shop's ledger, from the export, appended to state/fingerprints/<shop>.jsonl; signed by the panel when it can,
// unsigned and said so when it cannot; a record rewritten after its fingerprint went out is refused and the shop's status says so; git and the calendar wait for the
// owner's yes in fingerprints.json and nothing is run or sent before it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anchorOf, ledgerEntries } from "../../modules/record/ledger.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import { readFingerprints } from "../../modules/record/publish.ts";
import { fingerprintFile, lastFingerprint, runFingerprints, targetsFile } from "../backup/fingerprints.ts";
import { deploy } from "../deploy.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { readStatus } from "../lib/status.ts";
import { world } from "./world.ts";
import { main } from "../geometer.ts";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { panelRuntime } from "./helpers.ts";

const t0 = Date.UTC(2026, 10, 3, 4, 30);
const entry = (seq: number, outcome: RecordEntry["outcome"] = "confirmed"): RecordEntry => ({ seq, time: new Date(t0 + seq * 60_000).toISOString(), conversation: "c-0123456789ab", booking: "b-1", action: "send_message", inputsDigest: "0123456789abcdef", outcome, decisions: [], language: "en", notes: "", refs: {} });

test("the daily fingerprint: written from the export's ledger, signed by the panel's answer, refused when the record changed, and the outside targets wait for the owner's yes", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    const { privateKey } = generateKeyPairSync("ed25519");
    const exports = join(w.root, "exports", "glow-salon");
    mkdirSync(exports, { recursive: true });
    const put = (list: RecordEntry[]) => writeFileSync(join(exports, "ledger.json"), JSON.stringify(ledgerEntries(list, "glow-salon")));
    put([entry(1), entry(2), entry(3)]);
    const real = w.ctx.runner;
    const asked: string[][] = [];
    w.ctx.runner = fakeRunner((c, a, o) => {
      if (a.includes("anchor")) { asked.push(a); return ok(JSON.stringify({ ok: true, anchor: anchorOf(ledgerEntries([entry(1), entry(2), entry(3)], "glow-salon"), privateKey) })); }
      if (c === "git") { asked.push(["git", ...a]); return ok(""); }
      return real.run(c, a, o) as never;
    });
    w.ctx.now = () => new Date("2026-11-04T10:00:00+05:30");
    const first = await runFingerprints(w.ctx);
    assert.equal(first.ok, true, first.lines.join("\n"));
    assert.match(first.lines[0], /glow-salon: fingerprint of entry 3 written \(signed by the panel's key\); git: off; OpenTimestamps: off/);
    assert.equal(asked.length, 1, "the panel was asked to sign, once");
    const line = readFingerprints(fingerprintFile(w.root, "glow-salon"))[0];
    assert.equal(line.anchor!.checkpoint.head, line.head);
    assert.deepEqual(lastFingerprint(w.root, "glow-salon"), { seq: 3, head: line.head, day: "2026-11-04" });
    assert.equal(readStatus(w.root, "glow-salon")!.fingerprint!.ok, true);

    // the next day, with git and the calendar switched on but no yes recorded: nothing is run, nothing is sent
    writeFileSync(targetsFile(w.root), JSON.stringify({ git: { enabled: true, repo: w.root }, opentimestamps: { enabled: true, calendars: ["http://127.0.0.1:9"] } }));
    put([entry(1), entry(2), entry(3), entry(4)]);
    w.ctx.now = () => new Date("2026-11-05T10:00:00+05:30");
    let fetched = 0;
    const second = await runFingerprints(w.ctx, { fetch: async () => { fetched++; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; } });
    assert.match(second.lines[0], /git: waiting for the owner's yes .*OpenTimestamps: waiting for the owner's yes/);
    assert.match(second.lines[0], /not signed: the panel signed a different head/, "the fake panel signed yesterday's head: the line says so, not that it is signed");
    assert.equal(fetched, 0);
    assert.equal(asked.filter((a) => a[0] === "git").length, 0);

    // a record rewritten after its fingerprint was published: refused, nothing written, the status says so
    put([entry(1), entry(2, "failed"), entry(3), entry(4), entry(5)]);
    w.ctx.now = () => new Date("2026-11-06T10:00:00+05:30");
    const third = await runFingerprints(w.ctx);
    assert.equal(third.ok, false);
    assert.match(third.lines[0], /FINGERPRINT REFUSED: .*changed after it was published/);
    assert.equal(readFingerprints(fingerprintFile(w.root, "glow-salon")).length, 2);
    assert.equal(readStatus(w.root, "glow-salon")!.fingerprint!.ok, false);
  } finally { w.done(); }
});

test("geometer paper dispute asks the panel and writes what it hands back; a file name that is not a plain name is refused; a statement is not made on the command line", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  const out = mkdtempSync(join(tmpdir(), "geo-paper-"));
  const said: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => said.push(a.join(" ")); console.error = (...a: unknown[]) => said.push(a.join(" "));
  try {
    const asked: string[][] = [];
    let files = [{ file: "case-b-1.json", text: "{\"format\":\"geometer-document/1\"}\n" }, { file: "case-b-1-en.html", text: "<p>case</p>" }];
    const ctx = { ...w.ctx, runner: fakeRunner((_c, args) => { asked.push(args); return args.includes("/app/bundle/panel/main.ts") ? ok(`${JSON.stringify({ ok: true, files })}\n`) : ok(""); }) };
    assert.equal(await main(["paper", "dispute", "glow-salon", "--case", "b-1", "--out", out, "--server", w.root], ctx), 0, said.join("\n"));
    const exec = asked.at(-1)!;
    assert.deepEqual(exec.slice(exec.indexOf("/app/bundle/panel/main.ts") + 1), ["paper", "dispute", "glow-salon", "--case", "b-1", "--json"]);
    assert.equal(readFileSync(join(out, "case-b-1-en.html"), "utf8"), "<p>case</p>");
    files = [{ file: "../escape.json", text: "x" }];
    assert.equal(await main(["paper", "dispute", "glow-salon", "--case", "b-1", "--out", out, "--server", w.root], ctx), 1);
    assert.equal(existsSync(join(out, "..", "escape.json")), false);
    assert.match(said.join("\n"), /not a plain file name/);
    assert.equal(await main(["paper", "statement", "glow-salon", "--out", out, "--server", w.root], ctx), 1);
    assert.match(said.join("\n"), /statement is made in the panel/);
  } finally { console.log = log; console.error = error; w.done(); }
});
