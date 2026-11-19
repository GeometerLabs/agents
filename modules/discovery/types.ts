// The four languages the directory's words are in and its fixed list of kinds: what words.ts and go/scripts/gen_directory.ts read. (The rest of the directory's shapes went with the
// TypeScript directory on 19 Nov 2026; the Go directory, go/internal/directory, follows specs/shop-feed.md, shop-check.md and directory.md.)

/** The four languages the words are in (the same list as modules/language). */
export type Lang = "en" | "hi" | "ml" | "kn";
export const LANGS: readonly Lang[] = ["en", "hi", "ml", "kn"];

export const CATEGORIES = ["pets", "food", "clothes", "home", "electronics", "vehicles_and_cycles", "services", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
