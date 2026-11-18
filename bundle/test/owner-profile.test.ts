// The owner's file (block S, "Get my shop's file"): the same package format as the Operator's, made for the owner. It holds only this shop's own files, never another shop's;
// customers are the keyed fingerprints and nothing else; an older unkeyed record is refused (the owner is not handed numbers that can be guessed back); the server's own
// status.json is left out; the manifest says whose it is; and no key or secret is in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExportError, buildExport } from "../export/build.ts";
import { sourcesFor } from "../export/sources.ts";
import { PERSON_FORM } from "../../modules/record/fingerprint.ts";
import { world } from "./world.ts";

const NOW = Date.parse("2026-11-18T10:00:00+05:30");
const entry = (seq: number, conversation: string, action: string) => ({ seq, time: new Date(NOW - 60_000 * (10 - seq)).toISOString(), conversation, booking: null, action, inputsDigest: "0123456789abcdef", outcome: "confirmed", decisions: [], language: "en", notes: "", refs: {} });

function exportRecord(root: string, shop: string, o: { keyed: boolean; marker?: string }): void {
  const dir = join(root, "exports", shop);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "record.json"), JSON.stringify([entry(1, "c-aaaaaaaaaaaa", "receive_message"), entry(2, "c-aaaaaaaaaaaa", o.marker ?? "hold_slot")]));
  writeFileSync(join(dir, "bookings.json"), JSON.stringify([{ id: "b-1", customer: "p-bbbbbbbbbbbb", state: "confirmed", pending: [] }]));
  if (o.keyed) writeFileSync(join(dir, "person-form.json"), JSON.stringify({ form: PERSON_FORM, inputs: { keyed: 2, older: 0 }, messageIds: { older: 0 } }));
}
const owner = { name: "the owner", role: "owner" };

test("the owner's file: its manifest says it is the owner's, the server's own status is not in it, and it checks like any other package", () => {
  const w = world();
  try {
    w.handIn("glow-salon");
    exportRecord(w.root, "glow-salon", { keyed: true });
    mkdirSync(join(w.root, "status"), { recursive: true });
    writeFileSync(join(w.root, "status", "glow-salon.json"), JSON.stringify({ deploy: { message: "server detail the owner does not need" } }));
    assert.ok(buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: { name: "Divya", role: "partner" } }).files.has("status.json"), "the Operator's package carries it");
    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: owner, profile: "owner" });
    assert.equal(built.manifest.profile, "owner");
    assert.equal(built.manifest.exportedBy?.role, "owner");
    assert.equal(built.files.has("status.json"), false);
    assert.match(built.files.get("README.txt")!.toString("utf8"), /for the owner \(owner\)/u);
    assert.ok(built.manifest.notes.some((n) => /owner's file/u.test(n)));
    const operators = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: { name: "Divya", role: "partner" } });
    assert.equal(operators.manifest.profile, undefined, "the Operator's package is as it was");
  } finally { w.done(); }
});

test("customers are the record's keyed fingerprints, and an older unkeyed record is refused for the owner", () => {
  const w = world();
  try {
    w.handIn("glow-salon");
    exportRecord(w.root, "glow-salon", { keyed: true });
    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: owner, profile: "owner" });
    assert.equal(built.manifest.personFingerprints.keyed, true);
    assert.match(built.files.get("record/record.jsonl")!.toString("utf8"), /c-aaaaaaaaaaaa/u);
    assert.doesNotMatch(built.files.get("record/record.jsonl")!.toString("utf8"), /\+91\d{10}/u, "no customer's number as itself");
    exportRecord(w.root, "glow-salon", { keyed: false });
    assert.throws(() => buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: owner, profile: "owner" }), (e: Error) => e instanceof ExportError && /keyed form/u.test(e.message));
    // the Operator's package still takes an older record, with its warning, as it always did
    assert.doesNotThrow(() => buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: { name: "Divya", role: "partner" } }));
  } finally { w.done(); }
});

test("nothing of another shop is in the owner's file", () => {
  const w = world();
  try {
    w.handIn("glow-salon");
    w.handIn("other-shop");
    exportRecord(w.root, "glow-salon", { keyed: true });
    exportRecord(w.root, "other-shop", { keyed: true, marker: "ANOTHER_SHOPS_SECRET_ACTION" });
    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: owner, profile: "owner" });
    for (const [path, content] of built.files) assert.ok(!content.toString("utf8").includes("ANOTHER_SHOPS_SECRET_ACTION") && !content.toString("utf8").includes("other-shop"), `${path} holds something of another shop`);
    assert.throws(() => sourcesFor(w.root, "../other-shop"), /not a shop name/u, "a crafted name cannot walk to another shop's folder");
  } finally { w.done(); }
});

test("a secret-shaped value anywhere stops the owner's file as it stops the Operator's", () => {
  const w = world();
  try {
    w.handIn("glow-salon");
    exportRecord(w.root, "glow-salon", { keyed: true, marker: "-----BEGIN PRIVATE KEY-----" });
    assert.throws(() => buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: owner, profile: "owner" }), /private key/u);
  } finally { w.done(); }
});
