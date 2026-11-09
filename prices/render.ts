// The sell guides take their numbers from this folder: `node prices/render.ts`.
//
// A guide's text is written once, in a source file beside it (`templates/<domain>/<name>/sell/guide.<lang>.src.md`, and the variants under `sell/variants/`), with a
// placeholder wherever a price goes: `{{plan.basic.fee}}`, `{{guide.basic.shop-min}}`, `{{razorpay.platform-fee}}`, and `{{date}}` for the list's own day. This
// script fills every placeholder from the price list in force and writes the guide the repo shows (the same name without `.src`). An id the list does not have stops
// it, and names the file. `node prices/render.ts --check` writes nothing and fails if a guide is not what its source and the list make, which is what
// prices/render.test.ts and each template's sell-guide test check. So a new price list means one command, never a hand edit in twelve guides.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PRICES_DIR, listFiles } from "./new.ts";

export const REPO = fileURLToPath(new URL("..", import.meta.url));
const PLACEHOLDER = /\{\{([a-z0-9][a-z0-9.-]*)\}\}/gu;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Rate { currency?: string; micro?: number; basisPoints?: number; count?: number }
export interface List { date: string; rates: Record<string, Rate> }

/** The newest list that is not a proposal: the one a month is priced with today. */
export function listInForce(dir: string = PRICES_DIR): List {
  for (const f of listFiles(dir).reverse()) {
    const list = JSON.parse(readFileSync(join(dir, f), "utf8")) as List & { status?: string };
    if (list.status !== "proposed") return list;
  }
  throw new Error(`There is no price list in force in ${dir}.`);
}

const grouped = (n: number, decimals = 0): string => n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** One rate as a guide writes it: rupees with Indian grouping ("₹1,499", "₹4.90"), a share as a percent ("2.36%"), a count with grouping ("10,000"). */
export function formatRate(id: string, r: Rate): string {
  if (r.micro !== undefined) {
    if (r.currency !== "INR") throw new Error(`${id} is in ${r.currency}: a guide writes rupees only.`);
    const paise = r.micro / 10_000;
    if (!Number.isInteger(paise)) throw new Error(`${id} is not a whole number of paise.`);
    return `₹${grouped(paise / 100, paise % 100 === 0 ? 0 : 2)}`;
  }
  if (r.basisPoints !== undefined) return `${r.basisPoints / 100}%`;
  if (r.count !== undefined) return grouped(r.count);
  throw new Error(`${id} has no amount.`);
}

/** "9 November 2026". */
export const dayWords = (date: string): string => { const [y, m, d] = date.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/** Fill every placeholder. Throws, naming the ids, when the list does not have one. */
export function render(text: string, list: List, where = "the text"): string {
  const missing = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_, id: string) => {
    if (id === "date") return dayWords(list.date);
    const r = list.rates[id];
    if (!r) { missing.add(id); return ""; }
    return formatRate(id, r);
  });
  if (missing.size > 0) throw new Error(`${where} names ${[...missing].map((id) => `{{${id}}}`).join(", ")}, which the price list of ${list.date} does not have.`);
  if (/\{\{|\}\}/u.test(out)) throw new Error(`${where} has a placeholder that is not written {{id}}.`);
  return out;
}

/** Every guide source in the templates: `sell/**\/*.src.md`. */
export function sources(root: string = REPO): string[] {
  const out: string[] = [];
  const templates = join(root, "templates");
  for (const domain of readdirSync(templates, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const name of readdirSync(join(templates, domain.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const sell = join(templates, domain.name, name.name, "sell");
      let files: string[];
      try { files = readdirSync(sell, { recursive: true }) as string[]; } catch { continue; }
      for (const f of files) if (f.endsWith(".src.md")) out.push(join(sell, f));
    }
  }
  return out.sort();
}

/** What the guide beside a source must say. */
export function rendered(source: string, list: List, root: string = REPO): { file: string; text: string } {
  const file = source.replace(/\.src\.md$/u, ".md");
  const note = `\n<!-- Made by prices/render.ts from ${basename(source)} and the price list in force. Edit that file, then run: node prices/render.ts -->\n`;
  return { file, text: `${render(readFileSync(source, "utf8"), list, relative(root, source)).replace(/\n+$/u, "")}\n${note}` };
}

/** The guides that are not what their source and the list in force make (relative paths). Empty when every guide is current. */
export function stale(root: string = REPO, list: List = listInForce()): string[] {
  return sources(root).flatMap((s) => {
    const r = rendered(s, list, root);
    let now: string | undefined;
    try { now = readFileSync(r.file, "utf8"); } catch { /* not made yet */ }
    return now === r.text ? [] : [relative(root, r.file)];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  try {
    const list = listInForce();
    if (check) {
      const behind = stale(REPO, list);
      if (behind.length > 0) { console.error(`Not made from the price list of ${list.date}: ${behind.join(", ")}. Run: node prices/render.ts`); process.exit(1); }
      console.log(`Every guide is made from its source and the price list of ${list.date}.`);
    } else {
      for (const s of sources()) { const r = rendered(s, list); writeFileSync(r.file, r.text); console.log(`${relative(REPO, r.file)} (from ${basename(s)}, the price list of ${list.date})`); }
    }
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
