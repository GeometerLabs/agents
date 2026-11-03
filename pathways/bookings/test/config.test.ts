// A client's folder: what is read, what is refused and how it is said. And the service wiring that depends on the mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../src/clock.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { ClientError, loadClient, parseLock, pathwayVersion, validateRuntimeConfig } from "../server/config.ts";
import { loadLiveModule, buildServices } from "../server/services.ts";
import type { LiveModule } from "../server/services.ts";
import { readToken } from "../server/start.ts";

const EXAMPLE = new URL("../clients/glow-salon.example", import.meta.url).pathname;

/** A copy of the example client in a temp folder, with its files changed. */
function client(change: { lock?: string; runtime?: unknown; settings?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "geo-client-"));
  cpSync(EXAMPLE, dir, { recursive: true });
  if (change.lock !== undefined) writeFileSync(join(dir, "pathway.lock"), change.lock);
  if (change.runtime !== undefined) writeFileSync(join(dir, "runtime.json"), typeof change.runtime === "string" ? change.runtime : JSON.stringify(change.runtime));
  if (change.settings !== undefined) writeFileSync(join(dir, "settings.json"), change.settings);
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const refusal = (folder: string) => { try { loadClient(folder); } catch (e) { assert.ok(e instanceof ClientError, String(e)); return e.message; } assert.fail("it should have refused"); };

