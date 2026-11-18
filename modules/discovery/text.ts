// The pure text helpers of search: how words are normalised for the index and for a search, the search words of a question, and the distance between two points.
// No import and no database, so the search code (and anything that runs in an agent's own import graph) can use them without node:sqlite.

/** Words as they are indexed and searched: composed form, no zero-width joiners (they split Malayalam words), lower case. */
export const normal = (text: string): string => text.normalize("NFC").replace(/[‌‍]/gu, "").toLowerCase();

/** Great-circle distance in kilometres (haversine), from two points in decimal degrees. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The search words of a text: runs of letters, marks and digits (so a Malayalam word stays whole), at most 8 of 40 characters. */
export function wordsOf(text: string): string[] {
  return (normal(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map((w) => w.slice(0, 40)).slice(0, 8);
}

/** Words that say what a person is doing, not what they want; leaving them out lets "kitten near me" mean "kitten". */
const FILLER = new Set(["near", "nearby", "me", "my", "in", "at", "the", "a", "an", "for", "of", "to", "and", "with", "around", "buy", "sale", "sell", "selling", "available", "shop", "shops", "want", "need", "looking"]);
export const searchWords = (text: string): string[] => wordsOf(text).filter((w) => !FILLER.has(w));
