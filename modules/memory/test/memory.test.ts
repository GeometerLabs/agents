// The shop's memory (modules/memory/memory.ts): who may write, correction, forgetting, expiry, the audience scope before retrieval, and a replaceable retriever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DAY } from "../../core/time.ts";
import {
  CLOSED_TEXT_KEPT_MS, MAX_NOTE_CHARS, MAX_OPEN_NOTES, acceptProposal, addNote, correctNote, declineProposal, emptyMemory, endExpired, exportNotes, forgetNote, memoryRefs, ownerAuthority, panelAuthority,
  propose, recall, tidyMemory,
} from "../memory.ts";
import type { Authority } from "../memory.ts";

const NOW = 1_800_000_000_000;
const c = (nowMs = NOW) => ({ nowMs });
const owner = ownerAuthority("whatsapp");

test("a write needs an authority this module made: a forged one, or none, throws", () => {
  const m = emptyMemory();
  const forged = { by: "owner", from: "whatsapp" } as Authority;
  assert.throws(() => addNote(m, forged, { kind: "fact", text: "closed Sunday", lang: "en" }, c()), /Only the owner/u);
  assert.throws(() => addNote(m, undefined as never, { kind: "fact", text: "x", lang: "en" }, c()));
  assert.throws(() => forgetNote(m, forged, "n-1", c()));
  assert.equal(m.notes.length, 0);
});

test("by and from come from the authority, and the defaults follow the kind", () => {
  const m = emptyMemory();
  const a = addNote(m, owner, { kind: "profile", text: "Warm and short", lang: "en" }, c());
  const b = addNote(m, panelAuthority("operator"), { kind: "instruction", text: "Offer the evening slot first", lang: "en" }, c());
  assert.ok(a.ok && b.ok);
  assert.deepEqual([a.note.by, a.note.from, a.note.audience], ["owner", "whatsapp", "everyone"]);
  assert.deepEqual([b.note.by, b.note.from, b.note.audience], ["operator", "panel", "owner"]);
});

test("a note is at most 280 characters, not empty, and a shop keeps at most 80 open", () => {
  const m = emptyMemory();
  assert.deepEqual(addNote(m, owner, { kind: "fact", text: "  ", lang: "en" }, c()), { ok: false, why: "empty" });
  assert.deepEqual(addNote(m, owner, { kind: "fact", text: "x".repeat(MAX_NOTE_CHARS + 1), lang: "en" }, c()), { ok: false, why: "too_long" });
  for (let i = 0; i < MAX_OPEN_NOTES; i++) assert.ok(addNote(m, owner, { kind: "fact", text: `note ${i}`, lang: "en" }, c()).ok);
  assert.deepEqual(addNote(m, owner, { kind: "fact", text: "one more", lang: "en" }, c()), { ok: false, why: "full" });
});

test("a correction closes the old note and opens one that names it", () => {
  const m = emptyMemory();
  const first = addNote(m, owner, { kind: "fact", text: "Closed 2-4 Nov", lang: "en", audience: "everyone" }, c());
  assert.ok(first.ok);
  const fixed = correctNote(m, owner, first.note.id, { kind: "fact", text: "Closed 3-5 Nov", lang: "en", audience: "everyone" }, c(NOW + 1000));
  assert.ok(fixed.ok);
  assert.equal(fixed.note.replaces, first.note.id);
  assert.deepEqual(m.notes[0].closed, { atMs: NOW + 1000, by: "owner", why: "replaced" });
  assert.deepEqual(recall(m, { audience: "everyone", budget: 1000, nowMs: NOW + 2000 }).map((n) => n.text), ["Closed 3-5 Nov"]);
  assert.equal(correctNote(m, owner, first.note.id, { kind: "fact", text: "again", lang: "en" }, c()).ok, false, "a closed note cannot be corrected again");
});

test("forget removes the text at once and keeps the id, the dates and a digest", () => {
  const m = emptyMemory();
  const n = addNote(m, owner, { kind: "instruction", text: "Never book Priya after 6", lang: "en" }, c());
  assert.ok(n.ok);
  const f = forgetNote(m, owner, n.note.id, c(NOW + 5));
  assert.ok(f.ok);
  const kept = m.notes[0];
  assert.equal(kept.text, "");
  assert.equal(kept.id, n.note.id);
  assert.ok(kept.digest.length > 0);
  assert.equal(kept.closed?.why, "forgotten");
  assert.ok(!JSON.stringify(m).includes("Priya"), "the words are gone from the state");
  assert.equal(recall(m, { audience: "owner", budget: 1000, nowMs: NOW + 10 }).length, 0);
});

test("a keyed digest is used when the caller gives one", () => {
  const m = emptyMemory();
  const n = addNote(m, owner, { kind: "fact", text: "secret", lang: "en" }, { nowMs: NOW, digest: (t) => `k-${t.length}` });
  assert.ok(n.ok);
  assert.equal(n.note.digest, "k-6");
});

