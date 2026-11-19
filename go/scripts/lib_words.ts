// Helpers for the generators that carry TypeScript words to Go (gen_books_words.ts, gen_report_words.ts): a function of the words is rendered with slot sentinels, and the
// result is VERIFIED against the real function on other values, so a word that does more than put its arguments in (a plural, a condition) fails here and is described by hand
// instead of being carried wrong. The Go side is internal/slots. Nothing the owner reads is retyped.
import { gzipSync } from "node:zlib";

const slotText = (i: number): string => `{${i}}`;
const probes = [["", "zz9", "Ab c", "1", "₹1,200", "x{0}y"], ["q", "17", "a & b", "", "k", "{1}"], ["Δ", "z", "0", "9", "m", "n"]];

/** A function of strings written once with `{0}`, `{1}` ... in place of its arguments; throws when it is not just text around its arguments. */
export function slotted(fn: (...a: string[]) => string, arity: number): string {
  const template = fn(...Array.from({ length: arity }, (_, i) => slotText(i)));
  for (const p of probes) {
    const args = p.slice(0, arity);
    const expect = fn(...args);
    const got = template.replace(/\{(\d+)\}/gu, (_m, d) => args[Number(d)]);
    if (got !== expect) throw new Error(`a word is not plain text around its arguments (${JSON.stringify(expect)} against ${JSON.stringify(got)}): describe it by hand`);
  }
  return template;
}

/** A word of a count: one text for exactly 1 and one for any other number (its {0} is the number); verified on 0, 2, 3, 11, 100 and 1000. */
export function counted(fn: (n: number) => string): { one: string; other: string } {
  const one = fn(1);
  const other = fn(7654321).replaceAll("7654321", "{0}");
  for (const n of [0, 2, 3, 11, 100, 1000]) if (fn(n) !== other.replace("{0}", String(n))) throw new Error(`a counted word is not one text for 1 and one for the rest (n = ${n})`);
  return { one, other };
}

/** Sorted keys, so the same words always give the same bytes. */
export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])]));
  return value;
}

export const pack = (value: unknown): Buffer => gzipSync(Buffer.from(JSON.stringify(stable(value))), { level: 9 });
