// Canonical JSON: the one way a JSON value is written as bytes so that two programs, in any language, get the same bytes and so the same signature.
// It is RFC 8785 (JSON Canonicalization Scheme, https://www.rfc-editor.org/rfc/rfc8785) for the values our formats use: objects, arrays, strings,
// true, false, null and INTEGERS. Our formats have no floating-point numbers (money is a decimal string, see specs/shop-feed.md), so this refuses a
// number that is not a safe integer instead of guessing how to write it: a refusal is loud, a wrong guess would be a signature nobody can check.
//
// Why strict: the thing signed must be exactly the thing read. An `undefined` member (which JSON.stringify would silently drop), a Date, a Map or a
// string with a lone surrogate (not valid Unicode, so not valid JSON text) could make the signer and the reader disagree about what was signed.
// So all of them throw. Member names are sorted by UTF-16 code units, which is what JavaScript's own default sort does and what the RFC requires
// (its section 3.2.3 gives the example the test uses). Strings are written by JSON.stringify, whose escaping is the RFC's (section 3.2.2.2).
//
// Pure: no import, no disk, no network, so an agent's own import graph (which a browser demo is built from) may use it.

/** A value canonical JSON can write. */
export type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };

/** Thrown for a value that has no canonical form; the message says where, so the writer can fix the value. */
export class CanonicalError extends Error {
  constructor(where: string, why: string) { super(`${where || "the value"}: ${why}`); this.name = "CanonicalError"; }
}

const isPlain = (v: object): boolean => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

function write(value: unknown, where: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean": return value ? "true" : "false";
    case "string":
      if (!value.isWellFormed()) throw new CanonicalError(where, "a string with a lone surrogate is not valid Unicode");
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) throw new CanonicalError(where, `${String(value)} is not a safe integer (these formats have no floating-point numbers; write money as a decimal string)`);
      return String(value); // -0 is written 0, as the RFC's table says
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v, i) => write(v, `${where}[${i}]`)).join(",")}]`;
      if (!isPlain(value)) throw new CanonicalError(where, "only plain objects, arrays, strings, integers, booleans and null can be written");
      const obj = value as Record<string, unknown>;
      return `{${Object.keys(obj).sort().map((k) => {
        if (!k.isWellFormed()) throw new CanonicalError(where, "a member name with a lone surrogate is not valid Unicode");
        if (obj[k] === undefined) throw new CanonicalError(`${where}.${k}`, "is undefined (leave the member out instead)");
        return `${JSON.stringify(k)}:${write(obj[k], `${where}.${k}`)}`;
      }).join(",")}}`;
    }
    default: throw new CanonicalError(where, `a ${typeof value} cannot be written`);
  }
}

/** The canonical text of a value (RFC 8785 for our value set). */
export const canonicalJson = (value: unknown): string => write(value, "");

/** The canonical bytes (UTF-8) of a value: what a signature covers. */
export const canonicalBytes = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(value));
