// Which shared module each agent template (and the bundle) uses, worked out from the code's own imports, and written into the two places a reader looks:
// the "Who imports it" column of modules/README.md, and the "Modules it uses" section of each template's README.md.
//
// Why from the imports: these lists were written by hand and fell behind (Orders was missing from most rows, seven modules had no row at all). The imports are
// the one source of truth, so the lists are made from them, like the review sheets are made from the words. A test (modules/test/module-map.test.ts) fails when
// a list is behind; this command brings both back in step:
//   node modules/module-map.ts           prints what the lists should say
//   node modules/module-map.ts --write   writes them
// Only code counts: a test, a fixture or a comment naming a module is not a use. Reading the other folders is fine here: the one rule (test/boundary.test.ts) is
// that a module imports nothing from a template or the bundle, and this file imports nothing from them.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULES = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MODULES, "..");

/** The code that uses the modules, by the name the lists give it, in the order the lists give them. */
export const USERS = [
  { name: "Bookings", dir: "templates/commerce/bookings" },
  { name: "Orders", dir: "templates/commerce/orders" },
  { name: "Fees", dir: "templates/education/fees" },
  { name: "the bundle", dir: "bundle" },
] as const;
export type UserName = (typeof USERS)[number]["name"];

/** The module folders: every folder of modules/ but its own tests. */
export function moduleNames(): string[] {
  return readdirSync(MODULES).filter((n) => n !== "test" && n !== "node_modules" && statSync(join(MODULES, n)).isDirectory()).sort();
}

/** The code files of a folder: .ts, .mjs and .js, not tests, fixtures, builds or dependencies. */
function codeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "test" || name === "tests" || name === "fixtures") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) codeFiles(path, out);
    else if (/\.(ts|mjs|js)$/.test(name) && !/\.test\.(ts|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*(["'])(\.{1,2}\/[^"'\n]*)\1/g;

/** For each user, the modules its code imports (a comment that names a path is not an import). */
export function usesOf(): Map<UserName, Set<string>> {
  const out = new Map<UserName, Set<string>>();
  for (const u of USERS) {
    const used = new Set<string>();
    for (const file of codeFiles(join(REPO, u.dir))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(SPECIFIER)) {
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(\/\/|\*|\/\*)/.test(text.slice(lineStart, m.index + 1))) continue;
        const target = relative(MODULES, resolve(dirname(file), m[2]));
        if (target.startsWith("..")) continue;
        used.add(target.split("/")[0]);
      }
    }
    out.set(u.name, used);
  }
  return out;
}

/** The users of one module, in the lists' order, as the README's column starts. */
export function usersText(module: string, uses = usesOf()): string {
  const names = USERS.filter((u) => uses.get(u.name)!.has(module)).map((u) => u.name);
  return names.length > 0 ? names.join(", ") : "no template's code";
}

// ---- modules/README.md: the "Who imports it" column ----
// A row is `| \`name/\` | what it holds | what a template hands in | who imports it |`. The column starts with the users made here; after " · " a row may add a
// note of its own (another module that uses it, a generator), which is kept as it is.
const ROW = /^\| `([a-z-]+)\/` \|(.*)\| ([^|]*) \|$/;

export function readmeColumn(text: string): Map<string, { users: string; note: string }> {
  const out = new Map<string, { users: string; note: string }>();
  for (const line of text.split("\n")) {
    const m = ROW.exec(line);
    if (!m) continue;
    const [users, ...note] = m[3].split(" · ");
    out.set(m[1], { users: users.trim(), note: note.join(" · ").trim() });
  }
  return out;
}

/** The README with each row's column set to what the code says; a module with no row is listed in `missing`. */
export function readmeWritten(text: string, uses = usesOf()): { text: string; missing: string[] } {
  const seen = new Set<string>();
  const lines = text.split("\n").map((line) => {
    const m = ROW.exec(line);
    if (!m) return line;
    seen.add(m[1]);
    const note = m[3].split(" · ").slice(1).join(" · ").trim();
    return `| \`${m[1]}/\` |${m[2]}| ${usersText(m[1], uses)}${note ? ` · ${note}` : ""} |`;
  });
  return { text: lines.join("\n"), missing: moduleNames().filter((n) => !seen.has(n)) };
}

// ---- each template's README.md: the "Modules it uses" section ----
export const SECTION_START = "<!-- modules it uses: made by modules/module-map.ts from the imports; run `node modules/module-map.ts --write` -->";
export const SECTION_END = "<!-- end of modules it uses -->";

/** The section for a template: every module its code imports, linked to the module's row, and where to read what it hands in. */
export function templateSection(user: UserName, uses = usesOf()): string {
  const u = USERS.find((x) => x.name === user)!;
  const up = relative(join(REPO, u.dir), MODULES);
  const list = [...uses.get(user)!].filter((n) => moduleNames().includes(n)).sort().map((n) => `[\`${n}/\`](${up}/README.md#what-is-here)`).join(", ");
  return [SECTION_START, "", `The shared modules ${user} uses, from its code's own imports: ${list}.`, "",
    `What each one does and what a template hands it: the table in [modules/README.md](${up}/README.md#what-is-here). A new template uses the same modules the same way.`, "", SECTION_END].join("\n");
}

/** A template README with its section written: in place between the markers, or added at the end with its heading. */
export function templateReadmeWritten(text: string, user: UserName, uses = usesOf()): string {
  const section = templateSection(user, uses);
  const a = text.indexOf(SECTION_START), b = text.indexOf(SECTION_END);
  if (a >= 0 && b > a) return text.slice(0, a) + section + text.slice(b + SECTION_END.length);
  return `${text.replace(/\n*$/, "")}\n\n## Modules it uses\n\n${section}\n`;
}

/** The README files this keeps in step, with what each should say. */
export function expected(uses = usesOf()): { path: string; text: string; missing?: string[] }[] {
  const readme = join(MODULES, "README.md");
  const r = readmeWritten(readFileSync(readme, "utf8"), uses);
  const out: { path: string; text: string; missing?: string[] }[] = [{ path: readme, text: r.text, missing: r.missing }];
  for (const u of USERS) {
    if (u.name === "the bundle") continue; // the bundle is not a template: modules/README.md's column names it, and its own README says how it runs them
    const path = join(REPO, u.dir, "README.md");
    if (existsSync(path)) out.push({ path, text: templateReadmeWritten(readFileSync(path, "utf8"), u.name, uses) });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const uses = usesOf();
  const files = expected(uses);
  if (files[0].missing!.length > 0) {
    console.error(`These modules have no row in modules/README.md; add one (what it holds, what a template hands in), then run this again: ${files[0].missing!.join(", ")}`);
    process.exitCode = 1;
  }
  if (process.argv.includes("--write")) {
    for (const f of files) if (readFileSync(f.path, "utf8") !== f.text) { writeFileSync(f.path, f.text); console.log(`wrote ${relative(REPO, f.path)}`); }
  } else {
    for (const n of moduleNames()) console.log(`${n.padEnd(14)} ${usersText(n, uses)}`);
  }
}
