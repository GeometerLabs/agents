// The narrowing helpers for replies from services (untyped by nature). They live apart from http.ts, which makes the network calls, so the browser demo
// can take these without taking a file that names `fetch` (bundle/test/hosted-demo.test.ts); http.ts re-exports them, so no live adapter changes.
// Adapters narrow a reply with the helpers below instead of trusting a shape.
export type Json = Record<string, any>;
// The plain-object check the narrowing helpers share; arrays are excluded because a service returning a list where an object is expected is a fault, not data.
export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
// Returns [] for anything else so a missing list in a reply reads as empty rather than crashing the adapter.
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// Narrows a reply field to a string or undefined, never coercing, so a wrong type in a reply is treated as absent.
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
// Rejects NaN and Infinity as well as non-numbers, because an amount that is not finite must never reach money code.
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
