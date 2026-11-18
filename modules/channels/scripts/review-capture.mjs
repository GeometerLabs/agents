// Chat review capture (18 Nov 2026): starts the screens server (modules/channels/chat-screens.ts), opens every state of the chat page in a real browser and writes, into the
// output folder: one screenshot per state (full page, device scale 2), results.json, summary.md and contact-sheet.html. For each screenshot it also records what a reviewer must
// check: console errors and blocked requests, WCAG 2 A/AA failures (axe-core), sideways overflow, tap targets under 44 px, text clipped by overflow:hidden (not screen-reader-only text or an ellipsis on purpose), and the words the
// chat must never show ("passkey", "session", "error", "retry", "AI", "bot"). The "-big" shots set the root font size to 200% (the large-text persona); "-still" asks the
// browser for reduced motion.
//
// Why a script and not a test: it needs a browser, takes minutes and produces pictures a person looks at. Run it before the owner sees any change to the customer chat.
//
//   node modules/channels/scripts/review-capture.mjs [--out <folder>] [--playwright-from <package.json>]
//
//   --out               where the files go (default: ./chat-review in the current folder)
//   --playwright-from   the path of a package.json whose node_modules hold `playwright-core` (with its Chromium installed) and `axe-core`; default: the PLAYWRIGHT_FROM
//                       environment variable, else ./package.json. This repository has no browser dependency of its own (it adds none), so point it at any project that has them,
//                       for example `--playwright-from ../public-web/package.json`.
//                       The path is relative to the folder the command runs in, so from a worktree give an absolute path.
// Run it from the repository root (the screens server is started from there). Nothing is sent to any network address but this machine's own.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const require = createRequire(path.resolve(arg("--playwright-from") ?? process.env.PLAYWRIGHT_FROM ?? "package.json"));
const { chromium } = require("playwright-core");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const OUT = path.resolve(arg("--out") ?? "chat-review");
fs.mkdirSync(OUT, { recursive: true });
const AGENTS = process.cwd();
const free = () => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const port = await free();
const srv = spawn("node", [`${AGENTS}/modules/channels/chat-screens.ts`, String(port)], { cwd: AGENTS, stdio: "ignore" });
const stop = () => { try { srv.kill(); } catch {} };
process.on("exit", stop);
const B = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + "/")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const idx = await (await fetch(B + "/")).text();
const states = [...idx.matchAll(/href="\/([a-z-]+)"/g)].map((m) => m[1]);
console.log("states", states.join(","));
const chat = states.filter((s) => s !== "paints");
const kindStates = ["empty", "answered", "long", "confirmed", "paid", "capped", "closed", "paused"].filter((s) => chat.includes(s));
const LANGS = ["en", "hi", "ml", "kn"];
const jobs = [];
const add = (kind, state, lang, width, theme, mode) => jobs.push({ kind, state, lang, width, theme, mode });
for (const s of chat) for (const l of LANGS) for (const t of ["light", "dark"]) add("bookings", s, l, 390, t, "");
// "fees-parent" is the Fees chat of a parent with their own fee (?parent=1)
for (const k of ["orders", "fees", "fees-parent"]) for (const s of kindStates) for (const l of ["en", "ml"]) add(k, s, l, 390, "light", "");
for (const w of [360, 414]) for (const s of chat) for (const l of ["en", "ml"]) add("bookings", s, l, w, "light", "");
for (const s of chat) for (const l of ["en", "ml"]) add("bookings", s, l, 390, "light", "big");
for (const s of ["empty", "confirmed", "confirmed-live", "paid", "paid-live", "voice", "recording", "busy"]) if (chat.includes(s)) add("bookings", s, "en", 390, "light", "still");
add("bookings", "paints", "en", 390, "light", "");
console.log("jobs", jobs.length);
const WORDS = ["passkey", "session", "error", "retry", "AI", "bot"];
const browser = await chromium.launch();
const ctxs = new Map();
const ctxFor = async (j) => {
  const key = [j.width, j.theme, j.mode === "still"].join("|");
  if (!ctxs.has(key)) ctxs.set(key, await browser.newContext({ viewport: { width: j.width, height: 800 }, deviceScaleFactor: 2, colorScheme: j.theme, reducedMotion: j.mode === "still" ? "reduce" : "no-preference", locale: "en-IN" }));
  return ctxs.get(key);
};
const results = [];
const live = (s) => s.endsWith("-live") || s === "empty" || s === "recording";
for (const j of jobs) {
  const name = `${j.kind}-${j.state}-${j.lang}-${j.width}-${j.theme}${j.mode ? "-" + j.mode : ""}`;
  const rec = { name, ...j, console: [], failed: [], axe: [], overflow: false, tap: [], clipped: [], words: [], problems: 0 };
  const ctx = await ctxFor(j);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || /content security policy|refused/i.test(m.text())) rec.console.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => rec.console.push("pageerror: " + String(e.message).slice(0, 300)));
  page.on("requestfailed", (r) => rec.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) rec.failed.push(`${r.url()} HTTP ${r.status()}`); });
  try {
    const q = new URLSearchParams({ lang: j.lang, kind: j.kind.replace("-parent", "") });
    if (j.kind === "fees-parent") q.set("parent", "1");
    if (j.theme === "dark") q.set("theme", "dark");
    await page.goto(`${B}/${j.state}?${q}`, { waitUntil: "load", timeout: 30000 });
    if (j.mode === "big") await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))); });
    await page.waitForTimeout(live(j.state) ? 2800 : 600);
    await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
    const data = await page.evaluate(({ axeSrc, WORDS }) => (async () => {
      (0, eval)(axeSrc);
      const ax = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      const axeV = ax.violations.flatMap((v) => v.nodes.map((n) => ({ id: v.id, impact: v.impact, selector: n.target.join(" "), text: (n.html || "").replace(/\s+/g, " ").slice(0, 120), why: (n.any[0]?.message || v.help || "").slice(0, 160) })));
      const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const sel = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "");
      const tap = [...document.querySelectorAll("button,a[href],[role=button],input:not([type=hidden]),select,textarea,summary")].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { sel: sel(e), text: (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.w < 44 || t.h < 44);
      const clipped = [...document.querySelectorAll("body *")].filter((e) => {
        const s = getComputedStyle(e);
        // not a problem: screen-reader-only text (the .sr class, or anything clipped to a pixel on purpose) and a name cut with an ellipsis on purpose (the call strip)
        const r = e.getBoundingClientRect();
        if (e.classList.contains("sr") || r.width <= 2 || r.height <= 2 || s.textOverflow === "ellipsis") return false;
        return (s.overflowX === "hidden" || s.overflow === "hidden") && e.scrollWidth > e.clientWidth + 1 && vis(e);
      }).map((e) => ({ sel: sel(e), text: (e.innerText || "").trim().slice(0, 40), scroll: e.scrollWidth, client: e.clientWidth }));
      const text = document.body.innerText || "";
      const words = WORDS.filter((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}($|[^\\p{L}\\p{N}])`, "iu").test(text));
      return { axeV, overflow: document.documentElement.scrollWidth > innerWidth, sw: document.documentElement.scrollWidth, iw: innerWidth, tap, clipped, words };
    })(), { axeSrc, WORDS });
    Object.assign(rec, { axe: data.axeV, overflow: data.overflow, sw: data.sw, iw: data.iw, tap: data.tap, clipped: data.clipped, words: data.words });
  } catch (e) { rec.crash = String(e).slice(0, 300); }
  rec.problems = rec.axe.length + (rec.overflow ? 1 : 0) + rec.tap.length + rec.clipped.length + rec.console.length + rec.failed.length + rec.words.length + (rec.crash ? 1 : 0);
  results.push(rec);
  await page.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
}
await browser.close(); stop();
// summary
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const imp = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const types = { crash: [], overflow: [], axe: [], words: [], console: [], failed: [], clipped: [], tap: [] };
for (const r of results) {
  if (r.crash) types.crash.push([r.name, r.crash]);
  if (r.overflow) types.overflow.push([r.name, `scrollWidth ${r.sw} > ${r.iw}`]);
  for (const a of r.axe) types.axe.push([r.name, `${a.impact} ${a.id} ${a.selector} :: ${a.text}`, imp[a.impact] ?? 4]);
  for (const w of r.words) types.words.push([r.name, w]);
  for (const c of r.console) types.console.push([r.name, c]);
  for (const c of r.failed) types.failed.push([r.name, c]);
  for (const c of r.clipped) types.clipped.push([r.name, `${c.sel} "${c.text}" ${c.scroll}>${c.client}`]);
  for (const c of r.tap) types.tap.push([r.name, `${c.sel} "${c.text}" ${c.w}x${c.h}`]);
}
const groupBy = (arr) => { const m = new Map(); for (const [n, d] of arr) { const st = results.find((r) => r.name === n); const k = `${st.kind}-${st.state}`; const key = d; if (!m.has(key)) m.set(key, new Set()); m.get(key).add(n); } return m; };
let md = `# Chat review summary\n\n${results.length} screenshots (device scale 2, full page). The "-big" shots set the root font size to 200%, an approximation of Android's font scale. "-still" = reducedMotion reduce.\n\n## Counts\n`;
for (const [t, a] of Object.entries(types)) md += `- ${t}: ${a.length} findings in ${new Set(a.map((x) => x[0])).size} screenshots\n`;
md += `\nScreenshots with zero problems: ${results.filter((r) => !r.problems).length}\n`;
for (const t of ["crash", "overflow", "axe", "words", "console", "failed", "clipped", "tap"]) {
  if (!types[t].length) continue;
  md += `\n## ${t}\n`;
  const g = groupBy(types[t]);
  const entries = [...g.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [d, names] of entries) { const n = [...names]; md += `- (${n.length}) ${d}\n  e.g. ${n.slice(0, 4).join(", ")}${n.length > 4 ? ", ..." : ""}\n`; }
}
fs.writeFileSync(path.join(OUT, "summary.md"), md);
// contact sheet
const byState = new Map();
for (const r of results) { const k = r.state; if (!byState.has(k)) byState.set(k, []); byState.get(k).push(r); }
const lo = { en: 0, hi: 1, ml: 2, kn: 3 };
let h = `<!doctype html><meta charset=utf-8><title>Chat contact sheet</title><style>body{font:13px system-ui;margin:12px}h2{margin:24px 0 4px;border-bottom:2px solid #000}h3{margin:10px 0 2px;font-size:13px}.row{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;width:200px}img{width:200px;border:1px solid #888;display:block}figcaption{font-size:11px;word-break:break-word}.bad{color:#b00020}.ok{color:#1b7a2b}ul{margin:2px 0;padding-left:14px}</style><h1>Chat contact sheet (${results.length})</h1>`;
for (const [s, rs] of byState) {
  h += `<h2>${esc(s)}</h2>`;
  const langs = [...new Set(rs.map((r) => r.lang))].sort((a, b) => lo[a] - lo[b]);
  for (const l of langs) {
    h += `<h3>${l}</h3><div class=row>`;
    for (const r of rs.filter((x) => x.lang === l)) {
      const li = [];
      if (r.crash) li.push("CRASH " + r.crash);
      if (r.overflow) li.push(`overflow ${r.sw}>${r.iw}`);
      for (const a of r.axe) li.push(`axe ${a.impact} ${a.id}: ${a.selector}`);
      for (const t of r.tap) li.push(`tap ${t.w}x${t.h} ${t.sel} "${t.text}"`);
      for (const c of r.clipped) li.push(`clipped ${c.sel}`);
      for (const c of r.console) li.push("console " + c);
      for (const c of r.failed) li.push("request " + c);
      for (const w of r.words) li.push(`word "${w}"`);
      h += `<figure><a href="${r.name}.png"><img loading=lazy src="${r.name}.png"></a><figcaption>${esc(r.name)}<br><span class=${li.length ? "bad" : "ok"}>${li.length ? li.length + " issues" : "clean"}</span><ul>${li.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></figcaption></figure>`;
    }
    h += `</div>`;
  }
}
fs.writeFileSync(path.join(OUT, "contact-sheet.html"), h);
console.log("done");
