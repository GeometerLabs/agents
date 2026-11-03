// Show the Bookings agent to a shop owner, on the owner's own phone.
//
//   node pathways/bookings/demo/server.ts [--settings path/to/shop.json] [--lang hi|en|...] [--port 8787]
//
// The REAL agent runs against in-memory stand-ins for WhatsApp, payments and the calendar, with a fake clock.
// Test money only. Nothing real is contacted, nothing is saved, and the server answers only devices on your own network.
import { readFileSync } from "node:fs";
import { LANGUAGES, validateSettings } from "../src/settings.ts";
import { glowSalon } from "../src/harness.ts";
import { applyLanguage } from "./personalise.ts";
import { startDemo } from "./app.ts";

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) { console.error(`--${name} needs a value.`); process.exit(2); }
  return value;
}
for (const a of args.filter((x) => x.startsWith("--"))) {
  if (!["--settings", "--lang", "--port", "--host", "--help"].includes(a)) { console.error(`I don't know ${a}. Use --settings, --lang, --port or --host.`); process.exit(2); }
}
if (args.includes("--help")) {
  console.log(`Usage: node pathways/bookings/demo/server.ts [--settings shop.json] [--lang ${LANGUAGES.join("|")}] [--port 8787] [--host 192.168.x.x]`);
  process.exit(0);
}

let settings = glowSalon();
const settingsPath = option("settings");
if (settingsPath) {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(settingsPath, "utf8")); } catch (e) { console.error(`I could not read ${settingsPath}: ${(e as Error).message}`); process.exit(1); }
  const checked = validateSettings(raw);
  if (!checked.ok) { console.error(`These settings need fixing:\n- ${checked.errors.join("\n- ")}`); process.exit(1); }
  settings = checked.settings;
}
const lang = option("lang");
if (lang) {
  const applied = applyLanguage(settings, lang);
  if (!applied.ok) { console.error(applied.errors.join("\n")); process.exit(1); }
  settings = applied.settings;
}
const port = Number(option("port") ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error("--port must be a whole number between 1 and 65535."); process.exit(2); }
const host = option("host");

const demo = await startDemo({ settings, port, ...(host ? { hosts: [host] } : {}) }).catch((e: Error) => { console.error(e.message); process.exit(1); });
const lan = demo.urls.filter((u) => !u.includes("127.0.0.1"));
console.log(`Geometer · Bookings demo · ${settings.name} (${settings.owner.language})`);
console.log("Test money, practice WhatsApp, payments and calendar. Nothing real is contacted and nothing is saved.\n");
if (host === undefined || host.startsWith("127.")) console.log(`  On this computer:        http://localhost:${demo.port}`);
for (const u of lan) console.log(`  On a phone, same Wi-Fi:  ${u}`);
if (lan.length === 0 && host === undefined) console.log("  No Wi-Fi or network address found, so only this computer can open it.");
console.log("\nKeep it on your own network. There is no login: never open this port to the internet.");
for (const s of demo.skipped) console.log(`  (could not listen on ${s})`);
console.log("Press Ctrl+C to stop.");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void demo.close().then(() => process.exit(0)); });
