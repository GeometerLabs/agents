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
import { publishFingerprint, readFingerprints } from "../../modules/record/publish.ts";
import { buildExport } from "../export/build.ts";
import { checkPackage } from "../export/check.ts";
import { sourcesFor } from "../export/sources.ts";
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

test("the shop's export (B38) carries the record as an evidence pack with its anchor, the daily fingerprints and the agent's id; its check runs geo-verify when it is there", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  try {
    const { privateKey } = generateKeyPairSync("ed25519");
    const exports = join(w.root, "exports", "glow-salon");
    mkdirSync(exports, { recursive: true });
    const list = [entry(1), entry(2), entry(3), entry(4)];
    writeFileSync(join(exports, "record.json"), JSON.stringify(list));
    writeFileSync(join(exports, "bookings.json"), "[]");
    const ledger = ledgerEntries(list, "glow-salon");
    writeFileSync(join(exports, "ledger.json"), JSON.stringify(ledger));
    await publishFingerprint({ file: join(exports, "fingerprints.jsonl"), ledger: ledger.slice(0, 3), day: "2026-11-03", now: t0, anchor: anchorOf(ledger.slice(0, 3), privateKey) });
    writeFileSync(join(w.root, "shops", "glow-salon", "identity.json"), `${JSON.stringify({ schema: 1, id: "agt_0123456789abcdefghjk", public: ["limits"] })}\n`);
    const built = buildExport(sourcesFor(w.root, "glow-salon", { papers: () => [], meta: () => undefined, signingKey: () => privateKey }), { shop: "glow-salon", now: t0 + 86_400_000 });
    for (const f of ["record/ledger/pack.json", "record/ledger/anchor.json", "record/ledger/fingerprints.jsonl", "identity.json"]) {
      assert.ok(built.files.has(f), f);
      assert.ok(built.manifest.files.some((m) => m.path === f), `${f} in the manifest`);
    }
    assert.match(built.files.get("README.txt")!.toString("utf8"), /geo-verify record\/ledger\/pack\.json --anchor record\/ledger\/anchor\.json/);
    const pack = JSON.parse(built.files.get("record/ledger/pack.json")!.toString("utf8"));
    assert.equal(pack.key_log.length, 1);
    assert.equal(pack.entries.at(-1).hash, ledger.at(-1)!.hash);

    const bin = process.env.GEO_VERIFY_BIN;
    assert.deepEqual(checkPackage(built.files, {}).ledger, { asked: false, why: "set GEO_VERIFY_BIN to the geo-verify program to check the record's evidence pack too" });
    if (bin && existsSync(bin)) {
      const ok = checkPackage(built.files, { geoVerify: bin });
      assert.equal(ok.ok, true, ok.problems.join("\n"));
      assert.deepEqual(ok.ledger && ok.ledger.asked && [ok.ledger.exit, ok.ledger.verified, ok.ledger.anchors], [0, { from: 1, to: 4 }, 2], "the package's own anchor and the fingerprint line's");
      // a changed entry: the package's own sums catch the file, and geo-verify the record
      const edited = JSON.parse(built.files.get("record/ledger/pack.json")!.toString("utf8"));
      edited.entries[1].body = edited.entries[1].body.replace("\"confirmed\"", "\"failed\"");
      const tampered = new Map(built.files); tampered.set("record/ledger/pack.json", Buffer.from(`${JSON.stringify(edited)}\n`));
      const bad = checkPackage(tampered, { geoVerify: bin });
      assert.equal(bad.ok, false);
      assert.ok(bad.problems.some((p) => /geo-verify says the record does not match its anchor/u.test(p)), bad.problems.join("\n"));
    }
  } finally { w.done(); }
});
