// The demo differential (decision 61, the switch of 24 Nov 2026). The public demos stay TypeScript: each runs the template's own agent on its in-memory stand-ins
// (src/harness.ts createWorld, what demo/ and modules/demo/quick.ts drive). The shops run on the Go programs. So that a demo never shows a shop that the real one is not,
// each template's contract folder has a differential.test.ts that walks the demo's own paths twice, step by step: once on the demo's TypeScript world, and once on the Go
// shop started as a separate process (a "guards" shop: its WhatsApp is the stand-in behind the fake Guard, so every message it sends is read back whole), and compares what
// each said to each person after every step.
//
// What is compared: every WhatsApp message to the customer and to the owner, in order, as the stand-in WhatsApp keeps it (both sides use modules/messaging's fake, so the
// shape is the same): its kind, the template's name, the words, and the ids and titles of its buttons or list rows. What is NOT compared, and why, is named by each rule of
// `Normalise` in the test that uses it: only things that differ by design between two runs (a payment link's random id, a page link's random handle). A real difference is
// never normalised away: it fails the test, and the template's TypeScript runtime was not deleted until its differential passed (go/TRIAL.md).
//
// The two sides run at the same instant: the Go shop on the real clock (a guards shop cannot take the test clock), the TypeScript world on a fake clock that is set to the
// wall clock before every step (`Side.sync`), so a sentence like "tomorrow at 6pm" names the same day on both, and a time the agent writes from "now" is the same minute.
import assert from "node:assert/strict";

/** One message as the stand-in WhatsApp kept it (modules/messaging/messaging.ts OutboundMessage, the fields compared). */
export interface Sent { kind: string; templateName?: string; text: string; interactive?: { body?: string; buttons?: { id: string; title: string }[]; list?: { button?: string; rows: { id: string; title: string; description?: string }[] } } }

/** What is compared of one message. */
export interface Said { kind: string; template?: string; text: string; options?: string[] }

/** A rule that replaces what differs by design between two runs: a pattern and the mark that stands for it. Each test names its rules and says why. */
export type Normalise = [RegExp, string][];

export const saidOf = (m: Sent, rules: Normalise): Said => {
  const clean = (t: string): string => rules.reduce((x, [re, mark]) => x.replace(re, mark), t);
  const i = m.interactive;
  const options = i ? [...(i.buttons ?? []).map((b) => `${b.id}=${b.title}`), ...(i.list?.rows ?? []).map((r) => `${r.id}=${r.title}${r.description ? ` (${r.description})` : ""}`)] : [];
  return { kind: m.kind, ...(m.templateName ? { template: m.templateName } : {}), text: clean(m.text), ...(options.length ? { options: options.map(clean) } : {}) };
};

/** One side of the comparison: how to do each step there, and what the stand-in WhatsApp holds for a number. */
export interface Side {
  name: "TypeScript demo" | "Go shop";
  /** Everything the stand-in WhatsApp sent this number, oldest first. */
  sentTo(number: string): Sent[];
  /** Before each step: the TypeScript world's clock is set to the wall clock (the Go shop's own clock); nothing on the Go side. */
  sync(): void;
}

/** A step of the demo: what the visitor (or the owner) does, on each side. Every step must make the shop send someone something (else it compares nothing). */
export interface Step<T> { name: string; ts: (w: T) => Promise<unknown>; go: (w: T) => Promise<unknown> }

/** The transcript of one walk: per step, what each person was sent on each side. */
export interface Transcript { step: string; to: string; ts: Said[]; go: Said[] }[]

/**
 * Walk the steps on both sides and compare after each. `people` are the numbers whose messages are read (the customer and the owner). Fails at the first step whose
 * messages differ, naming the step and the person; also fails when a step sent nobody anything on either side (a comparison of empty lists proves nothing).
 */
export async function walk<T>(o: { steps: Step<T>[]; people: Record<string, string>; ts: Side; go: Side; world: T; rules: Normalise }): Promise<Transcript[]> {
  const seen = { ts: new Map<string, number>(), go: new Map<string, number>() };
  const out: Transcript[] = [];
  for (const step of o.steps) {
    o.ts.sync(); o.go.sync();
    await step.ts(o.world);
    await step.go(o.world);
    let said = 0;
    for (const [who, number] of Object.entries(o.people)) {
      const fresh = (side: Side, key: "ts" | "go"): Said[] => { const all = side.sentTo(number); const from = seen[key].get(number) ?? 0; seen[key].set(number, all.length); return all.slice(from).map((m) => saidOf(m, o.rules)); };
      const ts = fresh(o.ts, "ts"), go = fresh(o.go, "go");
      assert.deepEqual(go, ts, `step "${step.name}": what the ${who} was sent differs between the Go shop (actual) and the TypeScript demo (expected)`);
      said += ts.length;
      out.push({ step: step.name, to: who, ts, go });
    }
    assert.ok(said > 0, `step "${step.name}": nobody was sent anything on either side, so this step compares nothing`);
  }
  return out;
}

/** The check bites: a transcript with one word changed on one side is a difference `walk`'s comparison reports. */
export function assertBites(t: Transcript[]): void {
  const first = t.find((x) => x.ts.length > 0);
  assert.ok(first, "the walk compared at least one message");
  const altered = first!.go.map((m, i) => (i === 0 ? { ...m, text: `${m.text} (changed)` } : m));
  assert.throws(() => assert.deepEqual(altered, first!.ts), "one changed word is a difference");
}