test("the example client folder is complete, its settings are the example business, and its pin matches this pathway's version", () => {
  const c = loadClient(EXAMPLE);
  assert.equal(c.name, "glow-salon.example");
  assert.equal(c.settings.name, "Glow Salon");
  assert.equal(c.runtime.mode, "fakes");
  assert.equal(c.runtime.host, "127.0.0.1");
  assert.equal(`${c.lock.pathway}@${c.lock.version}`, `bookings@${pathwayVersion()}`);
  assert.equal(c.runtime.dataDir, join(EXAMPLE, "data")); // measured from the client folder
  assert.deepEqual(JSON.parse(readFileSync(join(EXAMPLE, "settings.json"), "utf8")), JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")));
});

test("a client pinned to another version is refused, and the message shows both versions", () => {
  const c = client({ lock: "bookings@9.9.9\n" });
  try {
    const said = refusal(c.dir);
    assert.match(said, /bookings@9\.9\.9/);
    assert.match(said, new RegExp(`bookings@${pathwayVersion().replaceAll(".", "\\.")}`));
    assert.match(said, /will not start/);
  } finally { c.done(); }
});

test("pathway.lock: comments and blank lines are fine; anything else is explained", () => {
  assert.deepEqual(parseLock("# pinned on 3 Nov\n\nbookings@1.3.0\n"), { pathway: "bookings", version: "1.3.0" });
  assert.throws(() => parseLock(""), /like "bookings@0\.1\.0"/);
  assert.throws(() => parseLock("bookings 0.1.0"), /like "bookings@0\.1\.0"/);
  assert.throws(() => parseLock("bookings@0.1.0\nrefund-notes@1.0.0"), /cannot load modules yet/);
  const c = client({ lock: "tuition@0.1.0\n" });
  try { assert.match(refusal(c.dir), /tuition@0\.1\.0/); } finally { c.done(); }
});

test("a missing or broken file is named; every problem in runtime.json is listed at once", () => {
  const c = client();
  try {
    rmSync(join(c.dir, "runtime.json"));
    assert.match(refusal(c.dir), /could not find runtime\.json/);
    writeFileSync(join(c.dir, "runtime.json"), "{ not json");
    assert.match(refusal(c.dir), /runtime\.json .* is not valid JSON/);
    writeFileSync(join(c.dir, "settings.json"), JSON.stringify({ name: "" }));
    assert.match(refusal(c.dir), /settings need fixing/);
  } finally { c.done(); }

  const result = validateRuntimeConfig({ mode: "sometimes", port: 99999, tickSeconds: 0, colour: "red" }, "/x");
  assert.ok(!result.ok);
  const said = result.errors.join("\n");
  assert.match(said, /Set "mode" to "fakes"/);
  assert.match(said, /"port" must be a whole number/);
  assert.match(said, /"tickSeconds" must be/);
  assert.match(said, /"colour"/);
});

test("live mode needs where Guard stands for each service; fakes mode needs nothing more", () => {
  const fakes = validateRuntimeConfig({ mode: "fakes" }, "/clients/x");
  assert.ok(fakes.ok);
  assert.deepEqual([fakes.config.port, fakes.config.tickSeconds, fakes.config.host, fakes.config.dataDir], [8780, 30, "127.0.0.1", "/clients/x/data"]);

  const none = validateRuntimeConfig({ mode: "live" }, "/x");
  assert.ok(!none.ok && /needs "services"/.test(none.errors[0]));
  const bad = validateRuntimeConfig({ mode: "live", services: { payments: { baseUrl: "guard-pay" }, calendar: { baseUrl: "http://guard:8081" }, messaging: { baseUrl: "http://guard:8082", phoneNumberId: "1" } } }, "/x");
  assert.ok(!bad.ok);
  assert.match(bad.errors.join("\n"), /services\.payments\.baseUrl must be the address of the Guard/);
  assert.match(bad.errors.join("\n"), /services\.calendar\.calendarId is missing/);

  const good = validateRuntimeConfig({ mode: "live", services: { payments: { baseUrl: "http://guard-pay:8080" }, calendar: { baseUrl: "http://guard-cal:8080", calendarId: "salon@group.calendar.google.com" }, messaging: { baseUrl: "http://guard-wa:8080", phoneNumberId: "1234" }, timeoutMs: 8000 } }, "/x");
  assert.ok(good.ok);
  assert.equal(good.config.services?.calendar.calendarId, "salon@group.calendar.google.com");
  assert.equal(good.config.services?.timeoutMs, 8000);
});

const GOOD_PARSER = { wire: "openai", baseUrl: "https://guard-model.example:8083/model/v1", model: "some-model" };

test("runtime.json's parser is optional: left out there is none (the rules read the messages), and a good one is read as written", () => {
  const without = validateRuntimeConfig({ mode: "fakes" }, "/x");
  assert.ok(without.ok);
  assert.equal(without.config.parser, undefined);
  const withOne = validateRuntimeConfig({ mode: "fakes", parser: GOOD_PARSER }, "/x");
  assert.ok(withOne.ok);
  assert.deepEqual(withOne.config.parser, GOOD_PARSER);
  const slow = validateRuntimeConfig({ mode: "fakes", parser: { ...GOOD_PARSER, wire: "anthropic", timeoutMs: 12000 } }, "/x");
  assert.ok(slow.ok);
  assert.deepEqual(slow.config.parser, { ...GOOD_PARSER, wire: "anthropic", timeoutMs: 12000 });
});

test("a malformed parser is refused in plain words, all at once; one that carries a credential is refused without repeating it", () => {
  const refuse = (parser: unknown) => {
    const result = validateRuntimeConfig({ mode: "fakes", parser }, "/x");
    assert.ok(!result.ok, JSON.stringify(parser));
    return result.errors.join("\n");
  };
  assert.match(refuse("gpt"), /"parser" must be an object/);
  assert.match(refuse(null), /"parser" must be an object/);
  const empty = refuse({});
  assert.match(empty, /parser\.wire must be "openai".*"anthropic"/);
  assert.match(empty, /parser\.baseUrl must be the address of the Guard/);
  assert.match(empty, /parser\.model must be the name/);
  assert.match(refuse({ ...GOOD_PARSER, wire: "gemini" }), /parser\.wire must be/);
  for (const baseUrl of ["guard-model", "ftp://guard-model/v1", "", 7, undefined]) assert.match(refuse({ ...GOOD_PARSER, baseUrl }), /parser\.baseUrl must be the address of the Guard.*http/);
  assert.match(refuse({ ...GOOD_PARSER, model: "  " }), /parser\.model must be/);
  for (const timeoutMs of [0, 1.5, "8000", -1]) assert.match(refuse({ ...GOOD_PARSER, timeoutMs }), /parser\.timeoutMs must be a whole number/);
  assert.match(refuse({ ...GOOD_PARSER, temperature: 0 }), /I don't know what "temperature" means in parser/);

  // Credentials: in the address, in its query, or in a field of their own. The refusal says where keys live, and never repeats the secret.
  for (const baseUrl of ["https://someone:hunter2@guard-model.example/v1", "https://hunter2@guard-model.example/v1", "https://guard-model.example/v1?key=hunter2", "https://guard-model.example/v1#hunter2"]) {
    const said = refuse({ ...GOOD_PARSER, baseUrl });
    assert.match(said, /parser\.baseUrl must not (hold a user name or password|carry a query or a #fragment)/);
    assert.match(said, /Guard holds the key/);
    assert.ok(!said.includes("hunter2"), said);
  }
  for (const field of ["apiKey", "api_key", "token", "Authorization", "secret", "password"]) {
    const said = refuse({ ...GOOD_PARSER, [field]: "hunter2" });
    assert.match(said, new RegExp(`parser\\.${field} is not allowed.*Guard holds the key`));
    assert.ok(!said.includes("hunter2"));
  }
});

test("a client folder whose parser is malformed does not load, and the refusal names runtime.json", () => {
  const c = client({ runtime: { mode: "fakes", parser: { ...GOOD_PARSER, baseUrl: "https://k:v@guard.example/v1" } } });
  try {
    const said = refusal(c.dir);
    assert.match(said, /runtime\.json needs fixing/);
    assert.match(said, /parser\.baseUrl must not hold a user name or password/);
  } finally { c.done(); }
});

test("the internal token comes from a file: trimmed, and refused when missing or too short", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-token-"));
  try {
    assert.throws(() => readToken(undefined), /Set INTERNAL_TOKEN_FILE/);
    assert.throws(() => readToken(join(dir, "nope")), /could not read the internal token file/);
    writeFileSync(join(dir, "short"), "abc\n");
    assert.throws(() => readToken(join(dir, "short")), /too short/);
    writeFileSync(join(dir, "empty"), "\n");
    assert.throws(() => readToken(join(dir, "empty")), /too short/);
    writeFileSync(join(dir, "ok"), "  0123456789abcdef0123  \n");
    assert.equal(readToken(join(dir, "ok")), "0123456789abcdef0123");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("fakes mode wires the stand-ins and says what the stand-in WhatsApp sends", async () => {
  const lines: string[] = [];
  const clock = fakeClock(0);
  const services = await buildServices({ mode: "fakes" }, { clock, window: { lastInboundAt: () => undefined }, say: (l) => lines.push(l) });
  await services.messaging.sendTemplate("+91900", { name: TEMPLATE_NAMES.customer, language: "en", text: "hello there" });
  assert.equal((await services.calendar.list()).length, 0);
  assert.equal((await services.payments.listPaymentLinks()).length, 0);
  assert.equal(await services.messaging.isWindowOpen("+91900"), false);
  assert.deepEqual(lines, ["[stand-in WhatsApp] to +91900: hello there"]);
});

test("live mode loads the live adapters only then, hands them the services and the window store", async () => {
  const asked: unknown[] = [];
  const stub: LiveModule = { createLiveAdapters: (services, deps) => { asked.push(services, deps); return { calendar: {} as any, payments: {} as any, messaging: {} as any }; } };
  const clock = fakeClock(0);
  const window = { lastInboundAt: (p: string) => (p === "+91900" ? 42 : undefined) };
  const services = { payments: { baseUrl: "http://g1" }, calendar: { baseUrl: "http://g2", calendarId: "c" }, messaging: { baseUrl: "http://g3", phoneNumberId: "p" } };
  await buildServices({ mode: "live", services }, { clock, window, loadLive: async () => stub });
  assert.deepEqual(asked[0], services);
  assert.equal((asked[1] as any).clock, clock);
  assert.equal((asked[1] as any).window.lastInboundAt("+91900"), 42);

  let loaded = false;
  await buildServices({ mode: "fakes" }, { clock, window, loadLive: async () => { loaded = true; return stub; } });
  assert.equal(loaded, false, "fakes mode never loads the live module");
});

test("when this build has no live adapters, live mode refuses with a clear message", { skip: existsSync(new URL("../src/adapters/live/index.ts", import.meta.url)) }, async () => {
  await assert.rejects(loadLiveModule(), /does not have them.*"fakes"/s);
});