test("an end date: not recalled after it, closed on the tick; closed text goes after 30 days", () => {
  const m = emptyMemory();
  const n = addNote(m, owner, { kind: "fact", text: "Diwali sale", lang: "en", audience: "everyone", untilMs: NOW + DAY }, c());
  assert.ok(n.ok);
  assert.equal(recall(m, { audience: "everyone", budget: 100, nowMs: NOW + DAY - 1 }).length, 1);
  assert.equal(recall(m, { audience: "everyone", budget: 100, nowMs: NOW + DAY }).length, 0, "not recalled after its end, even before the tick");
  const ended = endExpired(m, NOW + DAY + 10);
  assert.deepEqual(ended.map((x) => x.id), [n.note.id]);
  assert.equal(m.notes[0].closed?.why, "ended");
  assert.equal(m.notes[0].text, "Diwali sale", "text is kept for undo");
  assert.equal(tidyMemory(m, NOW + DAY + 10 + CLOSED_TEXT_KEPT_MS - 1), 0);
  assert.equal(tidyMemory(m, NOW + DAY + 10 + CLOSED_TEXT_KEPT_MS), 1);
  assert.equal(m.notes[0].text, "");
  assert.equal(m.notes[0].textGone, true);
});

test("scope is applied before the retriever: an owner-only note never reaches a customer, whatever the retriever does", () => {
  const m = emptyMemory();
  addNote(m, owner, { kind: "goal", text: "owner only goal", lang: "en" }, c());
  addNote(m, owner, { kind: "profile", text: "public profile", lang: "en" }, c());
  const greedy = (_scoped: readonly never[], q: { audience: string }) => { void q; return m.notes; };
  const seen = recall(m, { audience: "everyone", budget: 1000, nowMs: NOW }, greedy as never);
  assert.deepEqual(seen.map((n) => n.text), ["public profile"]);
  assert.equal(recall(m, { audience: "owner", budget: 1000, nowMs: NOW }).length, 2);
});

test("the first retriever orders by kind then newest, and keeps within the budget", () => {
  const m = emptyMemory();
  addNote(m, owner, { kind: "goal", text: "g".repeat(50), lang: "en" }, c(NOW));
  addNote(m, owner, { kind: "profile", text: "p".repeat(50), lang: "en" }, c(NOW + 1));
  addNote(m, owner, { kind: "profile", text: "q".repeat(50), lang: "en" }, c(NOW + 2));
  const out = recall(m, { audience: "owner", budget: 100, nowMs: NOW + 3 });
  assert.deepEqual(out.map((n) => n.text[0]), ["q", "p"]);
});

test("a proposal is not a note; Remember writes it, No is final for 24 hours", () => {
  const m = emptyMemory();
  const p = propose(m, { kind: "fact", text: "Tuesdays are quiet", lang: "en" }, c());
  assert.ok(p);
  assert.equal(m.notes.length, 0);
  assert.equal(declineProposal(m, owner, p.id, c(NOW + 10)), true);
  assert.equal(propose(m, { kind: "fact", text: "Tuesdays are quiet", lang: "en" }, c(NOW + DAY - 1)), null);
  const again = propose(m, { kind: "fact", text: "Tuesdays are quiet", lang: "en" }, c(NOW + DAY + 20));
  assert.ok(again);
  const saved = acceptProposal(m, owner, again.id, c(NOW + DAY + 30));
  assert.ok(saved.ok);
  assert.equal(m.notes.length, 1);
  assert.equal(m.proposals.length, 0);
  assert.throws(() => acceptProposal(m, {} as Authority, again.id, c()));
});

test("a proposal past its day cannot be accepted", () => {
  const m = emptyMemory();
  const p = propose(m, { kind: "fact", text: "x y", lang: "en" }, c());
  assert.ok(p);
  assert.equal(acceptProposal(m, owner, p.id, c(NOW + DAY + 1)).ok, false);
});

test("export holds every note; a record line names the note and never its words", () => {
  const m = emptyMemory();
  const n = addNote(m, owner, { kind: "fact", text: "closed Monday", lang: "en" }, c());
  assert.ok(n.ok);
  assert.equal(exportNotes(m).notes.length, 1);
  const refs = memoryRefs(n.note, "added");
  assert.deepEqual(Object.keys(refs).sort(), ["audience", "by", "change", "from", "kind", "note"]);
  assert.ok(!JSON.stringify(refs).includes("Monday"));
});

test("a customer's code path never imports the authority makers", () => {
  for (const file of ["../../assistant/talk-customer.ts", "../../assistant/talk-check.ts", "../../assistant/talk-prompt.ts"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/ownerAuthority|panelAuthority/u.test(text.replace(/\/\/.*$/gmu, "")), `${file} must not make an authority`);
  }
});
