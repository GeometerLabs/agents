// The wire-level pieces of voice notes against a local HTTP stand-in (no account, no network beyond localhost): the multipart upload arriving intact, bytes coming back
// intact, a Guard's refusal read as Guard's, the size cap, a connection that cannot be made; the Sarvam adapter against a recorded documented reply; the runtime.json `speech`
// block's checks; and the service built from a config end to end. Listening only. The fixtures in fixtures/ are the documented shapes (Sarvam's
// reply pages, Meta's audio webhook, Gupshup's audio callback with a url), read 12 Nov 2026 (see modules/voice/sarvam.ts and media.ts for the pages).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createWire } from "../wire.ts";
import { createSarvam } from "../sarvam.ts";
import { readSpeech, buildVoice } from "../config.ts";
import { fakeVoiceNote } from "../standin.ts";
import { GuardRefusedError, NotSentError, TimeoutError } from "../../core/faults.ts";
import { parseWhatsAppWebhook } from "../../messaging/webhooks.ts";
import { readRuntimeConfig } from "../../runtime/config.ts";
import { fakeClock } from "../../core/clock.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, i) => i);

interface Seen { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer }
async function standin(handler: (req: Seen) => { status?: number; json?: unknown; bytes?: Uint8Array; type?: string }): Promise<{ url: string; seen: Seen[]; close(): Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const s: Seen = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(s);
      const r = handler(s);
      const body = r.bytes ? Buffer.from(r.bytes) : Buffer.from(JSON.stringify(r.json ?? {}));
      res.writeHead(r.status ?? 200, { "content-type": r.type ?? (r.bytes ? "audio/ogg" : "application/json"), "content-length": body.length });
      res.end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("the wire sends a multipart body whose file arrives byte for byte, and carries only the agent's credential for the Guard", async () => {
  const s = await standin(() => ({ json: { ok: true } }));
  try {
    const form = new FormData();
    form.set("file", new Blob([ALL_BYTES as BlobPart], { type: "audio/ogg" }), "voice-note");
    form.set("model", "saaras:v4");
    await createWire(s.url, "Speech", 3000, "agent-credential").request("POST", "/speech-to-text", { form });
    const got = s.seen[0];
    assert.match(String(got.headers["content-type"]), /^multipart\/form-data; boundary=/u);
    assert.equal(got.headers.authorization, "Bearer agent-credential");
    assert.ok(got.body.includes(Buffer.from(ALL_BYTES)), "the audio bytes are in the body, unchanged");
    assert.ok(got.body.includes(Buffer.from('name="model"')) && got.body.includes(Buffer.from("saaras:v4")));
  } finally { await s.close(); }
});

test("the wire returns bytes intact, refuses a reply over the cap, reads a Guard's refusal as Guard's, and tells a refused connection from a lost reply", async () => {
  const s = await standin((req) => req.url.startsWith("/guard") ? { status: 403, json: { guard: { decision: "deny", code: "refused_by_policy", reason: "limit speaks-per-day would be exceeded" } } } : { bytes: ALL_BYTES });
  try {
    const wire = createWire(s.url, "Media", 3000);
    const got = await wire.request("GET", "/audio");
    assert.deepEqual([...got.bytes], [...ALL_BYTES]);
    await assert.rejects(wire.request("GET", "/audio", { maxBytes: 100 }), TimeoutError);
    await assert.rejects(wire.request("POST", "/guard"), GuardRefusedError);
  } finally { await s.close(); }
  // a port nothing listens on: open one, note its number, close it
  const closed = await standin(() => ({}));
  await closed.close();
  await assert.rejects(createWire(closed.url, "Speech", 3000).request("GET", "/x"), NotSentError);
});

test("the Sarvam adapter against the documented reply: speech to text, the model named, no provider key sent", async () => {
  const s = await standin(() => ({ json: fixture("sarvam-stt-reply.json") }));
  try {
    const sarvam = createSarvam({ baseUrl: s.url, agentToken: "t" });
    const heard = await sarvam.transcribe({ bytes: fakeVoiceNote(5), mime: "audio/ogg" }, ["hi", "en"]);
    assert.deepEqual(heard, { text: "कल सुबह हेयरकट बुक करना है", language: "hi", confidence: 0.97 });
    assert.ok(s.seen[0].body.includes(Buffer.from("saaras:v4")));
    assert.ok(s.seen.every((r) => r.headers["api-subscription-key"] === undefined), "the adapter never sends a provider key: the Guard adds it");
  } finally { await s.close(); }
});

test("Meta's and Gupshup's documented audio webhooks: nothing of the audio without voice on; with it, the id (Meta) or the id and address (Gupshup)", () => {
  const meta = parseWhatsAppWebhook(fixture("whatsapp-webhook-audio.json"));
  assert.deepEqual(meta.map((m) => [m.voiceNote, m.media]), [[true, undefined]]);
  assert.deepEqual(parseWhatsAppWebhook(fixture("whatsapp-webhook-audio.json"), { voiceMedia: true })[0].media, { id: "1623525315162", mime: "audio/ogg; codecs=opus" });
  assert.deepEqual(parseWhatsAppWebhook(fixture("gupshup-webhook-audio.json"), { voiceMedia: true })[0].media, { id: "1623525315162", url: "https://media.stand-in.example/v1/files/1623525315162?download=false", mime: "audio/ogg; codecs=opus" });
});

test("runtime.json's speech block: every refusal in words, no key accepted, the price required, and the report folder needed", () => {
  const good = { provider: "sarvam", baseUrl: "http://g-speech:8080", media: { downloadBaseUrl: "http://g-media:8080", downloadHosts: ["media.stand-in.example"] }, rate: { sttInrPerMinute: 0.5 } };
  const read = (raw: unknown) => { const errors: string[] = []; const config = readSpeech(raw, "/shop", errors); return { config, errors }; };
  assert.deepEqual(read(good).errors, []);
  assert.equal(read(good).config!.replies, undefined);
  assert.ok(read({ ...good, rate: undefined }).errors.some((e) => /speech\.rate is needed/u.test(e)), "voice does not run without a price");
  assert.ok(read({ ...good, rate: { sttInrPerMinute: -1 } }).errors.some((e) => /rate/u.test(e)));
  const withKey = read({ ...good, apiKey: "sk-live-xyz" });
  assert.ok(withKey.errors.some((e) => /No key goes in runtime\.json/u.test(e)) && !withKey.errors.join(" ").includes("sk-live-xyz"), "a key is refused and never echoed");
  assert.ok(read({ ...good, baseUrl: "http://u:p@host" }).errors.some((e) => /user name/u.test(e)));
  assert.ok(read({ ...good, media: { ...good.media, downloadHosts: [] } }).errors.some((e) => /downloadHosts/u.test(e)));
  assert.ok(read({ ...good, provider: "elevenlabs" }).errors.some((e) => /provider must be/u.test(e)));
  const shape = [{ name: "messaging", extra: "phoneNumberId" }] as never;
  const base = { mode: "fakes", speech: good };
  const withReport = readRuntimeConfig(base, "/shop", shape);
  assert.ok(withReport.ok && withReport.config.speech?.rate.sttInrPerMinute === 0.5, "no report block is needed any more: nothing is served");
  const off = readRuntimeConfig({ mode: "fakes" }, "/shop", shape);
  assert.ok(off.ok && off.config.speech === undefined, "no block: voice is off");
});

test("a voice service built from a config hears a note through the Guards' addresses (lookup, then the path and query only)", async () => {
  const speech = await standin(() => ({ json: fixture("sarvam-stt-reply.json") }));
  const media = await standin((req) => req.url.startsWith("/v26.0/") ? { json: { url: "https://media.stand-in.example/v1/files/1?x=2", mime_type: "audio/ogg; codecs=opus", file_size: "300" } } : { bytes: fakeVoiceNote(8) });
  try {
    const errors: string[] = [];
    const config = readSpeech({ provider: "sarvam", baseUrl: speech.url, media: { lookupBaseUrl: media.url, downloadBaseUrl: media.url, downloadHosts: ["media.stand-in.example"] }, rate: { sttInrPerMinute: 0.6 } }, "/shop", errors)!;
    assert.deepEqual(errors, []);
    const voice = buildVoice(config, { clock: fakeClock(Date.UTC(2026, 10, 12, 10)), languages: ["hi", "en", "ml", "kn"], log: () => undefined });
    const heard = await voice.hear({ id: "1623525315162" });
    assert.ok(heard.ok && heard.language === "hi" && Math.abs(heard.seconds - 8) < 0.01 && heard.costMicroInr === 80_000);
    assert.deepEqual(media.seen.map((r) => r.url), ["/v26.0/1623525315162", "/v1/files/1?x=2"], "the lookup, then the download of only the path and query");
  } finally { await speech.close(); await media.close(); }
});
